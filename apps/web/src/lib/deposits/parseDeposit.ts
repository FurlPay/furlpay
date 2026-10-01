import { CHAINS, TOKENS, type Chain, type Token } from "@furlpay/types";

// ---------------------------------------------------------------------------
// Parse a deposit-detect webhook payload into EXACT facts (audit P1-13).
//
// The old route did `Number(tx.value) / 10 ** decimals`: an 18-decimal token
// amount above ~0.009 units exceeds 2^53 base units and silently loses
// precision, and a payload missing `network` or `token` was quietly treated as
// "bsc" / "USDT". Money facts are now:
//   - base units as a BigInt, from a STRING (decimal digits or 0x-hex) — a
//     JSON number has already been through a float and is refused;
//   - an explicit `decimals` (0–36);
//   - an exact decimal string derived from those two, never a float;
//   - network, token, tx hash and log index all REQUIRED — nothing defaults.
// ---------------------------------------------------------------------------

export interface DepositFacts {
  chain: Chain;
  token: Token;
  txHash: string;
  logIndex: number;
  to: string;
  from: string;
  baseUnits: bigint;
  decimals: number;
  /** Exact decimal rendering of baseUnits / 10^decimals, e.g. "1000000.000000000000000000". */
  amount: string;
  confirmations: number;
}

export type ParseResult = { ok: true; facts: DepositFacts } | { ok: false; error: string };

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** Exact decimal string for base units at a scale. No float anywhere. */
export function formatUnits(baseUnits: bigint, decimals: number): string {
  const neg = baseUnits < 0n;
  const abs = neg ? -baseUnits : baseUnits;
  if (decimals === 0) return `${neg ? "-" : ""}${abs}`;
  const s = abs.toString().padStart(decimals + 1, "0");
  return `${neg ? "-" : ""}${s.slice(0, -decimals)}.${s.slice(-decimals)}`;
}

function parseBaseUnits(raw: unknown): bigint | null {
  if (typeof raw !== "string") return null; // numbers are refused: already lossy
  const v = raw.trim();
  if (/^0x[0-9a-fA-F]+$/.test(v)) return BigInt(v);
  if (/^\d+$/.test(v)) return BigInt(v);
  return null;
}

export function parseDepositPayload(payload: unknown): ParseResult {
  if (!payload || typeof payload !== "object") return { ok: false, error: "invalid_payload" };
  const p = payload as Record<string, unknown>;
  const tx = (p.transaction && typeof p.transaction === "object" ? p.transaction : p) as Record<string, unknown>;

  const network = p.network ?? tx.network;
  if (typeof network !== "string" || !network) return { ok: false, error: "network_required" };
  const chain = network.toLowerCase() as Chain;
  if (!CHAINS.includes(chain)) return { ok: false, error: `unsupported_network:${network}` };

  const tokenRaw = p.token ?? tx.token;
  if (typeof tokenRaw !== "string" || !tokenRaw) return { ok: false, error: "token_required" };
  const token = tokenRaw.toUpperCase() as Token;
  if (!TOKENS.includes(token)) return { ok: false, error: `unsupported_token:${tokenRaw}` };

  const txHash = String(tx.hash ?? tx.txHash ?? "");
  if (!TX_HASH.test(txHash)) return { ok: false, error: "tx_hash_required" };

  const logIndexRaw = tx.logIndex ?? p.logIndex;
  const logIndex = typeof logIndexRaw === "string" && /^\d+$/.test(logIndexRaw) ? Number(logIndexRaw) : logIndexRaw;
  if (typeof logIndex !== "number" || !Number.isSafeInteger(logIndex) || logIndex < 0) {
    return { ok: false, error: "log_index_required" };
  }

  const to = String(tx.to ?? "");
  const from = String(tx.from ?? "");
  if (!ADDRESS.test(to)) return { ok: false, error: "to_address_required" };

  const decimalsRaw = p.decimals ?? tx.decimals;
  const decimals = typeof decimalsRaw === "string" && /^\d+$/.test(decimalsRaw) ? Number(decimalsRaw) : decimalsRaw;
  if (typeof decimals !== "number" || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    return { ok: false, error: "decimals_required" };
  }

  const baseUnits = parseBaseUnits(p.rawValue ?? tx.rawValue ?? tx.value ?? p.value);
  if (baseUnits === null) return { ok: false, error: "amount_must_be_base_unit_string" };
  if (baseUnits <= 0n) return { ok: false, error: "amount_must_be_positive" };

  const confirmationsRaw = p.confirmations ?? tx.confirmations;
  const confirmations =
    typeof confirmationsRaw === "number" && Number.isInteger(confirmationsRaw) && confirmationsRaw >= 0
      ? confirmationsRaw
      : tx.blockNumber != null
        ? 1
        : 0;

  return {
    ok: true,
    facts: {
      chain,
      token,
      txHash: txHash.toLowerCase(),
      logIndex,
      to,
      from,
      baseUnits,
      decimals,
      amount: formatUnits(baseUnits, decimals),
      confirmations,
    },
  };
}

/** The deposit's identity: one per (chain, tx, log). */
export function depositKey(f: Pick<DepositFacts, "chain" | "txHash" | "logIndex">): string {
  return `deposit:${f.chain}:${f.txHash}:${f.logIndex}`;
}
