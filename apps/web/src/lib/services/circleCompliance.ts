import { randomUUID } from "crypto";
import type { AmlScreenResult } from "@furlpay/compliance";
import { log } from "@/lib/log";

// ---------------------------------------------------------------------------
// Circle Compliance Engine — blockchain address screening.
//
// Built against Circle's published OpenAPI (developers.circle.com/openapi/
// compliance.yaml, fetched 2026-10-02):
//
//   POST https://api.circle.com/v1/w3s/compliance/screening/addresses
//   Authorization: Bearer <PREFIX:ID:SECRET>
//   body     { idempotencyKey: uuid, address, chain: <Circle chain enum> }
//   response { data: { result: "APPROVED"|"DENIED", decision: { ruleName?,
//              actions?: ("APPROVE"|"REVIEW"|"FREEZE_WALLET"|"DENY")[],
//              reasons?: [{ riskScore, riskCategories[], type, ... }],
//              screeningDate }, id, address, chain, details } }
//
// The response is read defensively: the spec's top-level object is accepted
// with or without the `data` envelope Circle wraps W3S responses in.
//
// FAILS CLOSED once configured: a network error, non-2xx, or a shape that does
// not carry `result` is a BLOCK, never an allow. Not configured is different:
// screenAddressCircle returns null and the caller keeps OFAC as the only layer,
// which is exactly today's behaviour (lib/compliance/addressScreening.ts).
// ---------------------------------------------------------------------------

/** FurlPay chain slug → Circle compliance `Chain` enum. Base is not in Circle's enum. */
const CIRCLE_CHAIN: Record<string, string> = {
  ethereum: "ETH",
  polygon: "MATIC",
  arbitrum: "ARB",
  avalanche: "AVAX",
  optimism: "OP",
  solana: "SOL",
};

const API = () => (process.env.CIRCLE_COMPLIANCE_API_URL || "https://api.circle.com").replace(/\/+$/, "");
const KEY = () => (process.env.CIRCLE_COMPLIANCE_API_KEY ?? "").trim();

export function circleComplianceConfigured(): boolean {
  return KEY().length > 0;
}

export function circleChainFor(chain: string): string | null {
  return CIRCLE_CHAIN[chain.toLowerCase()] ?? null;
}

const TTL_MS = 60_000;
const MAX_CACHE = 1_000;
const cache = new Map<string, { result: AmlScreenResult; at: number }>();
export function clearCircleComplianceCache(): void {
  cache.clear();
}

type Action = "APPROVE" | "REVIEW" | "FREEZE_WALLET" | "DENY";
interface Reason {
  riskScore?: string;
  riskCategories?: string[];
}
interface ScreeningBody {
  result?: string;
  decision?: { ruleName?: string; actions?: Action[]; reasons?: Reason[] };
}

const SCORE: Record<string, number> = { UNKNOWN: 0, LOW: 10, MEDIUM: 50, HIGH: 80, SEVERE: 100, BLOCKLIST: 100 };

/** Map Circle's decision onto the AmlScreenResult every FurlPay caller reads. Exported for tests. */
export function mapCircleDecision(address: string, body: ScreeningBody): AmlScreenResult | null {
  if (body.result !== "APPROVED" && body.result !== "DENIED") return null;
  const actions = body.decision?.actions ?? [];
  const reasons = body.decision?.reasons ?? [];
  const categories = [...new Set(reasons.flatMap((r) => r.riskCategories ?? []).map((c) => c.toLowerCase()))];
  const score = Math.max(0, ...reasons.map((r) => SCORE[r.riskScore ?? "UNKNOWN"] ?? 0));
  const sanctioned = categories.includes("sanctions") || reasons.some((r) => r.riskScore === "BLOCKLIST");

  const block = body.result === "DENIED" || actions.includes("DENY") || actions.includes("FREEZE_WALLET") || sanctioned;
  const review = !block && actions.includes("REVIEW");
  return {
    address,
    provider: "circle",
    risk: block ? "severe" : review ? (score >= 80 ? "high" : "medium") : score >= 50 ? "medium" : "low",
    score: block ? Math.max(score, 100) : score,
    sanctioned,
    categories,
    action: block ? "block" : review ? "review" : "allow",
  };
}

function failClosed(address: string, cause: string): AmlScreenResult {
  log.error("circle compliance failed closed", { cause, address: `${address.slice(0, 6)}…` });
  return {
    address,
    provider: "circle",
    risk: "severe",
    score: 100,
    sanctioned: false,
    categories: ["screening_unavailable"],
    action: "block",
  };
}

/**
 * Screen one address with Circle. Returns null when Circle is not configured
 * or does not cover the chain (the caller then relies on OFAC alone, and the
 * caller records that). Never throws.
 */
export async function screenAddressCircle(
  address: string,
  chain: string,
  opts: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {}
): Promise<AmlScreenResult | null> {
  if (!circleComplianceConfigured()) return null;
  const circleChain = circleChainFor(chain);
  if (!circleChain) return null;

  const key = `${circleChain}:${address.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.result;

  let res: Response;
  try {
    res = await (opts.fetchImpl ?? fetch)(`${API()}/v1/w3s/compliance/screening/addresses`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${KEY()}` },
      body: JSON.stringify({ idempotencyKey: randomUUID(), address, chain: circleChain }),
      cache: "no-store",
      signal: opts.signal ?? AbortSignal.timeout(8_000),
    });
  } catch (e) {
    return failClosed(address, `network: ${(e as Error).name}`);
  }
  if (!res.ok) return failClosed(address, `http_${res.status}`);

  let json: { data?: ScreeningBody } & ScreeningBody;
  try {
    json = await res.json();
  } catch {
    return failClosed(address, "non_json");
  }
  const mapped = mapCircleDecision(address, json.data ?? json);
  if (!mapped) return failClosed(address, "unexpected_shape");

  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value!);
  cache.set(key, { result: mapped, at: Date.now() });
  return mapped;
}
