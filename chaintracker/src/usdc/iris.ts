// Circle Iris — the CCTP attestation service.
//
// WHY THIS FILE IS NECESSARY, and it is not obvious. CCTP V1 emitted a uint64
// nonce in the source-chain `DepositForBurn` event, so a burn and its mint could
// be joined with two log reads and nothing else. CCTP V2 removed it: the nonce
// is assigned by Circle when the burn is attested, and the source chain's
// `MessageSent` payload carries thirty-two zero bytes in the nonce field. This
// was confirmed by decoding a live MessageSent on Base rather than assumed.
//
// So a V2 burn observed on chain has NO correlation key. The destination's
// `MessageReceived` event indexes the real nonce, which means without Iris we
// could see both legs of a $50M transfer and be unable to prove they were the
// same transfer. Iris closes that gap: given the burn's transaction hash it
// returns the assigned nonce, plus the decoded message and the attestation
// status.
//
// WHAT THIS CLIENT DOES NOT DO. It does not fetch attestation signatures for
// submission, and it never relays or executes anything — this is a read-only
// observer. It also never invents a nonce: an unattested burn stays unattested
// and is reported as still in flight, because "we do not know yet" and "matched"
// have to stay distinguishable in the table.
//
// Docs: developers.circle.com/api-reference/cctp/all/get-messages-v2

import { makeLogger } from "../util/logger.js";
import { cctpDomainName } from "./registry.js";

const log = makeLogger("usdc:iris");

const IRIS_MAINNET = "https://iris-api.circle.com";

/** Iris is keyless and shared. Kept deliberately slow — see requestSlot(). */
const MIN_REQUEST_GAP_MS = 250;
const REQUEST_TIMEOUT_MS = 10_000;

export interface IrisMessage {
  /** bytes32 hex. Circle's authoritative correlation key. */
  eventNonce: string;
  sourceDomain: number;
  destinationDomain: number;
  sender: string;
  recipient: string;
  /** Burned amount in USDC (already scaled out of 6-decimal base units). */
  amount: number | null;
  mintRecipient: string | null;
  burnToken: string | null;
  /** Fee actually taken, in USDC. null when the message is not yet executed. */
  feeExecuted: number | null;
  maxFee: number | null;
  cctpVersion: 1 | 2;
  status: "complete" | "pending_confirmations" | string;
  /** Circle's own reason a transfer is held up, when it gives one. */
  delayReason: string | null;
  attested: boolean;
}

/**
 * Serialise outbound calls with a floor on the gap between them.
 *
 * Iris is an unauthenticated public service shared by every CCTP integrator.
 * Bursting it during a backfill is how an IP gets throttled, and a throttled
 * Iris degrades the whole correlation layer to the heuristic path — so the
 * ceiling is self-imposed rather than discovered by being blocked.
 */
let lastRequestAt = 0;
let queue: Promise<unknown> = Promise.resolve();

function requestSlot<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = MIN_REQUEST_GAP_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
    return fn();
  });
  // The queue must not retain the result, and a rejection must not poison the
  // chain for every later caller.
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** 6-decimal base-unit string to a USDC number, or null if unparseable. */
function toUsdc(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return n / 1e6;
}

function toInt(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

interface RawIrisResponse {
  messages?: Array<{
    message?: string;
    eventNonce?: string;
    attestation?: string | null;
    cctpVersion?: number;
    status?: string;
    delayReason?: string | null;
    decodedMessage?: {
      sourceDomain?: string;
      destinationDomain?: string;
      nonce?: string;
      sender?: string;
      recipient?: string;
      decodedMessageBody?: {
        burnToken?: string;
        mintRecipient?: string;
        amount?: string;
        messageSender?: string;
        maxFee?: string;
        feeExecuted?: string;
      };
    };
  }>;
}

/**
 * Look up the CCTP messages emitted by one source transaction.
 *
 * Returns an empty array when Circle has not indexed the transaction yet, which
 * is the normal state for a burn observed seconds ago — it is not an error and
 * must not be logged as one, or a busy chain fills the log with noise.
 *
 * Returns null when the lookup itself failed (network, 5xx, malformed body).
 * The distinction matters: empty means "ask again later", null means "we learned
 * nothing and should not advance any state".
 */
export async function messagesForTx(
  sourceDomain: number,
  txHash: string,
): Promise<IrisMessage[] | null> {
  const url = `${IRIS_MAINNET}/v2/messages/${sourceDomain}?transactionHash=${encodeURIComponent(txHash)}`;

  return requestSlot(async () => {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      log.debug("iris unreachable", {
        domain: sourceDomain,
        chain: cctpDomainName(sourceDomain),
        error: (err as Error).message.slice(0, 120),
      });
      return null;
    }

    // 404 is Circle's answer for "no such message", which for a fresh burn just
    // means not indexed yet. Treated as empty, not as a failure.
    if (res.status === 404) return [];

    if (res.status === 429) {
      log.warn("iris rate-limited — correlation will fall back to the heuristic key");
      return null;
    }

    if (!res.ok) {
      log.debug("iris error status", { status: res.status, domain: sourceDomain });
      return null;
    }

    let body: RawIrisResponse;
    try {
      body = (await res.json()) as RawIrisResponse;
    } catch {
      return null;
    }

    const raw = Array.isArray(body.messages) ? body.messages : [];
    const out: IrisMessage[] = [];

    for (const m of raw) {
      const nonce = m.eventNonce ?? m.decodedMessage?.nonce;
      // A message with no nonce carries nothing we can correlate on. Skipping it
      // is correct; substituting a placeholder would create a row keyed on a
      // value that exists nowhere on chain.
      if (!nonce) continue;

      const d = m.decodedMessage ?? {};
      const b = d.decodedMessageBody ?? {};
      const version = m.cctpVersion === 1 ? 1 : 2;

      out.push({
        eventNonce: String(nonce),
        sourceDomain: toInt(d.sourceDomain) ?? sourceDomain,
        destinationDomain: toInt(d.destinationDomain) ?? -1,
        sender: d.sender ?? "",
        recipient: d.recipient ?? "",
        amount: toUsdc(b.amount),
        mintRecipient: b.mintRecipient ?? null,
        burnToken: b.burnToken ?? null,
        feeExecuted: toUsdc(b.feeExecuted),
        maxFee: toUsdc(b.maxFee),
        cctpVersion: version,
        status: m.status ?? "unknown",
        delayReason: m.delayReason ?? null,
        // An attestation present means Circle has signed it and the mint can
        // proceed. Circle also reports status 'complete'; either is sufficient.
        attested: Boolean(m.attestation) || m.status === "complete",
      });
    }

    return out;
  });
}

/**
 * The single message for a burn transaction, when there is exactly one.
 *
 * A CCTP transaction can batch several burns. When it does, picking "the" burn
 * is a guess, so this returns null and the caller keeps the heuristic key rather
 * than attaching the wrong nonce to a real transfer.
 */
export async function nonceForBurn(
  sourceDomain: number,
  txHash: string,
): Promise<IrisMessage | null> {
  const msgs = await messagesForTx(sourceDomain, txHash);
  if (msgs === null || msgs.length === 0) return null;
  if (msgs.length > 1) {
    log.debug("multi-burn transaction — leaving correlation to the match key", {
      tx: txHash,
      count: msgs.length,
    });
    return null;
  }
  return msgs[0] ?? null;
}

/**
 * Deterministic fallback correlation key.
 *
 * Both sides of a transfer can compute this without talking to Circle: the burn
 * knows its destination domain, amount and mint recipient, and the destination's
 * `MessageReceived` body carries the same three. It is a strong match but not a
 * proof — two identical transfers between the same pair of addresses in the same
 * window would collide — so a row matched this way records `correlation:
 * 'heuristic'` and the embed says the pairing is inferred.
 *
 * The amount is quantised to whole base units so a float round-trip on either
 * side cannot break the match.
 */
export function cctpMatchKey(
  sourceDomain: number,
  destDomain: number,
  amountUsdc: number,
  mintRecipient: string,
): string {
  const units = Math.round(amountUsdc * 1e6);
  const recipient = mintRecipient.trim().toLowerCase().replace(/^0x0*/, "");
  return `${sourceDomain}:${destDomain}:${units}:${recipient}`;
}

export const IRIS_BASE_URL = IRIS_MAINNET;
