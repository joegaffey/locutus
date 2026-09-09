// Express app factory for the Agent Avatar UI (MVP, single agent).
//
// Endpoints:
//   POST /api/messages        agent posts { text?, emoji? } (spoken in the browser)
//   GET  /api/messages?since=  poll conversation after a cursor
//   POST /api/user/messages   UI posts the human's { text } reply
//   GET  /api/ask             ask a question and long-poll for the human's reply
//   POST /api/upload          UI uploads a pasted/dropped image → user message
//   GET  /api/stream          SSE stream of messages
//
// The optional `onMessage` callback is invoked with each stored message so the
// caller can broadcast it (e.g. over the SSE hub).

import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { ensureUploadsDir } from "./config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const MAX_EMOJI_LEN = 16; // a couple of codepoints incl. modifiers/ZWJ sequences
const ASK_MAX_TIMEOUT_MS = 300_000; // cap a single /api/ask wait at 5 minutes
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB cap on uploads

// Allowed image content types → file extension.
const IMAGE_EXT = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/bmp": ".bmp",
  "image/svg+xml": ".svg",
};

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
  function recordUserMessage(fields) {
    const message = conversation.append({ source: "user", ...fields });
    onMessage(message);
    for (const resolve of askWaiters) resolve(message);
    askWaiters.clear();
    return message;
  }

  // Serve uploaded files (pasted/dropped images) so the browser can show them
  // and remote agents can fetch them by URL.
  const uploadsDir = ensureUploadsDir();
  app.use("/uploads", express.static(uploadsDir));

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
    res.status(201).json(recordUserMessage({ text }));
  });

  // UI uploads a pasted/dropped image. The raw image bytes are the request body
  // and the Content-Type header names the image type. On success the file is
  // saved and a user message is recorded carrying both an absolute filesystem
  // `image` path (for local agents to read) and a browser-fetchable `url`.
  // An optional `?text=` query provides a caption spoken/shown with the image.
  app.post(
    "/api/upload",
    express.raw({ type: "image/*", limit: MAX_UPLOAD_BYTES }),
    (req, res) => {
      const contentType = (req.headers["content-type"] || "")
        .split(";")[0]
        .trim()
        .toLowerCase();
      const ext = IMAGE_EXT[contentType];
      if (!ext) {
        return res
          .status(415)
          .json({ error: `Unsupported image type: ${contentType || "none"}` });
      }
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ error: "Empty upload body." });
      }

      // Safe, generated filename — never trust a client-supplied name.
      const name = `${randomUUID()}${ext}`;
      const absPath = join(uploadsDir, name);
      try {
        writeFileSync(absPath, req.body);
      } catch {
        return res.status(500).json({ error: "Failed to store upload." });
      }

      const url = `/uploads/${name}`;
      const caption =
        typeof req.query.text === "string" ? req.query.text.trim() : "";
      const message = recordUserMessage({
        text: caption,
        image: absPath,
        url,
      });
      res.status(201).json(message);
    },
  );

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
