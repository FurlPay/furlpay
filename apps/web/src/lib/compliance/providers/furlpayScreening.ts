// ---------------------------------------------------------------------------
// FurlPay built-in screening provider — wraps @furlpay/compliance for OFAC SDN
// name + wallet screening. Zero external API calls.
// ---------------------------------------------------------------------------

import { screenName, getOfacSdnList, screenWallet } from "@furlpay/compliance";
import type { NameScreenResult } from "@furlpay/compliance";
import type {
  ComplianceProvider, VerifyConfig, VerifySession, IdentityResult,
  AMLInput, AMLResult, PEPInput, PEPResult, SanctionsInput, SanctionsResult,
  AMLHit, WebhookPayload, RiskLevel,
} from "./types";

function mapDecision(decision: string): RiskLevel {
  if (decision === "block") return "critical";
  if (decision === "review") return "high";
  return "low";
}

function mapCandidates(result: NameScreenResult): AMLHit[] {
  return result.candidates.map((c) => ({
    name: c.entry.primaryName,
    matchScore: c.score,
    sources: [c.entry.listSource ?? "OFAC_SDN"],
    types: ["sanction"],
  }));
}

function amlBase(provider: string, searchRef: string) {
  return { screenedAt: Date.now(), provider, searchRef };
}

export class FurlPayScreeningProvider implements ComplianceProvider {
  readonly name = "furlpay";

  async startVerification(): Promise<VerifySession> {
    throw new Error("FurlPay screening is AML-only — use Persona/Sumsub for IDV");
  }

  async verifyIdentity(): Promise<IdentityResult> {
    throw new Error("FurlPay screening is AML-only — use Persona/Sumsub for IDV");
  }

  async screenAML(input: AMLInput): Promise<AMLResult> {
    const list = getOfacSdnList();
    const result = screenName({ name: input.name, dateOfBirth: input.dateOfBirth, country: input.country }, list);
    const ref = `furlpay-aml-${crypto.randomUUID()}`;
    return {
      matched: result.decision !== "allow",
      riskLevel: mapDecision(result.decision),
      hits: mapCandidates(result),
      ...amlBase("furlpay", ref),
    };
  }

  async screenPEP(_input: PEPInput): Promise<PEPResult> {
    // FurlPay's built-in list is OFAC SDN only — no PEP data.
    // Return clean result; use ComplyAdvantage for PEP screening.
    return {
      matched: false,
      riskLevel: "low",
      hits: [],
      ...amlBase("furlpay", `furlpay-pep-${crypto.randomUUID()}`),
    };
  }

  async screenSanctions(input: SanctionsInput): Promise<SanctionsResult> {
    const list = getOfacSdnList();
    const nameResult = screenName({ name: input.name, dateOfBirth: input.dateOfBirth, country: input.country }, list);
    const hits = mapCandidates(nameResult);
    let matched = nameResult.decision !== "allow";
    let riskLevel = mapDecision(nameResult.decision);

    // Also screen wallet addresses if provided
    if (input.walletAddresses?.length) {
      for (const addr of input.walletAddresses) {
        const wr = screenWallet(addr);
        if (wr.sanctioned) {
          matched = true;
          riskLevel = "critical";
          hits.push({
            name: addr,
            matchScore: 1.0,
            sources: ["OFAC_SDN_CRYPTO"],
            types: ["sanction"],
          });
        }
      }
    }

    return {
      matched,
      riskLevel,
      hits,
      ...amlBase("furlpay", `furlpay-sanctions-${crypto.randomUUID()}`),
    };
  }

  async verifyWebhook(): Promise<WebhookPayload> {
    throw new Error("FurlPay screening does not use webhooks");
  }
}
