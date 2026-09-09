import { test } from "node:test";
import assert from "node:assert/strict";
import { Conversation } from "../src/conversation.js";

test("append assigns increasing cursors and returns the stored message", () => {
  const c = new Conversation();
  const a = c.append({ source: "agent", text: "hi" });
  const b = c.append({ source: "user", text: "hey" });
  assert.equal(a.cursor, 1);
  assert.equal(b.cursor, 2);
  assert.equal(a.source, "agent");
  assert.equal(b.text, "hey");
  assert.equal(a.emoji, null);
  assert.ok(typeof a.ts === "number");
});

test("append stores emoji", () => {
  const c = new Conversation();
  const m = c.append({ source: "agent", text: "", emoji: "🎉" });
  assert.equal(m.emoji, "🎉");
  assert.equal(m.text, "");
});

test("append attaches optional image/url only when provided", () => {
  const c = new Conversation();
  const plain = c.append({ source: "user", text: "hi" });
  assert.equal("image" in plain, false);
  assert.equal("url" in plain, false);
  const img = c.append({
    source: "user",
    text: "look",
    image: "/abs/uploads/x.png",
    url: "/uploads/x.png",
  });
  assert.equal(img.image, "/abs/uploads/x.png");
  assert.equal(img.url, "/uploads/x.png");
});

test("getSince returns only messages after the cursor plus latest cursor", () => {
  const c = new Conversation();
  c.append({ source: "agent", text: "1" });
  c.append({ source: "agent", text: "2" });
  const { messages, cursor } = c.getSince(1);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].text, "2");
  assert.equal(cursor, 2);
});

test("getSince(0) returns everything", () => {
  const c = new Conversation();
  c.append({ source: "agent", text: "1" });
  c.append({ source: "user", text: "2" });
  assert.equal(c.getSince(0).messages.length, 2);
});

test("buffer is bounded but cursor keeps increasing", () => {
  const c = new Conversation({ max: 3 });
  for (let i = 0; i < 5; i++) c.append({ source: "agent", text: String(i) });
  assert.equal(c.messages.length, 3);
  assert.equal(c.cursor, 5);
  // oldest evicted; remaining are the last three
  assert.deepEqual(
    c.messages.map((m) => m.text),
    ["2", "3", "4"],
  );
});
