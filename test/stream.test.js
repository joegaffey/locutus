import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Conversation } from "../src/conversation.js";
import { Hub } from "../src/hub.js";
import { createApp } from "../src/app.js";

// Spin up the full app + SSE hub on an ephemeral port for each test.
function startServer() {
  const conversation = new Conversation();
  const hub = new Hub(conversation);
  const app = createApp({
    conversation,
    hub,
    onMessage: (m) => hub.broadcast(m),
  });
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      resolve({ server, port: server.address().port, conversation });
    });
  });
}

// Open an SSE connection and invoke onChunk with accumulated text; caller
// resolves when it has seen what it needs, then we destroy the request.
function openStream(port, onData) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { host: "127.0.0.1", port, path: "/api/stream" },
      (res) => {
        res.setEncoding("utf8");
        let buf = "";
        res.on("data", (chunk) => {
          buf += chunk;
          onData(buf, () => req.destroy(), res);
        });
      },
    );
    req.on("error", (err) => {
      // destroy() triggers an error we can ignore once resolved.
      if (!req.destroyed) reject(err);
    });
    resolve(req);
  });
}

test("GET /api/stream sends a history snapshot on connect", async () => {
  const { server, port, conversation } = await startServer();
  conversation.append({ source: "agent", text: "earlier", emoji: "👋" });

  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("no history event")), 3000);
    openStream(port, (buf, close) => {
      if (buf.includes("event: history") && buf.includes("earlier")) {
        clearTimeout(t);
        close();
        resolve();
      }
    });
  });

  server.close();
});

test("GET /api/stream pushes new messages as SSE events", async () => {
  const { server, port } = await startServer();

  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("no message event")), 3000);
    let historySeen = false;
    openStream(port, (buf, close) => {
      if (!historySeen && buf.includes("event: history")) {
        historySeen = true;
        // Now cause a broadcast via the real HTTP path.
        http.request(
          {
            host: "127.0.0.1",
            port,
            path: "/api/messages",
            method: "POST",
            headers: { "Content-Type": "application/json" },
          },
          () => {},
        ).end(JSON.stringify({ text: "live-hello", emoji: "🎉" }));
      }
      if (buf.includes("event: message") && buf.includes("live-hello")) {
        clearTimeout(t);
        close();
        resolve();
      }
    });
  });

  server.close();
});
