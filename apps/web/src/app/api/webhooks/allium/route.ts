import { NextResponse } from "next/server";
import zlib from "zlib";
import { verifyBeam } from "@/lib/onchain/beamAuth";
import { normalizeBeamRecord, type Transfer } from "@/lib/onchain/normalize";
import { deadLetter, persist, scopeTransfers } from "@/lib/onchain/ingest";
import { sbRpc, sbSelect, supabaseBackend } from "@/lib/supabase";
import { limit, rateLimitIdentity } from "@/lib/rateLimit";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/webhooks/allium — Allium Beam webhook sink (WEBHOOK_VERIFIED).
//
// Order of operations, each a gate:
//   1. size + content-type limits (before reading or hashing anything big)
//   2. HMAC over the RAW body per Beam's documented scheme (lib/onchain/beamAuth)
//   3. zstd decompression, only after the signature verified, bounded output
//   4. nonce checked (a nonce already processed -> 200 "replay"); claimed after the write
//   5. normalize (documented erc20_token_transfer columns; exact amounts only)
//   6. scope: only addresses FurlPay tracks; others are counted and dropped
//   7. onchain_ingest: idempotent on event_key, reorg-aware, rollup refreshed
//
// Status codes are chosen for at-least-once delivery: 401 for anything that
// failed authentication; 503 when FurlPay's own store is down (the provider
// should redeliver); 200 for everything that authenticated — including
// records we cannot use, which are dead-lettered instead of bounced, so a
// malformed record can never put the sink into an infinite retry loop.
//
// Nothing here moves money or touches the ledger.

const MAX_BODY = 1_000_000;
const MAX_DECODED = 8_000_000;
const MAX_RECORDS = 500;

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

export async function POST(req: Request) {
  const rl = await limit(`webhooks.allium:${rateLimitIdentity(req)}`, { limit: 6_000, windowMs: 60_000 });
  if (!rl.ok) return json({ error: "rate_limited" }, 429);

  const ctype = (req.headers.get("content-type") ?? "").toLowerCase();
  if (!ctype.startsWith("application/json")) return json({ error: "unsupported_media_type" }, 415);
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY) return json({ error: "payload_too_large" }, 413);
  const raw = Buffer.from(await req.arrayBuffer());
  if (raw.length > MAX_BODY) return json({ error: "payload_too_large" }, 413);

  const auth = verifyBeam(req.headers, raw);
  if (!auth.ok) {
    if (auth.reason !== "not_configured") log.warn("allium webhook rejected", { reason: auth.reason });
    return json({ error: auth.reason === "not_configured" ? "webhook_not_configured" : "unauthorized" }, auth.status);
  }
  if (supabaseBackend !== "supabase") return json({ error: "store_unavailable" }, 503);

  let body: Buffer = raw;
  const enc = (req.headers.get("content-encoding") ?? "").toLowerCase();
  if (enc === "zstd") {
    const z = zlib as unknown as { zstdDecompressSync?: (b: Buffer, o?: { maxOutputLength?: number }) => Buffer };
    if (typeof z.zstdDecompressSync !== "function") return json({ error: "zstd_unsupported_runtime" }, 415);
    try {
      body = z.zstdDecompressSync(raw, { maxOutputLength: MAX_DECODED });
    } catch {
      await deadLetter("allium_beam", "zstd decode failed", { bytes: raw.length }).catch(() => {});
      return json({ status: "dead_lettered", reason: "bad_encoding" });
    }
  } else if (enc && enc !== "identity") {
    return json({ error: "unsupported_content_encoding" }, 415);
  }

  // Replay protection beyond the timestamp window. The nonce is only CLAIMED
  // after a successful write (below): if our store fails mid-way and the
  // provider redelivers the same signed request, it must be processed, not
  // dropped as a replay. Processing twice is harmless — writes are idempotent.
  try {
    const seen = await sbSelect<{ nonce: string }>("onchain_webhook_nonces", `select=nonce&nonce=eq.${auth.nonce}&limit=1`);
    if (seen.length > 0) return json({ status: "replay" });
  } catch (e) {
    log.error("allium webhook nonce store unavailable", { error: (e as Error).message.slice(0, 160) });
    return json({ error: "store_unavailable" }, 503);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body.toString("utf8"));
  } catch {
    await deadLetter("allium_beam", "invalid JSON", { bytes: body.length }).catch(() => {});
    return json({ status: "dead_lettered", reason: "invalid_json" });
  }
  const records = Array.isArray(payload) ? payload : [payload];
  if (records.length > MAX_RECORDS) {
    await deadLetter("allium_beam", `batch of ${records.length} exceeds ${MAX_RECORDS}`, { count: records.length }).catch(() => {});
    return json({ status: "dead_lettered", reason: "batch_too_large" });
  }

  const url = new URL(req.url);
  const chainHint = url.searchParams.get("chain");
  const zerolag = process.env.ALLIUM_BEAM_ZEROLAG === "1";
  const transfers: Transfer[] = [];
  let rejected = 0;
  for (const r of records) {
    const n = normalizeBeamRecord(r, { chain: chainHint, zerolag });
    if (n.ok) transfers.push(...n.transfers);
    else {
      rejected++;
      await deadLetter("allium_beam", n.reason, r).catch(() => {});
    }
  }

  try {
    const { scoped, ignored } = await scopeTransfers(transfers);
    const counts = await persist(scoped);
    await sbRpc<boolean>("onchain_claim_nonce", { p_nonce: auth.nonce });
    return json({ status: "ok", received: records.length, rejected, out_of_scope: ignored, ...counts });
  } catch (e) {
    // Our store failed mid-way. The nonce is not claimed, so the provider's
    // redelivery is processed; every write is idempotent on event_key.
    log.error("allium webhook ingest failed", { error: (e as Error).message.slice(0, 200) });
    return json({ error: "ingest_unavailable" }, 503);
  }
}
