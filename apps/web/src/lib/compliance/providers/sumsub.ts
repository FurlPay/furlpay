// ---------------------------------------------------------------------------
// Sumsub provider — identity verification via the Sumsub API.
//
// Authentication: HMAC-SHA256 request signing.
// Sumsub is used for Gov ID + Selfie + Liveness. AML screening is delegated
// to a dedicated screening provider.
// ---------------------------------------------------------------------------

import crypto from "node:crypto";
import type {
  ComplianceProvider, VerifyConfig, VerifySession, IdentityResult,
  AMLInput, AMLResult, PEPInput, PEPResult, SanctionsInput, SanctionsResult,
  WebhookPayload, VerificationStatus,
} from "./types";

const API_BASE = "https://api.sumsub.com";

function getAppToken(): string {
  const t = process.env.SUMSUB_APP_TOKEN;
  if (!t) throw new Error("SUMSUB_APP_TOKEN not set");
  return t;
}

function getSecretKey(): string {
  const k = process.env.SUMSUB_SECRET_KEY;
  if (!k) throw new Error("SUMSUB_SECRET_KEY not set");
  return k;
}

/** Generate HMAC-SHA256 signature for Sumsub API request signing. */
function signRequest(method: string, path: string, body: string, ts: number): string {
  const data = `${ts}${method.toUpperCase()}${path}${body}`;
  return crypto.createHmac("sha256", getSecretKey()).update(data).digest("hex");
}

async function sumsubFetch(method: string, path: string, body?: unknown) {
  const ts = Math.floor(Date.now() / 1000);
  const bodyStr = body ? JSON.stringify(body) : "";
  const sig = signRequest(method, path, bodyStr, ts);

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-App-Token": getAppToken(),
      "X-App-Access-Sig": sig,
      "X-App-Access-Ts": String(ts),
    },
    ...(bodyStr ? { body: bodyStr } : {}),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Sumsub API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

function mapStatus(raw: string): VerificationStatus {
  const m: Record<string, VerificationStatus> = {
    init: "pending",
    pending: "in_progress",
    queued: "in_progress",
    completed: "completed",
    onHold: "requires_review",
    rejected: "failed",
  };
  return m[raw] ?? "pending";
}

export class SumsubProvider implements ComplianceProvider {
  readonly name = "sumsub";

  async startVerification(userId: string, config: VerifyConfig): Promise<VerifySession> {
    const levelName = config.levelName ?? "basic-kyc-level";

    // Create applicant
    const applicant = await sumsubFetch(
      "POST",
      `/resources/applicants?levelName=${encodeURIComponent(levelName)}`,
      { externalUserId: config.referenceId || userId },
    );
    const applicantId = applicant.id;

    // Generate SDK access token
    const tokenRes = await sumsubFetch("POST", "/resources/accessTokens/sdk", {
      userId: config.referenceId || userId,
      levelName,
      ttlInSecs: 600,
    });

    return {
      sessionId: applicantId,
      sessionUrl: `https://cockpit.sumsub.com/checkus#/applicant/${applicantId}`,
      provider: "sumsub",
      expiresAt: Date.now() + 600 * 1000,
      status: "pending",
    };
  }

  async verifyIdentity(sessionId: string): Promise<IdentityResult> {
    const applicant = await sumsubFetch("GET", `/resources/applicants/${sessionId}/one`);
    const rawStatus = applicant.review?.reviewStatus ?? applicant.reviewStatus ?? "init";

    return {
      status: mapStatus(rawStatus),
      riskLevel: rawStatus === "rejected" ? "high" : rawStatus === "completed" ? "low" : "medium",
      checks: [],
      verifiedAt: rawStatus === "completed" ? Date.now() : undefined,
      provider: "sumsub",
      providerRef: sessionId,
      rawProviderStatus: rawStatus,
    };
  }

  async screenAML(_input: AMLInput): Promise<AMLResult> {
    throw new Error("Sumsub is an IDV provider. Use ComplyAdvantage or FurlPay for AML screening.");
  }

  async screenPEP(_input: PEPInput): Promise<PEPResult> {
    throw new Error("Sumsub is an IDV provider. Use ComplyAdvantage or FurlPay for PEP screening.");
  }

  async screenSanctions(_input: SanctionsInput): Promise<SanctionsResult> {
    throw new Error("Sumsub is an IDV provider. Use ComplyAdvantage or FurlPay for sanctions screening.");
  }

  async verifyWebhook(rawBody: string | Buffer, signature: string): Promise<WebhookPayload> {
    const secret = process.env.SUMSUB_WEBHOOK_SECRET;
    if (!secret) throw new Error("SUMSUB_WEBHOOK_SECRET not set");

    const bodyStr = typeof rawBody === "string" ? rawBody : rawBody.toString("utf-8");
    const expected = crypto.createHmac("sha256", secret).update(bodyStr).digest("hex");

    const sigBuf = Buffer.from(signature, "hex");
    const expBuf = Buffer.from(expected, "hex");
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      throw new Error("Sumsub webhook signature verification failed");
    }

    const event = JSON.parse(bodyStr);
    return {
      provider: "sumsub",
      eventType: event.type ?? "unknown",
      referenceId: event.externalUserId ?? "",
      status: mapStatus(event.reviewStatus ?? "init"),
      rawEvent: event,
      timestamp: Date.now(),
    };
  }
}
