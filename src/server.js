// Entry point: wires the conversation store, HTTP API, and SSE hub together.

import { Conversation } from "./conversation.js";
import { Hub } from "./hub.js";
import { createApp } from "./app.js";

const PORT = process.env.PORT || 3000;

const conversation = new Conversation();
const hub = new Hub(conversation);

const app = createApp({
  conversation,
  hub,
  onMessage: (msg) => hub.broadcast(msg),
});

app.listen(PORT, () => {
  console.log(`Agent Avatar UI listening on http://localhost:${PORT}`);
});
