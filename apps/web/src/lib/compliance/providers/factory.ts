// ---------------------------------------------------------------------------
// Provider factory — lazy-loads providers based on env config.
// ---------------------------------------------------------------------------

import type { ComplianceProvider } from "./types";

export type ProviderName = "persona" | "sumsub" | "complyadvantage" | "furlpay";

export async function createIdentityProvider(name: ProviderName): Promise<ComplianceProvider> {
  switch (name) {
    case "persona": {
      const { PersonaProvider } = await import("./persona");
      return new PersonaProvider();
    }
    case "sumsub": {
      const { SumsubProvider } = await import("./sumsub");
      return new SumsubProvider();
    }
    default:
      throw new Error(`Unknown identity provider: ${name}`);
  }
}

export async function createScreeningProvider(name: ProviderName): Promise<ComplianceProvider> {
  switch (name) {
    case "complyadvantage": {
      const { ComplyAdvantageProvider } = await import("./complyAdvantage");
      return new ComplyAdvantageProvider();
    }
    case "furlpay": {
      const { FurlPayScreeningProvider } = await import("./furlpayScreening");
      return new FurlPayScreeningProvider();
    }
    default:
      throw new Error(`Unknown screening provider: ${name}`);
  }
}

let _identity: ComplianceProvider | null = null;
let _screening: ComplianceProvider | null = null;

export async function getIdentityProvider(): Promise<ComplianceProvider> {
  if (!_identity) {
    const name = (process.env.COMPLIANCE_IDENTITY_PROVIDER || "persona") as ProviderName;
    _identity = await createIdentityProvider(name);
  }
  return _identity;
}

export async function getScreeningProvider(): Promise<ComplianceProvider> {
  if (!_screening) {
    const name = (process.env.COMPLIANCE_SCREENING_PROVIDER || "furlpay") as ProviderName;
    _screening = await createScreeningProvider(name);
  }
  return _screening;
}
