// ---------------------------------------------------------------------------
// ComplyAdvantage provider — AML / PEP / Sanctions / Adverse Media screening.
// ---------------------------------------------------------------------------

import crypto from "node:crypto";
import type {
  ComplianceProvider, VerifyConfig, VerifySession, IdentityResult,
  AMLInput, AMLResult, PEPInput, PEPResult, SanctionsInput, SanctionsResult,
  AMLHit, WebhookPayload, RiskLevel,
} from "./types";

const API_BASE = "https://api.complyadvantage.com";

function getApiKey(): string {
  const k = process.env.COMPLYADVANTAGE_API_KEY;
  if (!k) throw new Error("COMPLYADVANTAGE_API_KEY not set");
  return k;
}

function headers(): Record<string, string> {
  return {
    Authorization: `Token ${getApiKey()}`,
    "Content-Type": "application/json",
  };
}

async function caFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...headers(), ...init?.headers },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ComplyAdvantage API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

function mapHits(data: Record<string, unknown>): AMLHit[] {
  const hits = (data.hits as Array<Record<string, unknown>>) ?? [];
  return hits.map((h) => {
    const doc = (h.doc as Record<string, unknown>) ?? {};
    return {
      name: String(doc.name ?? h.match_name ?? ""),
      matchScore: typeof h.score === "number" ? h.score / 100 : 0.5,
      sources: Array.isArray(doc.sources) ? doc.sources.map((s: Record<string, unknown>) => String(s.name ?? "")) : [],
      types: Array.isArray(doc.types) ? doc.types.map(String) : [],
      listingUrl: typeof doc.url === "string" ? doc.url : undefined,
    };
  });
}

function riskFromHits(hits: AMLHit[], totalHits: number): RiskLevel {
  if (totalHits === 0) return "low";
  if (hits.some((h) => h.types.includes("sanction"))) return "critical";
  if (hits.some((h) => h.types.includes("pep"))) return "high";
  return "medium";
}

async function search(
  input: AMLInput,
  types: string[],
): Promise<{ hits: AMLHit[]; totalHits: number; searchId: string }> {
  const body = {
    search_term: input.name,
    client_ref: input.referenceId,
    fuzziness: 0.6,
    filters: {
      entity_type: input.entityType === "company" ? "company" : "person",
      types,
      ...(input.dateOfBirth ? { birth_year: input.dateOfBirth.split("-")[0] } : {}),
      ...(input.country ? { country_codes: [input.country.toUpperCase()] } : {}),
    },
    share_url: 1,
  };

  const json = await caFetch("/searches", { method: "POST", body: JSON.stringify(body) });
  const content = json.content ?? json;
  const data = content.data ?? {};
  return {
    hits: mapHits(data),
    totalHits: typeof data.total_hits === "number" ? data.total_hits : 0,
    searchId: String(data.id ?? content.id ?? ""),
  };
}

export class ComplyAdvantageProvider implements ComplianceProvider {
  readonly name = "complyadvantage";

  async startVerification(): Promise<VerifySession> {
    throw new Error("ComplyAdvantage is a screening-only provider. Use Persona/Sumsub for IDV.");
  }

  async verifyIdentity(): Promise<IdentityResult> {
    throw new Error("ComplyAdvantage is a screening-only provider. Use Persona/Sumsub for IDV.");
  }

  async screenAML(input: AMLInput): Promise<AMLResult> {
    const { hits, totalHits, searchId } = await search(input, ["sanction", "adverse-media"]);
    return {
      matched: totalHits > 0,
      riskLevel: riskFromHits(hits, totalHits),
      hits,
      screenedAt: Date.now(),
      provider: "complyadvantage",
      searchRef: searchId,
    };
  }

  async screenPEP(input: PEPInput): Promise<PEPResult> {
    const { hits, totalHits, searchId } = await search(input, ["pep"]);
    return {
      matched: totalHits > 0,
      riskLevel: totalHits > 0 ? "high" : "low",
      hits,
      screenedAt: Date.now(),
      provider: "complyadvantage",
      searchRef: searchId,
    };
  }

  async screenSanctions(input: SanctionsInput): Promise<SanctionsResult> {
    const { hits, totalHits, searchId } = await search(input, ["sanction"]);
    return {
      matched: totalHits > 0,
      riskLevel: totalHits > 0 ? "critical" : "low",
      hits,
      screenedAt: Date.now(),
      provider: "complyadvantage",
      searchRef: searchId,
    };
  }

  async verifyWebhook(rawBody: string | Buffer, signature: string): Promise<WebhookPayload> {
    const secret = process.env.COMPLYADVANTAGE_WEBHOOK_SECRET;
    if (!secret) throw new Error("COMPLYADVANTAGE_WEBHOOK_SECRET not set");

    const bodyStr = typeof rawBody === "string" ? rawBody : rawBody.toString("utf-8");
    const expected = crypto.createHmac("sha256", secret).update(bodyStr).digest("hex");

    const sigBuf = Buffer.from(signature, "hex");
    const expBuf = Buffer.from(expected, "hex");
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      throw new Error("ComplyAdvantage webhook signature verification failed");
    }

    const event = JSON.parse(bodyStr);
    return {
      provider: "complyadvantage",
      eventType: event.type ?? "unknown",
      referenceId: event.client_ref ?? "",
      status: "completed",
      rawEvent: event,
      timestamp: Date.now(),
    };
  }
}
