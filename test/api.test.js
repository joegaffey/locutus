import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { Conversation } from "../src/conversation.js";
import { createApp } from "../src/app.js";

function makeApp() {
  const conversation = new Conversation();
  const broadcast = [];
  const app = createApp({
    conversation,
    onMessage: (m) => broadcast.push(m),
  });
  return { app, conversation, broadcast };
}

test("POST /api/messages stores an agent message and returns 201", async () => {
  const { app, broadcast } = makeApp();
  const res = await request(app)
    .post("/api/messages")
    .send({ text: "hello", emoji: "🎉" });
  assert.equal(res.status, 201);
  assert.equal(res.body.source, "agent");
  assert.equal(res.body.text, "hello");
  assert.equal(res.body.emoji, "🎉");
  assert.equal(res.body.cursor, 1);
  assert.equal(broadcast.length, 1);
});

test("POST /api/messages accepts emoji-only (no text)", async () => {
  const { app } = makeApp();
  const res = await request(app).post("/api/messages").send({ emoji: "🤔" });
  assert.equal(res.status, 201);
  assert.equal(res.body.text, "");
  assert.equal(res.body.emoji, "🤔");
});

test("POST /api/messages rejects empty text and emoji with 400", async () => {
  const { app } = makeApp();
  const res = await request(app).post("/api/messages").send({ text: "  " });
  assert.equal(res.status, 400);
  assert.ok(res.body.error);
});

test("GET /api/messages?since returns messages after cursor", async () => {
  const { app } = makeApp();
  await request(app).post("/api/messages").send({ text: "one" });
  await request(app).post("/api/messages").send({ text: "two" });
  const res = await request(app).get("/api/messages?since=1");
  assert.equal(res.status, 200);
  assert.equal(res.body.messages.length, 1);
  assert.equal(res.body.messages[0].text, "two");
  assert.equal(res.body.cursor, 2);
});

test("POST /api/user/messages stores a user reply", async () => {
  const { app } = makeApp();
  const res = await request(app)
    .post("/api/user/messages")
    .send({ text: "got it" });
  assert.equal(res.status, 201);
  assert.equal(res.body.source, "user");
  assert.equal(res.body.text, "got it");
});

test("POST /api/user/messages rejects empty text", async () => {
  const { app } = makeApp();
  const res = await request(app).post("/api/user/messages").send({ text: "" });
  assert.equal(res.status, 400);
});

test("round-trip: agent posts, user replies, agent polls and sees the reply", async () => {
  const { app } = makeApp();
  await request(app).post("/api/messages").send({ text: "question?" });
  await request(app).post("/api/user/messages").send({ text: "answer!" });
  const res = await request(app).get("/api/messages?since=1");
  const userMsgs = res.body.messages.filter((m) => m.source === "user");
  assert.equal(userMsgs.length, 1);
  assert.equal(userMsgs[0].text, "answer!");
});

test("GET /api/ask returns the human's reply when one arrives", async () => {
  const { app } = makeApp();
  // Fire the blocking ask, then post a user reply shortly after.
  const askP = request(app).get("/api/ask?text=hello&emoji=🎤&timeout=5");
  setTimeout(() => {
    request(app).post("/api/user/messages").send({ text: "blue" }).end(() => {});
  }, 50);
  const res = await askP;
  assert.equal(res.status, 200);
  assert.equal(res.body.reply, "blue");
  assert.equal(res.body.message.source, "user");
});

test("GET /api/ask times out with 408 when no reply arrives", async () => {
  const { app } = makeApp();
  const res = await request(app).get("/api/ask?text=hi&timeout=1");
  assert.equal(res.status, 408);
  assert.ok(res.body.error);
});

test("GET /api/ask speaks the prompt as an agent message", async () => {
  const { app, broadcast } = makeApp();
  const askP = request(app).get("/api/ask?text=ping&emoji=🎤&timeout=2");
  setTimeout(() => {
    request(app).post("/api/user/messages").send({ text: "pong" }).end(() => {});
  }, 50);
  await askP;
  const agentPrompt = broadcast.find(
    (m) => m.source === "agent" && m.text === "ping",
  );
  assert.ok(agentPrompt, "expected the prompt to be broadcast as an agent message");
  assert.equal(agentPrompt.emoji, "🎤");
});

test("unknown /api route returns 404 JSON", async () => {
  const { app } = makeApp();
  const res = await request(app).get("/api/nope");
  assert.equal(res.status, 404);
  assert.ok(res.body.error);
});
