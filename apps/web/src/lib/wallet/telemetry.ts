import { log } from "@/lib/log";

// ---------------------------------------------------------------------------
// Structured wallet events.
//
// Wallet failures were previously undiagnosable in production: a connection
// that never completes leaves no trace, and "it didn't work" is the entire
// bug report. This is the smallest abstraction that fixes that — it wraps the
// existing logger rather than introducing a telemetry provider.
//
// ── WHAT MAY NEVER BE LOGGED ───────────────────────────────────────────────
//
// The payload type is a CLOSED shape, not `Record<string, unknown>`, so the
// things that must never reach a log line cannot be passed in the first place:
// no private keys, no seed phrases, no signatures, no auth tokens, no raw
// provider payloads.
//
// Addresses are the interesting case. A wallet address is public on-chain, but
// in a log line it is a durable identifier for a person, and wallet debugging
// never needs the whole thing. `addr()` truncates to the standard 0xabcd…ef01
// display form — enough to correlate two lines, not enough to be a dataset.
//
// Raw provider error MESSAGES are also excluded: they are attacker- and
// vendor-controlled strings that end up in log aggregators. The classified
// `errorKind` is what is useful anyway.
// ---------------------------------------------------------------------------

export type WalletEventName =
  | "wallet_connect_started"
  | "wallet_connect_success"
  | "wallet_connect_rejected"
  | "wallet_connect_failed"
  | "wallet_account_changed"
  | "wallet_chain_changed"
  | "wallet_disconnected"
  | "wallet_provider_collision"
  | "wallet_reconnect_requested"
  | "wallet_provider_error";

/** The only fields a wallet event may carry. */
export interface WalletEventFields {
  /** EIP-6963 provider uuid. */
  uuid?: string;
  /** EIP-6963 reverse-DNS id. */
  rdns?: string;
  /** Classified error category — never the raw provider message. */
  errorKind?: string;
  chainId?: number;
  /** Previous chain, on a chain change. */
  fromChainId?: number;
  /** Truncated address only — use `addr()`. */
  account?: string;
  fromAccount?: string;
  /** Milliseconds. */
  durationMs?: number;
  /** Provider collision context. */
  incumbentUuid?: string;
  challengerUuid?: string;
  /** Why a session ended. */
  reason?: string;
}

/**
 * Truncate an address for logging: 0xabcd…ef01.
 *
 * Returns undefined for anything that is not a plausible address, so a
 * malformed value cannot be logged in full by accident.
 */
export function addr(address: string | null | undefined): string | undefined {
  if (!address || typeof address !== "string") return undefined;
  if (address.length < 10) return undefined;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * Emit a wallet event.
 *
 * Rejections are `info`, not `warn`: a user declining a wallet prompt is a
 * normal outcome, and logging it as a warning trains people to ignore
 * warnings. Genuine failures are `warn`.
 */
export function walletEvent(name: WalletEventName, fields: WalletEventFields = {}): void {
  const clean: Record<string, unknown> = { event: name };
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined && v !== null) clean[k] = v;
  }

  if (name === "wallet_connect_failed" || name === "wallet_provider_error") {
    log.warn("wallet", clean);
    return;
  }
  log.info("wallet", clean);
}
