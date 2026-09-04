import { randomBytes, timingSafeEqual } from "node:crypto";
import { kvGet, kvSet, kvDel } from "../../kv";
import { audit } from "../../audit";

// ---------------------------------------------------------------------------
// DM verification before any money is visible.
//
// A guild member is not a verified FurlPay user. Membership proves someone
// joined a server; it proves nothing about who they are, and a payout console
// that opened on membership alone would hand an account to anyone who clicked
// an invite link.
//
// So the console is gated behind a sequence, each step of which the member
// completes in their own DM:
//
//     CAPTCHA  → is this a person, or a raid script
//     EMAIL    → a contactable identity for receipts and recovery
//     PHONE    → a second factor that is expensive to farm at scale
//     WALLET   → proof they control the address that will receive money
//
// EVERY STEP IS BOUND TO ONE DISCORD SNOWFLAKE. A verification token issued to
// user A must be unusable by user B even if B obtains it — components
// round-trip through the client, so any of these payloads can be copied out of
// a DM and replayed by someone else. Binding is checked before the answer, so
// a wrong holder cannot even probe whether their guess was right.
//
// Progress is keyed on the snowflake alone, never on the guild, so a member who
// starts in the server and finishes in a DM continues the same run rather than
// starting over as a second identity.
// ---------------------------------------------------------------------------

export type VerificationStep = "captcha" | "email" | "phone" | "wallet";

export type VerificationStatus =
  /** Nothing started. */
  | "unverified"
  /** At least one step done, not all. */
  | "pending"
  /** Every required step complete. The console opens. */
  | "verified";

/** The order steps must be completed in. Cheap and anonymous first: a raid
 *  script should be turned away before it is asked for an email address. */
export const STEP_ORDER: readonly VerificationStep[] = ["captcha", "email", "phone", "wallet"];

export interface VerificationState {
  discordUserId: string;
  /** Steps completed, in no particular order. */
  completed: VerificationStep[];
  status: VerificationStatus;
  /** Contactable identity, once proven. Never a lookup key for the account. */
  email: string | null;
  phone: string | null;
  /** Checksummed address, proven by signature in the payouts ownership flow. */
  walletAddress: string | null;
  startedAt: string;
  updatedAt: string;
  verifiedAt: string | null;
}

/**
 * A single-use, user-bound, expiring token for one step.
 *
 * Held server-side and referenced by an unguessable id, so the DM component
 * carries only the id. Nothing secret travels in a Discord message.
 */
interface StepToken {
  id: string;
  discordUserId: string;
  step: VerificationStep;
  /** What the user must produce. For captcha this is the code; for email and
   *  phone the one-time code sent out of band. Never rendered back to them. */
  secret: string;
  attempts: number;
  issuedAt: number;
  expiresAt: number;
}

const MAX_ATTEMPTS = 3;
export const TOKEN_TTL_SECONDS = 10 * 60;
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, no 1/I/L
const CODE_LENGTH = 6;

const stateKey = (discordUserId: string) => `fp:verify:state:${discordUserId}`;
const tokenKey = (id: string) => `fp:verify:token:${id}`;

function randomCode(): string {
  const bytes = randomBytes(CODE_LENGTH * 2);
  let out = "";
  for (const b of bytes) {
    if (out.length === CODE_LENGTH) break;
    // Rejection-sample so no character is likelier than another.
    if (b >= 248) continue;
    out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  }
  return out.padEnd(CODE_LENGTH, CODE_ALPHABET[0]);
}

/** Constant-time compare so a wrong code cannot be narrowed by timing. */
function codesMatch(a: string, b: string): boolean {
  const x = Buffer.from(a.trim().toUpperCase(), "utf8");
  const y = Buffer.from(b.trim().toUpperCase(), "utf8");
  if (x.length !== y.length || x.length === 0) return false;
  return timingSafeEqual(x, y);
}

// ── state ──────────────────────────────────────────────────────────────────

export async function getState(discordUserId: string): Promise<VerificationState> {
  const existing = await kvGet<VerificationState>(stateKey(discordUserId));
  if (existing) return existing;
  const now = new Date().toISOString();
  return {
    discordUserId,
    completed: [],
    status: "unverified",
    email: null,
    phone: null,
    walletAddress: null,
    startedAt: now,
    updatedAt: now,
    verifiedAt: null,
  };
}

/** The next step this member owes, or null when they are done. */
export function nextStep(state: VerificationState): VerificationStep | null {
  return STEP_ORDER.find((s) => !state.completed.includes(s)) ?? null;
}

export function isVerified(state: VerificationState): boolean {
  return STEP_ORDER.every((s) => state.completed.includes(s));
}

async function saveState(state: VerificationState): Promise<VerificationState> {
  const done = isVerified(state);
  const next: VerificationState = {
    ...state,
    status: done ? "verified" : state.completed.length ? "pending" : "unverified",
    updatedAt: new Date().toISOString(),
    verifiedAt: done ? (state.verifiedAt ?? new Date().toISOString()) : null,
  };
  // No TTL. Verification is durable — expiring it would silently demote a
  // verified member back to unverified and hide their money from them.
  await kvSet(stateKey(next.discordUserId), next);
  return next;
}

// ── tokens ─────────────────────────────────────────────────────────────────

export interface IssuedToken {
  id: string;
  /** The code to deliver out of band (email/SMS), or to render as a captcha.
   *  NEVER put this in a Discord message for email/phone — the whole point is
   *  that the member proves they control the other channel. */
  secret: string;
  expiresAt: string;
}

export async function issueStepToken(
  discordUserId: string,
  step: VerificationStep
): Promise<IssuedToken> {
  const now = Date.now();
  const token: StepToken = {
    id: randomBytes(16).toString("hex"),
    discordUserId,
    step,
    secret: randomCode(),
    attempts: 0,
    issuedAt: now,
    expiresAt: now + TOKEN_TTL_SECONDS * 1000,
  };
  await kvSet(tokenKey(token.id), token, TOKEN_TTL_SECONDS);
  audit("verify.step_issued", discordUserId, { step });
  return {
    id: token.id,
    secret: token.secret,
    expiresAt: new Date(token.expiresAt).toISOString(),
  };
}

export type StepResult =
  | { ok: true; state: VerificationState; verified: boolean }
  | {
      ok: false;
      reason: "unknown_token" | "expired" | "wrong_user" | "incorrect" | "exhausted" | "bad_input";
      detail: string;
      attemptsLeft?: number;
    };

/**
 * Complete one step.
 *
 * ORDER OF CHECKS MATTERS. The holder is verified before the answer, so
 * someone who copied a token out of another member's DM cannot use it to test
 * whether a guess was correct — they are refused for being the wrong user
 * regardless of what they submit.
 */
export async function completeStep(input: {
  tokenId: string;
  discordUserId: string;
  answer: string;
  /** For email/phone/wallet: the value being proven. */
  value?: string;
}): Promise<StepResult> {
  const token = await kvGet<StepToken>(tokenKey(input.tokenId));
  if (!token) {
    return { ok: false, reason: "unknown_token", detail: "That verification has expired. Start again." };
  }

  // Binding first — see the header.
  if (token.discordUserId !== input.discordUserId) {
    audit("verify.step_failed", input.discordUserId, {
      step: token.step,
      reason: "wrong_user",
      issuedTo: token.discordUserId,
    });
    return { ok: false, reason: "wrong_user", detail: "That verification was not issued to you." };
  }

  if (Date.now() > token.expiresAt) {
    await kvDel(tokenKey(token.id));
    return { ok: false, reason: "expired", detail: "That verification has expired. Start again." };
  }

  if (!codesMatch(token.secret, input.answer)) {
    const attempts = token.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await kvDel(tokenKey(token.id));
      audit("verify.step_failed", input.discordUserId, { step: token.step, reason: "exhausted" });
      return { ok: false, reason: "exhausted", detail: "Too many incorrect attempts. Start again." };
    }
    await kvSet(tokenKey(token.id), { ...token, attempts }, TOKEN_TTL_SECONDS);
    return {
      ok: false,
      reason: "incorrect",
      detail: "That code is not correct.",
      attemptsLeft: MAX_ATTEMPTS - attempts,
    };
  }

  // Correct. Consume the token FIRST so a replay of this exact submission
  // cannot advance the state a second time.
  await kvDel(tokenKey(token.id));

  const state = await getState(input.discordUserId);
  if (state.completed.includes(token.step)) {
    // Already done — idempotent rather than an error, because a duplicate
    // Discord delivery must not read as a failure to the member.
    return { ok: true, state, verified: isVerified(state) };
  }

  const updated = await saveState({
    ...state,
    completed: [...state.completed, token.step],
    ...(token.step === "email" && input.value ? { email: input.value } : {}),
    ...(token.step === "phone" && input.value ? { phone: input.value } : {}),
    ...(token.step === "wallet" && input.value ? { walletAddress: input.value } : {}),
  });

  audit("verify.step_completed", input.discordUserId, { step: token.step });
  if (updated.status === "verified") {
    audit("verify.completed", input.discordUserId, { steps: updated.completed.length });
  }

  return { ok: true, state: updated, verified: updated.status === "verified" };
}

/**
 * Mark the wallet step complete from a signature proof.
 *
 * Separate from `completeStep` because a wallet is not proven by a code the
 * server chose — it is proven by a signature over a challenge, which the
 * payouts ownership module already verifies against the address. This records
 * the result of that verification; it does not perform it.
 */
export async function completeWalletStep(
  discordUserId: string,
  provenAddress: string
): Promise<VerificationState> {
  const state = await getState(discordUserId);
  if (state.completed.includes("wallet")) return state;
  const updated = await saveState({
    ...state,
    completed: [...state.completed, "wallet"],
    walletAddress: provenAddress,
  });
  audit("verify.step_completed", discordUserId, { step: "wallet" });
  if (updated.status === "verified") {
    audit("verify.completed", discordUserId, { steps: updated.completed.length });
  }
  return updated;
}
