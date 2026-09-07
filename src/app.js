// Express app factory for the Agent Avatar UI (MVP, single agent).
//
// Endpoints:
//   POST /api/messages        agent posts { text?, emoji? } (spoken in the browser)
//   GET  /api/messages?since=  poll conversation after a cursor
//   POST /api/user/messages   UI posts the human's { text } reply
//   GET  /api/ask             ask a question and long-poll for the human's reply
//
// The optional `onMessage` callback is invoked with each stored message so the
// caller can broadcast it (e.g. over the SSE hub).

import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const MAX_EMOJI_LEN = 16; // a couple of codepoints incl. modifiers/ZWJ sequences
const ASK_MAX_TIMEOUT_MS = 300_000; // cap a single /api/ask wait at 5 minutes

/** Normalize/validate an emoji field. Returns a trimmed string or null. */
function normalizeEmoji(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return Array.from(trimmed).slice(0, MAX_EMOJI_LEN).join("");
}

/**
 * @param {{ conversation: import("./conversation.js").Conversation,
 *           onMessage?: (msg: any) => void,
 *           hub?: { subscribe: (req:any,res:any)=>void } }} deps
 */
export function createApp({ conversation, onMessage = () => {}, hub = null }) {
  const app = express();
  app.use(express.json());

  // Waiters parked on /api/ask, woken when a user message arrives.
  /** @type {Set<(msg:any)=>void>} */
  const askWaiters = new Set();

  /** Record a user message and wake any pending /api/ask waiters. */
  function recordUserMessage(text) {
    const message = conversation.append({ source: "user", text });
    onMessage(message);
    for (const resolve of askWaiters) resolve(message);
    askWaiters.clear();
    return message;
  }

  // Static UI. Disable caching so frontend edits show up on a plain refresh
  // (this is a local dev accessory; assets are tiny).
  app.use(
    express.static(join(__dirname, "..", "public"), {
      etag: false,
      lastModified: false,
      setHeaders: (res) => {
        res.setHeader("Cache-Control", "no-store");
      },
    }),
  );

  // Agent posts a message (spoken aloud + sets avatar expression).
  app.post("/api/messages", (req, res) => {
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    const emoji = normalizeEmoji(req.body?.emoji);

    if (text === "" && emoji === null) {
      return res
        .status(400)
        .json({ error: "Provide at least one of non-empty 'text' or 'emoji'." });
    }

    const message = conversation.append({ source: "agent", text, emoji });
    onMessage(message);
    res.status(201).json(message);
  });

  // Poll for messages after a cursor (agents read user replies here).
  app.get("/api/messages", (req, res) => {
    const since = Number.parseInt(req.query.since, 10);
    res.json(conversation.getSince(Number.isNaN(since) ? 0 : since));
  });

  // Live SSE stream of messages, used by the browser UI and by agents that
  // prefer a push stream over polling. Sends a history snapshot on connect.
  app.get("/api/stream", (req, res) => {
    if (!hub) return res.status(503).json({ error: "Stream unavailable." });
    hub.subscribe(req, res);
  });

  // UI posts the human's spoken/typed reply.
  app.post("/api/user/messages", (req, res) => {
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (text === "") {
      return res.status(400).json({ error: "Missing or empty 'text'." });
    }
    res.status(201).json(recordUserMessage(text));
  });

  // Ask a question and block until the human replies (or timeout).
  // One HTTP round trip = one full voice Q&A. Query params:
  //   text   (optional) spoken prompt
  //   emoji  (optional) avatar expression while asking
  //   timeout (optional) seconds to wait (default 60, capped at 300)
  // Responds 200 { reply, message } on a reply, or 408 { error } on timeout.
  app.get("/api/ask", (req, res) => {
    const text = typeof req.query.text === "string" ? req.query.text.trim() : "";
    const emoji = normalizeEmoji(req.query.emoji);
    const secs = Number.parseInt(req.query.timeout, 10);
    const timeoutMs = Math.min(
      Number.isNaN(secs) ? 60_000 : secs * 1000,
      ASK_MAX_TIMEOUT_MS,
    );

    // Speak the prompt (if any) so the human knows a reply is expected.
    if (text !== "" || emoji !== null) {
      const prompt = conversation.append({ source: "agent", text, emoji });
      onMessage(prompt);
    }

    let settled = false;
    const resolve = (message) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      askWaiters.delete(resolve);
      res.status(200).json({ reply: message.text, message });
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      askWaiters.delete(resolve);
      res.status(408).json({ error: "Timed out waiting for a reply." });
    }, timeoutMs);

    // If the client hangs up, stop waiting.
    req.on("close", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      askWaiters.delete(resolve);
    });

    askWaiters.add(resolve);
  });

  // Unknown API routes → 404 JSON.
  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

  return app;
}
