import { randomBytes, timingSafeEqual } from "node:crypto";
import { kvGet, kvSet, kvDel, kvIncr, kvIncrBy } from "../../kv";
import { audit } from "../../audit";
import { sendEmail } from "../../email";

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
  /**
   * Where the code was sent, for email and phone.
   *
   * SERVER-SIDE ON PURPOSE. It would be simpler to let the client submit the
   * address alongside the code, but then someone could receive a code at an
   * address they control and submit a different one — recording an identity
   * they never proved. The value written into the verification state is the
   * one the code actually went to.
   */
  destination?: string;
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
/** Attempts live under their own key so the counter can be incremented
 *  atomically rather than read, mutated and written back. */
const attemptKey = (id: string) => `fp:verify:attempts:${id}`;
/** Per-user issuance budget, so a script cannot mint tokens endlessly
 *  (and, once delivery is wired, cannot use FurlPay to send mail). */
const issueKey = (discordUserId: string) => `fp:verify:issue:${discordUserId}`;

function randomCode(): string {
  // Loops until it HAS the full length rather than padding a short result.
  //
  // The previous version drew a fixed 12 bytes, rejection-sampled, then
  // padEnd'd with the alphabet's first character. If seven or more bytes were
  // rejected the code ended in predictable "A"s — rare, but it silently
  // reduced entropy exactly when the sampler was working hardest, and a code
  // whose tail is guessable is a code with fewer characters than it claims.
  let out = "";
  while (out.length < CODE_LENGTH) {
    for (const b of randomBytes(CODE_LENGTH)) {
      if (out.length === CODE_LENGTH) break;
      // 248 = 8 x 31. Bytes at or above it would bias the first eight
      // characters of the alphabet, so they are discarded rather than folded.
      if (b >= 248) continue;
      out += CODE_ALPHABET[b % CODE_ALPHABET.length];
    }
  }
  return out;
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

/** How many tokens one member may mint per window. */
const MAX_ISSUE_PER_WINDOW = 5;
const ISSUE_WINDOW_SECONDS = 15 * 60;

export type IssueResult =
  | { ok: true; token: IssuedToken; delivered: "shown" | "email" | "not_delivered" }
  | { ok: false; reason: "rate_limited" | "delivery_failed"; detail: string };

/**
 * Mint a step token and, for email, actually send it.
 *
 * RATE LIMITED PER MEMBER. Without a budget a script could mint tokens
 * endlessly, and once delivery is wired that turns FurlPay into an open mail
 * relay pointed at any address the attacker supplies. The counter is an atomic
 * INCR, so racing requests cannot each read the same total.
 */
export async function issueStep(
  discordUserId: string,
  step: VerificationStep,
  destination?: string
): Promise<IssueResult> {
  const used = await kvIncr(issueKey(discordUserId), ISSUE_WINDOW_SECONDS);
  if (used > MAX_ISSUE_PER_WINDOW) {
    audit("verify.step_failed", discordUserId, { step, reason: "rate_limited" });
    return {
      ok: false,
      reason: "rate_limited",
      detail: "Too many verification attempts. Try again in a few minutes.",
    };
  }

  const token = await issueStepToken(discordUserId, step, destination);

  // The captcha code is SHOWN in Discord — that step proves a human is
  // present, not that they hold another channel. Email and phone codes must
  // travel out of band or they prove nothing at all.
  if (step === "captcha") return { ok: true, token, delivered: "shown" };

  if (step === "email") {
    if (!destination) {
      return { ok: false, reason: "delivery_failed", detail: "No email address was supplied." };
    }
    const sent = await sendEmail({
      to: destination,
      subject: "Your FurlPay verification code",
      category: "ops",
      text: [
        `Your FurlPay verification code is ${token.secret}`,
        "",
        "It expires in 10 minutes and can be used once.",
        "If you did not request this, ignore this message — nobody can act on it without the code.",
      ].join("\n"),
      html: `<p>Your FurlPay verification code is <strong>${token.secret}</strong></p><p>It expires in 10 minutes and can be used once. If you did not request this, ignore this message.</p>`,
    });

    // sendEmail degrades to a console log when RESEND_API_KEY is unset. That
    // is right for a newsletter and wrong here: a member cannot read a server
    // log, so reporting success would leave them waiting for a code that was
    // never sent. The mocked case is surfaced, not swallowed.
    if (!sent.ok) {
      return { ok: false, reason: "delivery_failed", detail: "Could not send the email. Try again shortly." };
    }
    if (sent.mocked) {
      return { ok: true, token, delivered: "not_delivered" };
    }
    return { ok: true, token, delivered: "email" };
  }

  // Phone: no SMS provider is configured on this deployment. Saying so beats
  // issuing a code nobody can receive.
  return { ok: true, token, delivered: "not_delivered" };
}

export async function issueStepToken(
  discordUserId: string,
  step: VerificationStep,
  destination?: string
): Promise<IssuedToken> {
  const now = Date.now();
  const token: StepToken = {
    id: randomBytes(16).toString("hex"),
    discordUserId,
    step,
    secret: randomCode(),
    destination,
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
    // ATOMIC. Read-then-write let two simultaneous wrong guesses both observe
    // the same count and both write back the same increment, so three attempts
    // could be spent as six. kvIncrBy is a single Redis INCRBY, so N racing
    // submissions consume N attempts and the cap holds.
    const attempts = await kvIncrBy(attemptKey(token.id), 1, TOKEN_TTL_SECONDS);
    if (attempts >= MAX_ATTEMPTS) {
      await kvDel(tokenKey(token.id));
      await kvDel(attemptKey(token.id));
      audit("verify.step_failed", input.discordUserId, { step: token.step, reason: "exhausted" });
      return { ok: false, reason: "exhausted", detail: "Too many incorrect attempts. Start again." };
    }
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
  await kvDel(attemptKey(token.id));

  const state = await getState(input.discordUserId);
  if (state.completed.includes(token.step)) {
    // Already done — idempotent rather than an error, because a duplicate
    // Discord delivery must not read as a failure to the member.
    return { ok: true, state, verified: isVerified(state) };
  }

  const updated = await saveState({
    ...state,
    completed: [...state.completed, token.step],
    // From the TOKEN, never from the submission — see StepToken.destination.
    ...(token.step === "email" && token.destination ? { email: token.destination } : {}),
    ...(token.step === "phone" && token.destination ? { phone: token.destination } : {}),
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
