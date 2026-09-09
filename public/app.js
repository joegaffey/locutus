// Frontend orchestration:
//  - Connect to the backend via Server-Sent Events (SSE), render transcript.
//  - Speak agent messages with the Web Speech API; bounce the emoji avatar while
//    speaking and show the agent-supplied emoji as the avatar's expression.
//  - Capture the user's voice via SpeechRecognition and POST it as a reply.
//  - Typed fallback input for browsers without a mic / recognition.

const DEFAULT_EMOJI = "🤖";

const els = {
  avatar: document.getElementById("avatar"),
  avatarEmoji: document.getElementById("avatarEmoji"),
  status: document.getElementById("status"),
  micBtn: document.getElementById("micBtn"),
  typeForm: document.getElementById("typeForm"),
  typeInput: document.getElementById("typeInput"),
  interim: document.getElementById("interim"),
  transcriptList: document.getElementById("transcriptList"),
};

// ---------------------------------------------------------------------------
// Speech synthesis (TTS) with a simple queue so utterances never overlap.
// ---------------------------------------------------------------------------
const speech = {
  supported: "speechSynthesis" in window,
  queue: [],
  speaking: false,

  enqueue(message) {
    // Always reflect the expression immediately.
    setAvatarEmoji(message.emoji || DEFAULT_EMOJI);

    const text = (message.text || "").trim();
    if (text === "") return; // emoji-only: expression change without speech

    if (!this.supported) {
      // No TTS: still animate briefly so the avatar feels alive.
      flashSpeaking();
      return;
    }
    // Arm the echo guard immediately (before speak()): speechSynthesis.onstart
    // can lag the actual audio by hundreds of ms, and the mic hears the audio at
    // once — so spokenWords must be set now, not at onstart/onend.
    noteSpokenText(text);
    micSuspendForTts();
    this.queue.push(text);
    this._drain();
  },

  _drain() {
    if (this.speaking || this.queue.length === 0) return;
    const text = this.queue.shift();
    const utter = new SpeechSynthesisUtterance(text);
    utter.onstart = () => {
      this.speaking = true;
      els.avatar.classList.add("speaking");
      // Arm the echo guard NOW (not at end): the recognizer can transcribe the
      // TTS audio before speechSynthesis fires onend, so spokenWords must be set
      // as soon as speech begins.
      noteSpokenText(text);
      micSuspendForTts();
    };
    const done = () => {
      this.speaking = false;
      els.avatar.classList.remove("speaking");
      // Refresh the guard window so echo arriving just after end is still caught.
      noteSpokenText(text);
      if (this.queue.length === 0) {
        // The recognizer kept running throughout; just update status. Any echo
        // of this utterance is stripped from transcripts (see stripEcho).
        micResumeAfterTts();
      }
      this._drain();
    };
    utter.onend = done;
    utter.onerror = done;
    window.speechSynthesis.speak(utter);
  },
};

// Echo handling: the mic keeps running while the avatar speaks (stopping it
// drops the first reply word due to engine warm-up). Instead, for a short guard
// window after TTS ends, any transcript that is really the avatar's own speech
// is stripped out by content — see stripEcho.
const ECHO_GUARD_MS = 2500; // after TTS ends, scrutinize results for this long
let micSuspendForTts = () => {};
let micResumeAfterTts = () => {};

let spokenWords = []; // normalized words the avatar recently spoke
let echoGuardUntil = 0; // timestamp until which we filter echo

function normalizeWords(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function noteSpokenText(text) {
  spokenWords = normalizeWords(text);
  echoGuardUntil = Date.now() + ECHO_GUARD_MS;
}

// Fuzzy word equality — STT may spell an echoed word differently than the TTS
// source (e.g. color/colour, favorite/favourite) or slur it slightly. Treat
// words as matching if they're equal, one is a prefix of the other, or their
// edit distance is small relative to length.
function wordsMatch(a, b) {
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) {
    return true;
  }
  const dist = editDistance(a, b);
  const maxLen = Math.max(a.length, b.length);
  return maxLen >= 4 && dist <= Math.max(1, Math.floor(maxLen / 5));
}

function editDistance(a, b) {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 3) return 99; // early out — too different
  const dp = Array.from({ length: m + 1 }, (_, i) => i);
  for (let j = 1; j <= n; j++) {
    let prev = dp[0];
    dp[0] = j;
    for (let i = 1; i <= m; i++) {
      const tmp = dp[i];
      dp[i] =
        a[i - 1] === b[j - 1]
          ? prev
          : 1 + Math.min(prev, dp[i], dp[i - 1]);
      prev = tmp;
    }
  }
  return dp[m];
}

// Remove an echo of the avatar's own speech from a transcript, returning the
// remaining (genuine) text. The echo appears as a contiguous run of the spoken
// words (matched fuzzily); STT often fuses it with the user's real reply in one
// transcript (e.g. "question one what did you have ... today cereal"). We locate
// the longest such run and, if long enough (>=4 words), strip it and keep the rest.
function stripEcho(transcript) {
  const words = normalizeWords(transcript);
  if (words.length === 0) return "";
  if (Date.now() > echoGuardUntil || spokenWords.length === 0) {
    return transcript.trim();
  }

  // Find the longest contiguous [start, start+len) in `words` that also appears
  // consecutively (fuzzily) somewhere in spokenWords.
  let bestStart = 0;
  let bestLen = 0;
  for (let i = 0; i < words.length; i++) {
    for (let j = 0; j < spokenWords.length; j++) {
      let run = 0;
      while (
        i + run < words.length &&
        j + run < spokenWords.length &&
        wordsMatch(words[i + run], spokenWords[j + run])
      ) {
        run++;
      }
      if (run > bestLen) {
        bestLen = run;
        bestStart = i;
      }
    }
  }

  // Not a meaningful echo run — treat the whole transcript as genuine.
  if (bestLen < 4) return transcript.trim();

  // Drop the echo span; keep words before and after it (the real reply).
  const kept = [...words.slice(0, bestStart), ...words.slice(bestStart + bestLen)];
  return kept.join(" ").trim();
}

let flashTimer = null;
function flashSpeaking() {
  els.avatar.classList.add("speaking");
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => els.avatar.classList.remove("speaking"), 700);
}

function setAvatarEmoji(emoji) {
  els.avatarEmoji.textContent = emoji;
}

// ---------------------------------------------------------------------------
// Transcript rendering
// ---------------------------------------------------------------------------
const seen = new Set();

function addToTranscript(message) {
  if (seen.has(message.cursor)) return;
  seen.add(message.cursor);

  const li = document.createElement("li");
  li.className = `msg msg--${message.source}`;

  const who = document.createElement("span");
  who.className = "msg__who";
  who.textContent = message.source === "user" ? "You" : "Agent";

  const text = document.createElement("span");
  text.className = "msg__text";
  const prefix = message.emoji ? `${message.emoji} ` : "";
  text.textContent = prefix + (message.text || "");

  li.append(who, text);

  // If the message carries an image, show a thumbnail (click opens full size).
  if (message.url) {
    const link = document.createElement("a");
    link.href = message.url;
    link.target = "_blank";
    link.rel = "noopener";
    link.className = "msg__thumb";
    const img = document.createElement("img");
    img.src = message.url;
    img.alt = message.text ? message.text : "pasted image";
    img.loading = "lazy";
    link.append(img);
    li.append(link);
  }

  els.transcriptList.append(li);
  els.transcriptList.scrollTop = els.transcriptList.scrollHeight;
}

function handleAgentMessage(message) {
  addToTranscript(message);
  if (message.source === "agent") {
    if ((message.text || "").trim() !== "") setStatus("Agent is speaking…");
    else setStatus("Agent changed its expression.");
    speech.enqueue(message);
  } else if (message.source === "user") {
    setStatus("You replied. Waiting for the agent…");
  }
}

// ---------------------------------------------------------------------------
// Live updates via Server-Sent Events (EventSource auto-reconnects natively).
// ---------------------------------------------------------------------------
function connect() {
  const es = new EventSource("/api/stream");

  es.addEventListener("open", () =>
    setStatus("Connected — ready when the agent speaks."),
  );

  es.addEventListener("history", (ev) => {
    try {
      const data = JSON.parse(ev.data);
      for (const m of data.messages) addToTranscript(m);
    } catch {
      /* ignore malformed */
    }
  });

  es.addEventListener("message", (ev) => {
    try {
      const data = JSON.parse(ev.data);
      if (data.message) handleAgentMessage(data.message);
    } catch {
      /* ignore malformed */
    }
  });

  es.addEventListener("error", () => {
    // EventSource reconnects on its own; just reflect the state.
    setStatus("Reconnecting…");
  });
}

function setStatus(text) {
  els.status.textContent = text;
}

// ---------------------------------------------------------------------------
// Sending user replies
// ---------------------------------------------------------------------------
async function sendUserMessage(text) {
  const trimmed = text.trim();
  if (trimmed === "") return;
  try {
    await fetch("/api/user/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: trimmed }),
    });
  } catch {
    setStatus("Failed to send reply. Check the connection.");
  }
}

els.typeForm.addEventListener("submit", (e) => {
  e.preventDefault();
  sendUserMessage(els.typeInput.value);
  els.typeInput.value = "";
});

// ---------------------------------------------------------------------------
// Paste an image into the room → upload it → appears as a user message with a
// thumbnail; the agent receives the file path/URL. (A CLI can't accept a pasted
// image; the browser bridges it — see specs/proposals.md P2.)
// ---------------------------------------------------------------------------
async function uploadImage(blob, caption = "") {
  setStatus("Uploading image…");
  try {
    const qs = caption ? `?text=${encodeURIComponent(caption)}` : "";
    const res = await fetch(`/api/upload${qs}`, {
      method: "POST",
      headers: { "Content-Type": blob.type || "image/png" },
      body: blob,
    });
    if (!res.ok) {
      setStatus("Image upload failed.");
      return;
    }
    setStatus("Image sent to the agent.");
  } catch {
    setStatus("Image upload failed. Check the connection.");
  }
}

document.addEventListener("paste", (e) => {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  for (const item of items) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const blob = item.getAsFile();
      if (blob) {
        e.preventDefault();
        // Use any text already typed in the reply box as the caption.
        const caption = els.typeInput.value.trim();
        els.typeInput.value = "";
        uploadImage(blob, caption);
      }
      return;
    }
  }
});

// ---------------------------------------------------------------------------
// Microphone + speech recognition (STT)
// ---------------------------------------------------------------------------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;

if (SR) {
  recognition = new SR();
  recognition.continuous = true; // keep listening until the user stops the mic
  recognition.interimResults = true;
  recognition.lang = "en-US";

  let micOn = false; // user's intent: is the mic toggled on?
  let lastInterim = ""; // most recent non-empty interim transcript

  function setMicUI(on) {
    els.micBtn.setAttribute("aria-pressed", on ? "true" : "false");
    els.micBtn.textContent = on ? "⏹ Stop" : "🎤 Speak";
  }

  recognition.onresult = (event) => {
    let interim = "";
    let final = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const r = event.results[i];
      if (r.isFinal) final += r[0].transcript;
      else interim += r[0].transcript;
    }
    if (final.trim()) {
      lastInterim = "";
      els.interim.textContent = "";
      const cleaned = stripEcho(final); // remove any echo of the avatar's speech
      if (cleaned) sendUserMessage(cleaned);
      return;
    }
    // Interim only. Keep the last NON-EMPTY interim so a trailing empty result
    // (which the engine emits when it resets) doesn't erase what we heard.
    if (interim.trim()) {
      // Show the echo-stripped interim (may be empty while only echo is heard).
      const cleaned = stripEcho(interim);
      lastInterim = cleaned;
      els.interim.textContent = cleaned;
    }
  };

  recognition.onend = () => {
    // Flush whatever we last heard that never got a final result (echo removed).
    const leftover = stripEcho(lastInterim);
    lastInterim = "";
    els.interim.textContent = "";
    if (leftover) sendUserMessage(leftover);
    // Keep listening while the user wants the mic on (auto-restart on pauses).
    if (micOn) {
      try {
        recognition.start();
        return;
      } catch {
        /* fall through to off */
      }
    }
    // Otherwise the user turned the mic off.
    if (!micOn) setMicUI(false);
  };

  recognition.onerror = (e) => {
    els.interim.textContent = "";
    if (e && (e.error === "not-allowed" || e.error === "service-not-allowed")) {
      micOn = false;
      setMicUI(false);
      setStatus("Microphone blocked — check browser permissions.");
    }
    // Other errors (no-speech, aborted, network) are handled by onend.
  };

  // --- TTS coordination ---
  // The recognizer is NOT stopped while the avatar speaks: stopping and
  // restarting it drops the first word of the reply (engine warm-up latency).
  // Instead it keeps running and stripEcho removes any echo of the avatar's
  // own speech from the transcript. These hooks just reflect status.
  micSuspendForTts = () => {
    if (micOn) setStatus("Agent is speaking…");
  };
  micResumeAfterTts = () => {
    if (micOn) setStatus("Listening… click again to stop.");
  };

  els.micBtn.addEventListener("click", () => {
    if (micOn) {
      // User stops the mic.
      micOn = false;
      lastInterim = "";
      setMicUI(false);
      try {
        recognition.stop();
      } catch {
        /* ignore */
      }
      setStatus("Ready — click the mic to reply.");
      return;
    }
    // User starts the mic.
    micOn = true;
    lastInterim = "";
    setMicUI(true);
    els.interim.textContent = "";
    setStatus("Listening… click again to stop.");
    try {
      recognition.start();
    } catch {
      /* start() throws if called while already active; ignore */
    }
  });
} else {
  // No speech recognition: disable mic and nudge toward typing.
  els.micBtn.disabled = true;
  els.micBtn.title = "Speech recognition not supported in this browser";
  els.micBtn.textContent = "🎤 (unsupported)";
}

// ---------------------------------------------------------------------------
// Go
// ---------------------------------------------------------------------------
setAvatarEmoji(DEFAULT_EMOJI);
connect();
