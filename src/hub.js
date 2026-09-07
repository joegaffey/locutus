// Server-Sent Events (SSE) broadcast hub.
//
// A single push channel used by both the browser UI and any agents that prefer
// a stream over polling. On subscribe, a client receives a `history` snapshot of
// recent messages, then each new message (agent or user) as a `message` event.
//
// SSE is a plain-HTTP, one-way (server → client) stream — exactly what these
// consumers need — so there's no separate protocol or upgrade handshake.

export class Hub {
  /** @param {import("./conversation.js").Conversation} conversation */
  constructor(conversation) {
    this.conversation = conversation;
    /** @type {Set<import("http").ServerResponse>} */
    this.clients = new Set();
  }

  /**
   * Attach an Express response as an SSE subscriber. Sends headers, a history
   * snapshot, and keeps the connection open for future broadcasts.
   * @param {import("express").Request} req
   * @param {import("express").Response} res
   */
  subscribe(req, res) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Disable proxy buffering so events flush immediately.
      "X-Accel-Buffering": "no",
    });
    res.write("retry: 2000\n\n"); // hint client reconnect delay

    this._event(res, "history", {
      messages: this.conversation.getSince(0).messages,
      cursor: this.conversation.cursor,
    });

    this.clients.add(res);

    // Heartbeat comment keeps intermediaries from closing an idle connection.
    const ping = setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch {
        /* will be cleaned up on close */
      }
    }, 25000);

    const cleanup = () => {
      clearInterval(ping);
      this.clients.delete(res);
    };
    req.on("close", cleanup);
    res.on("error", cleanup);
  }

  /** Broadcast a stored message to all subscribers. */
  broadcast(message) {
    for (const res of this.clients) {
      try {
        this._event(res, "message", { message });
      } catch {
        this.clients.delete(res);
      }
    }
  }

  /** Write a named SSE event with a JSON data payload. */
  _event(res, type, data) {
    res.write(`event: ${type}\n`);
    res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
  }
}
