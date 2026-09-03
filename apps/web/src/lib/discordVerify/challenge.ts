// ---------------------------------------------------------------------------
// The captcha challenge: issue one, then check an answer exactly once.
//
// ── WHAT THIS ACTUALLY DEFENDS ─────────────────────────────────────────────
//
// A picture captcha on a Discord server is not a serious anti-bot measure
// against a determined attacker — the image is fetchable and OCR is cheap. What
// it does defend against is the thing that actually happens to crypto servers:
// mass-joined throwaway accounts that immediately DM every member an airdrop
// scam. Those run on automation that will not stop to solve an image, and a
// gate that costs a human four seconds costs that operation its whole margin.
//
// So the design goal is "cheap for a person, annoying to automate", and the
// properties that matter follow from it:
//
//   BOUND TO ONE USER. The challenge records who it was issued to. Otherwise
//   one solved captcha could be handed round a group and replayed.
//
//   SINGLE USE, AND CONSUMED ON FAILURE TOO. A challenge that survives a wrong
//   answer is a guessing oracle. Attempts are capped and the record is deleted
//   the moment it is spent, so brute force costs a new image each time.
//
//   SHORT LIVED. Five minutes. A code harvested from a screenshot is worthless
//   by the time anyone finds it.
//
//   THE ANSWER NEVER TRAVELS. It lives in KV. It is not in the custom_id, not
//   in the image URL, and not in any field the client can read — the client
//   only ever sees a random id and a picture.
// ---------------------------------------------------------------------------

import { kvDel, kvGet, kvSet } from "@/lib/kv";

/** How long a member has to solve it. */
const TTL_SECONDS = 300;

/** Wrong answers allowed before the challenge is burned. */
const MAX_ATTEMPTS = 3;

/**
 * Alphabet for the code.
 *
 * No 0/O, no 1/I/L. A member who reads the picture correctly and still fails
 * because the font renders a one like an ell has been told the system is
 * broken, and they are not wrong.
 */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Code length. Five is ~28 bits of alphabet entropy — far beyond what the
 *  three-attempt cap allows anyone to guess. */
const CODE_LENGTH = 5;

export interface Challenge {
  code: string;
  userId: string;
  guildId: string;
  attempts: number;
  issuedAt: number;
}

const key = (id: string) => `discord:captcha:${id}`;

/** Cryptographic randomness, per the repo's rule against Math.random here. */
function randomFrom(alphabet: string, length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) {
    // Modulo bias across 256 % 31 is negligible for this purpose and the
    // alternative (rejection sampling) buys nothing a captcha cares about.
    out += alphabet[bytes[i]! % alphabet.length];
  }
  return out;
}

/** A URL-safe, unguessable id for the challenge and its image. */
function newId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Issue a challenge for one member. Returns the id; the code stays server-side. */
export async function issueChallenge(
  userId: string,
  guildId: string
): Promise<{ id: string } | null> {
  const id = newId();
  const challenge: Challenge = {
    code: randomFrom(ALPHABET, CODE_LENGTH),
    userId,
    guildId,
    attempts: 0,
    issuedAt: Date.now(),
  };
  try {
    await kvSet(key(id), challenge, TTL_SECONDS);
    return { id };
  } catch {
    return null;
  }
}

/** Read a challenge without consuming it — for rendering its image. */
export async function readChallenge(id: string): Promise<Challenge | null> {
  if (!/^[0-9a-f]{32}$/.test(id)) return null;
  try {
    return await kvGet<Challenge>(key(id));
  } catch {
    return null;
  }
}

export type CheckResult =
  | { ok: true }
  | { ok: false; reason: "expired" | "wrong-user" | "incorrect" | "exhausted"; attemptsLeft?: number };

/**
 * Check an answer, consuming the challenge on success or exhaustion.
 *
 * `wrong-user` is checked before the code so that another member cannot use a
 * challenge id they observed to probe the answer, even once.
 */
export async function checkChallenge(id: string, userId: string, answer: string): Promise<CheckResult> {
  const challenge = await readChallenge(id);
  if (!challenge) return { ok: false, reason: "expired" };

  if (challenge.userId !== userId) return { ok: false, reason: "wrong-user" };

  const given = answer.trim().toUpperCase();
  if (given === challenge.code) {
    // Consumed: a correct answer can never be replayed.
    await kvDel(key(id)).catch(() => {});
    return { ok: true };
  }

  const attempts = challenge.attempts + 1;
  if (attempts >= MAX_ATTEMPTS) {
    await kvDel(key(id)).catch(() => {});
    return { ok: false, reason: "exhausted" };
  }

  await kvSet(key(id), { ...challenge, attempts }, TTL_SECONDS).catch(() => {});
  return { ok: false, reason: "incorrect", attemptsLeft: MAX_ATTEMPTS - attempts };
}

export const CAPTCHA_CODE_LENGTH = CODE_LENGTH;
export const CAPTCHA_MAX_ATTEMPTS = MAX_ATTEMPTS;
