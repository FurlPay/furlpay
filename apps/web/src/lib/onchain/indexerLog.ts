import { log } from "@/lib/log";

// ---------------------------------------------------------------------------
// Structured indexer events. One line per event with a stable `event` name so
// a log drain can alert and graph on them (e.g. count rpc_rate_limited by
// chain). Field values are scrubbed: RPC URLs routinely embed API keys, so any
// URL-shaped or key-shaped text is replaced before it is logged.
// ---------------------------------------------------------------------------

export type IndexerEvent =
  | "indexer_started"
  | "block_detected"
  | "block_indexed"
  | "range_split"
  | "rpc_rate_limited"
  | "rpc_unavailable"
  | "indexer_checkpoint_saved"
  | "indexer_reorg_detected"
  | "indexer_recovered"
  | "solana_slot_indexed"
  | "indexer_error"
  | "integrity_issue";

const URLISH = /\b(?:https?|wss?):\/\/[^\s"'<>]+/gi;
const KEYISH = /\b(?:api[-_]?key|apikey|token|secret|key)=([^&\s"']+)/gi;

/** Removes URLs and key=value secrets from free text. */
export function scrub(v: string): string {
  return v.replace(URLISH, "[url]").replace(KEYISH, (_m, _v) => `${_m.split("=")[0]}=[redacted]`);
}

function clean(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (/url|endpoint|secret|key|token/i.test(k)) continue; // never log these fields at all
    out[k] = typeof v === "string" ? scrub(v).slice(0, 300) : v;
  }
  return out;
}

const LEVEL: Record<IndexerEvent, "info" | "warn" | "error"> = {
  indexer_started: "info",
  block_detected: "info",
  block_indexed: "info",
  range_split: "info",
  rpc_rate_limited: "warn",
  rpc_unavailable: "warn",
  indexer_checkpoint_saved: "info",
  indexer_reorg_detected: "warn",
  indexer_recovered: "info",
  solana_slot_indexed: "info",
  indexer_error: "error",
  integrity_issue: "error",
};

export function indexerEvent(event: IndexerEvent, fields: Record<string, unknown> = {}): void {
  log[LEVEL[event]](event, { event, ...clean(fields) });
}
