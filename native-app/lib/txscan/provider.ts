import { api, ApiError, NetworkError } from "@/lib/api";
import type { AssetDelta, RiskLevel, ScanFinding, ScanResult, TxCategory } from "./types";

// ---------------------------------------------------------------------------
// Layer 2: provider-backed simulation.
//
// GOES THROUGH THE FURLPAY SERVER, NOT DIRECTLY TO THE VENDOR. Three reasons,
// and the first is the one that decides it:
//
//   1. The vendor API key would have to ship inside the APK. An APK is a zip
//      anyone can open, so that key is public the day the build is published,
//      and it is billed per call. Server-side it stays a server secret.
//   2. One server-side integration serves the mobile app, the extension and the
//      web app. Three clients each holding a key is three places to rotate.
//   3. The server can cache identical simulations and enforce its own rate
//      limit, which the vendor bills for and the phone cannot coordinate.
//
// THE ENDPOINT IS /api/security/scan — the calldata-level sibling of the
// existing /api/security/simulate, which screens economic signals for the send
// flow. Both fold into the same `screenTransaction` gate so there is one
// verdict, not two that can disagree.
//
// The boundary is complete on this side: request shape, response shape,
// timeout, error taxonomy and the degraded path are all defined here and
// exercised by tests. What it needs to add real chain-state simulation is a
// vendor contract plus FURLPAY_TX_SIMULATION_PROVIDER and
// FURLPAY_TX_SIMULATION_API_KEY set server-side. Without them the route still
// returns its local decode and marks `deepScanConfigured: false` rather than
// inventing a verdict.
//
// A FAILURE HERE IS NEVER A BLOCK. If the provider is down, unconfigured, slow
// or wrong, the local analyzer's verdict stands and the UI says the deeper
// check did not run. The alternative — refusing to sign when a third party is
// unreachable — hands an outage at a vendor the power to freeze a user's funds.
// ---------------------------------------------------------------------------

export interface SimulationRequest {
  chainId: number;
  from: string;
  to: string;
  value: string;
  data: string;
  /** The dApp origin, when the transaction came from a connected site. Providers
   *  score domain reputation, and omitting it discards their best signal. */
  origin?: string;
}

/** Wire shape returned by /api/security/simulate. */
interface SimulationResponse {
  provider: string;
  status: "ok" | "unavailable";
  /**
   * Whether a vendor actually simulated against chain state.
   *
   * SEPARATE FROM `status` because the two are genuinely different, and
   * collapsing them is how "we ran a server-side decode" turns into "we
   * simulated this transaction" in the UI. The route returns `ok` whenever its
   * own calldata decode succeeded — which is useful and is not a simulation.
   * Only this flag may set `simulated: true`.
   */
  deepScanConfigured?: boolean;
  reason?: string;
  riskLevel?: string;
  category?: string;
  findings?: Array<{ id?: string; level?: string; title?: string; detail?: string }>;
  deltas?: Array<{
    rawAmount?: string;
    decimals?: number;
    symbol?: string;
    contract?: string | null;
    kind?: string;
    tokenId?: string;
  }>;
  contract?: { address?: string; verified?: boolean; label?: string };
}

/**
 * Simulation must not hold up a confirmation sheet.
 *
 * 6s: long enough for a cold provider call plus our own hop, short enough that
 * a user staring at a spinner before a signature does not give up and assume
 * the app is broken. On timeout the local verdict renders immediately and the
 * sheet notes that the deep check did not finish.
 */
const SIMULATION_TIMEOUT_MS = 6_000;

export type SimulationOutcome =
  | { ok: true; result: Omit<ScanResult, "sources"> & { sources: string[] } }
  | { ok: false; reason: string; unconfigured: boolean };

export async function simulateWithProvider(req: SimulationRequest): Promise<SimulationOutcome> {
  try {
    const res = await withTimeout(
      api<SimulationResponse>("/security/scan", { method: "POST", body: req }),
      SIMULATION_TIMEOUT_MS,
    );

    if (res.status !== "ok") {
      return {
        ok: false,
        reason: res.reason ?? "The security provider is not available.",
        unconfigured: res.reason === "provider_unconfigured",
      };
    }

    return {
      ok: true,
      result: {
        level: normalizeLevel(res.riskLevel),
        category: normalizeCategory(res.category),
        findings: (res.findings ?? []).map(normalizeFinding),
        deltas: (res.deltas ?? []).map(normalizeDelta).filter((d): d is AssetDelta => d !== null),
        // Only a configured vendor counts as a simulation. The server-side
        // decode is a second opinion on the calldata, not a run against chain
        // state, and the confirmation sheet says different things about each.
        simulated: res.deepScanConfigured === true,
        sources: [res.provider || "provider"],
        contract: res.contract?.address
          ? { address: res.contract.address, verified: res.contract.verified === true, label: res.contract.label }
          : undefined,
      },
    };
  } catch (e) {
    if (e instanceof NetworkError) return { ok: false, reason: "You are offline, so the deep security check was skipped.", unconfigured: false };
    if (e instanceof ApiError) return { ok: false, reason: e.message, unconfigured: e.status === 501 };
    return { ok: false, reason: (e as Error).message, unconfigured: false };
  }
}

/**
 * An unrecognised level becomes `unknown`, never `safe`.
 *
 * A provider adding a new severity string in a future API version must not
 * silently downgrade to "safe" in an old client — that is a fail-open on the
 * exact value the whole call was made to learn.
 */
function normalizeLevel(raw: string | undefined): RiskLevel {
  switch ((raw ?? "").toLowerCase()) {
    case "safe":
    case "benign":
      return "safe";
    case "caution":
    case "warning":
    case "warn":
      return "caution";
    case "danger":
    case "malicious":
    case "critical":
      return "danger";
    default:
      return "unknown";
  }
}

const CATEGORIES: TxCategory[] = [
  "native_transfer",
  "token_transfer",
  "token_approval",
  "nft_transfer",
  "nft_approval_all",
  "swap",
  "contract_call",
  "signature",
  "unknown",
];

function normalizeCategory(raw: string | undefined): TxCategory {
  const v = (raw ?? "") as TxCategory;
  return CATEGORIES.includes(v) ? v : "unknown";
}

function normalizeFinding(f: { id?: string; level?: string; title?: string; detail?: string }): ScanFinding {
  return {
    id: f.id || "provider_finding",
    level: normalizeLevel(f.level),
    title: f.title || "Security notice",
    detail: f.detail || "",
  };
}

/**
 * Amounts arrive as decimal STRINGS and stay exact.
 *
 * JSON has one number type and it is a double; a wei value parsed as a JSON
 * number is already wrong before it reaches this function. A delta that cannot
 * be parsed is DROPPED rather than zeroed — a zero delta reads as "nothing
 * moves", which is the most dangerous possible misrendering.
 */
function normalizeDelta(d: {
  rawAmount?: string;
  decimals?: number;
  symbol?: string;
  contract?: string | null;
  kind?: string;
  tokenId?: string;
}): AssetDelta | null {
  if (typeof d.rawAmount !== "string") return null;
  let rawAmount: bigint;
  try {
    rawAmount = BigInt(d.rawAmount);
  } catch {
    return null;
  }
  const kind = d.kind === "erc20" || d.kind === "erc721" || d.kind === "erc1155" ? d.kind : "native";
  return {
    rawAmount,
    decimals: Number.isInteger(d.decimals) ? (d.decimals as number) : 18,
    symbol: d.symbol || "?",
    contract: d.contract ?? null,
    kind,
    tokenId: d.tokenId,
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The security check timed out.")), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
