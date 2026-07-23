// ---------------------------------------------------------------------------
// Persona provider — identity verification via the Persona API.
//
// Persona is used for Gov ID + Selfie + Liveness. AML screening is delegated
// to a dedicated screening provider (ComplyAdvantage or built-in).
// ---------------------------------------------------------------------------

import crypto from "node:crypto";
import type {
  ComplianceProvider, VerifyConfig, VerifySession, IdentityResult,
  AMLInput, AMLResult, PEPInput, PEPResult, SanctionsInput, SanctionsResult,
  WebhookPayload, CheckResult, VerificationStatus, RiskLevel,
} from "./types";

const API_BASE = "https://api.withpersona.com/api/v1";
const API_VERSION = "2023-01-05";

function getApiKey(): string {
  const key = process.env.PERSONA_API_KEY;
  if (!key) throw new Error("PERSONA_API_KEY not set");
  return key;
}

function getTemplateId(config?: VerifyConfig): string {
  return config?.templateId ?? process.env.NEXT_PUBLIC_PERSONA_TEMPLATE_ID ?? "";
}

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${getApiKey()}`,
    "Persona-Version": API_VERSION,
    "Key-Inflection": "camel",
    "Content-Type": "application/json",
  };
}

async function personaFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers: { ...headers(), ...init?.headers } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Persona API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

function mapStatus(raw: string): VerificationStatus {
  const m: Record<string, VerificationStatus> = {
    completed: "completed", approved: "completed",
    failed: "failed", declined: "failed",
    expired: "expired",
    "needs_review": "requires_review", "pending": "pending",
    created: "pending", started: "in_progress",
  };
  return m[raw] ?? "pending";
}

function mapRisk(checks: CheckResult[]): RiskLevel {
  if (checks.some((c) => !c.passed && c.confidence > 0.8)) return "high";
  if (checks.some((c) => !c.passed)) return "medium";
  return "low";
}

export class PersonaProvider implements ComplianceProvider {
  readonly name = "persona";

  async startVerification(userId: string, config: VerifyConfig): Promise<VerifySession> {
    const body = {
      data: {
        attributes: {
          "inquiry-template-id": getTemplateId(config),
          "reference-id": config.referenceId || userId,
          ...(config.redirectUrl ? { "redirect-uri": config.redirectUrl } : {}),
        },
      },
    };
    const json = await personaFetch("/inquiries", { method: "POST", body: JSON.stringify(body) });
    const inq = json.data;
    const sessionToken = json.meta?.sessionToken ?? "";
    const env = process.env.NEXT_PUBLIC_PERSONA_ENV ?? "sandbox";
    return {
      sessionId: inq.id,
      sessionUrl: `https://withpersona.com/verify?inquiry-id=${inq.id}&environment=${env}&session-token=${sessionToken}`,
      provider: "persona",
      expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24h
      status: mapStatus(inq.attributes?.status ?? "created"),
    };
  }

  async verifyIdentity(sessionId: string): Promise<IdentityResult> {
    const json = await personaFetch(`/inquiries/${sessionId}`);
    const inq = json.data;
    const rawStatus = inq.attributes?.status ?? "pending";

    // Fetch verifications for this inquiry
    let checks: CheckResult[] = [];
    try {
      const vJson = await personaFetch(`/inquiries/${sessionId}/verifications`);
      const verifications = vJson.data ?? [];
      checks = verifications.map((v: Record<string, unknown>) => {
        const attrs = (v as { attributes?: Record<string, unknown> }).attributes ?? {};
        return {
          type: "GOV_ID" as const,
          passed: attrs.status === "passed",
          confidence: attrs.status === "passed" ? 1.0 : 0.0,
          details: { verificationId: v.id },
          reason: attrs.status === "passed" ? undefined : String(attrs.status ?? "unknown"),
        };
      });
    } catch {
      // Verifications may not be available yet
    }

    const mappedChecks = checks.length > 0 ? checks : [];
    return {
      status: mapStatus(rawStatus),
      riskLevel: mapRisk(mappedChecks),
      checks: mappedChecks,
      verifiedAt: rawStatus === "completed" || rawStatus === "approved" ? Date.now() : undefined,
      provider: "persona",
      providerRef: sessionId,
      rawProviderStatus: rawStatus,
    };
  }

  async screenAML(_input: AMLInput): Promise<AMLResult> {
    throw new Error("Persona is an IDV provider. Use ComplyAdvantage or FurlPay for AML screening.");
  }

  async screenPEP(_input: PEPInput): Promise<PEPResult> {
    throw new Error("Persona is an IDV provider. Use ComplyAdvantage or FurlPay for PEP screening.");
  }

  async screenSanctions(_input: SanctionsInput): Promise<SanctionsResult> {
    throw new Error("Persona is an IDV provider. Use ComplyAdvantage or FurlPay for sanctions screening.");
  }

  async verifyWebhook(rawBody: string | Buffer, signature: string): Promise<WebhookPayload> {
    const secret = process.env.PERSONA_WEBHOOK_SECRET;
    if (!secret) throw new Error("PERSONA_WEBHOOK_SECRET not set");

    // Persona signature format: t={timestamp},v1={sig}
    const parts: Record<string, string> = {};
    for (const part of signature.split(",")) {
      const [k, v] = part.split("=", 2);
      if (k && v) parts[k.trim()] = v.trim();
    }
    const ts = parts.t;
    const v1 = parts.v1;
    if (!ts || !v1) throw new Error("Invalid Persona-Signature header");

    const bodyStr = typeof rawBody === "string" ? rawBody : rawBody.toString("utf-8");
    const expected = crypto.createHmac("sha256", secret).update(`${ts}.${bodyStr}`).digest("hex");

    if (!crypto.timingSafeEqual(Buffer.from(v1, "hex"), Buffer.from(expected, "hex"))) {
      throw new Error("Persona webhook signature verification failed");
    }

    const event = JSON.parse(bodyStr);
    const attrs = event.data?.attributes ?? {};
    return {
      provider: "persona",
      eventType: attrs.name ?? event.data?.type ?? "unknown",
      referenceId: attrs.payload?.data?.attributes?.referenceId ?? "",
      status: mapStatus(attrs.payload?.data?.attributes?.status ?? "pending"),
      rawEvent: event,
      timestamp: Date.now(),
    };
  }
}
