// Runtime configuration resolved in one place.
//
// The uploads directory is where pasted/dropped files are stored. Resolution
// order (highest precedence first):
//   1. (future) a user setting set via the UI, applied server-side — see
//      specs/proposals.md P2. Not implemented yet.
//   2. LOCUTUS_DATA_DIR environment variable (its `uploads/` subdir).
//   3. Default: <os tmpdir>/locutus/uploads — ephemeral, no repo pollution,
//      matches the MVP's in-memory "resets" feel.

import os from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

export function resolveDataDir() {
  return process.env.LOCUTUS_DATA_DIR || join(os.tmpdir(), "locutus");
}

/** Absolute path to the uploads directory; created if missing. */
export function ensureUploadsDir() {
  const dir = join(resolveDataDir(), "uploads");
  mkdirSync(dir, { recursive: true });
  return dir;
}
