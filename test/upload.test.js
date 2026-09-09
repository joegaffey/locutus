import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, existsSync } from "node:fs";
import request from "supertest";

// Point uploads at a throwaway dir before importing the app/config.
process.env.LOCUTUS_DATA_DIR = mkdtempSync(join(tmpdir(), "locutus-test-"));

const { Conversation } = await import("../src/conversation.js");
const { createApp } = await import("../src/app.js");

function makeApp() {
  const conversation = new Conversation();
  const broadcast = [];
  const app = createApp({ conversation, onMessage: (m) => broadcast.push(m) });
  return { app, conversation, broadcast };
}

// A tiny valid-enough PNG byte sequence (header only is fine — we don't decode).
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

test("POST /api/upload stores an image and records a user message", async () => {
  const { app, broadcast } = makeApp();
  const res = await request(app)
    .post("/api/upload")
    .set("Content-Type", "image/png")
    .send(PNG);
  assert.equal(res.status, 201);
  assert.equal(res.body.source, "user");
  assert.ok(res.body.url && res.body.url.startsWith("/uploads/"));
  assert.ok(res.body.image && res.body.image.endsWith(".png"));
  assert.ok(existsSync(res.body.image), "file should exist on disk");
  assert.equal(broadcast.length, 1);
});

test("POST /api/upload attaches a caption from ?text=", async () => {
  const { app } = makeApp();
  const res = await request(app)
    .post("/api/upload?text=" + encodeURIComponent("why is this misaligned?"))
    .set("Content-Type", "image/png")
    .send(PNG);
  assert.equal(res.status, 201);
  assert.equal(res.body.text, "why is this misaligned?");
});

test("POST /api/upload rejects unsupported content type with 415", async () => {
  const { app } = makeApp();
  const res = await request(app)
    .post("/api/upload")
    .set("Content-Type", "application/pdf")
    .send(Buffer.from([1, 2, 3]));
  assert.equal(res.status, 415);
});

test("uploaded file is served from /uploads", async () => {
  const { app } = makeApp();
  const up = await request(app)
    .post("/api/upload")
    .set("Content-Type", "image/png")
    .send(PNG);
  const get = await request(app).get(up.body.url);
  assert.equal(get.status, 200);
});

test("an uploaded image wakes a pending /api/ask", async () => {
  const { app } = makeApp();
  const askP = request(app).get("/api/ask?text=show+me&timeout=5");
  setTimeout(() => {
    request(app)
      .post("/api/upload")
      .set("Content-Type", "image/png")
      .send(PNG)
      .end(() => {});
  }, 50);
  const res = await askP;
  assert.equal(res.status, 200);
  assert.ok(res.body.message.url);
});
