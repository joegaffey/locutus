// In-memory conversation log for the MVP (single shared conversation).
//
// Messages are appended in order and assigned a monotonically increasing integer
// cursor. Consumers poll with `getSince(cursor)` to receive only new messages.
// The buffer is bounded so memory does not grow without limit; the cursor keeps
// increasing even after old messages are evicted.

const DEFAULT_MAX = 500;

export class Conversation {
  /** @param {{ max?: number }} [opts] */
  constructor({ max = DEFAULT_MAX } = {}) {
    this.max = max;
    /** @type {Array<{id:number,cursor:number,source:string,text:string,emoji:string|null,ts:number}>} */
    this.messages = [];
    this._cursor = 0;
  }

  /**
   * Append a message to the log.
   * @param {{ source: "agent"|"user", text?: string, emoji?: string|null,
   *           image?: string|null, url?: string|null }} msg
   * @returns {object}
   */
  append({ source, text = "", emoji = null, image = null, url = null }) {
    this._cursor += 1;
    const message = {
      id: this._cursor,
      cursor: this._cursor,
      source,
      text: text ?? "",
      emoji: emoji ?? null,
      ts: Date.now(),
    };
    // Optional rich-content fields (e.g. a pasted image). Only attached when
    // present so plain text/emoji messages keep their existing shape.
    if (image) message.image = image; // absolute filesystem path (for local agents)
    if (url) message.url = url; //       browser-fetchable URL (served by the app)
    this.messages.push(message);
    if (this.messages.length > this.max) {
      this.messages.splice(0, this.messages.length - this.max);
    }
    return message;
  }

  /**
   * Return messages after the given cursor, plus the latest cursor to poll with next.
   * @param {number} since
   */
  getSince(since = 0) {
    const from = Number.isFinite(since) ? since : 0;
    const messages = this.messages.filter((m) => m.cursor > from);
    return { messages, cursor: this._cursor };
  }

  /** Latest cursor value. */
  get cursor() {
    return this._cursor;
  }
}
