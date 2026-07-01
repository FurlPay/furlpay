import { Region, Stablecoin, StablecoinPolicy } from "./types";

// ---------------------------------------------------------------------------
// Stablecoin regulatory policy (Doc 3 §2).
//  - EU MiCA: only authorized EMTs/ARTs. Non-compliant (offshore USDT) is
//    auto-swapped to EURC/USDC for EEA users.
//  - US GENIUS Act: only payment stablecoins with 1:1 backing + audited monthly
//    reserve attestations (USDC, PYUSD).
// ---------------------------------------------------------------------------

// MiCA-authorized e-money tokens.
const MICA_COMPLIANT: Set<Stablecoin> = new Set(["USDC", "EURC"]);
// GENIUS-eligible payment stablecoins (audited monthly attestations).
const GENIUS_COMPLIANT: Set<Stablecoin> = new Set(["USDC", "PYUSD"]);

export function evaluateStablecoin(token: Stablecoin, region: Region): StablecoinPolicy {
  if (region === "EEA" || region === "UK") {
    if (!MICA_COMPLIANT.has(token)) {
      return {
        token,
        allowed: false,
        routedTo: "EURC",
        regime: "MiCA",
        reason: `MiCA: ${token} not an authorized EMT — auto-swap to EURC`,
      };
    }
    return { token, allowed: true, regime: "MiCA", reason: `${token} is MiCA-authorized` };
  }

  if (region === "US") {
    if (!GENIUS_COMPLIANT.has(token)) {
      return {
        token,
        allowed: false,
        routedTo: "USDC",
        regime: "GENIUS",
        reason: `GENIUS Act: ${token} lacks audited reserve attestation — auto-swap to USDC`,
      };
    }
    return { token, allowed: true, regime: "GENIUS", reason: `${token} is GENIUS-compliant` };
  }

  return { token, allowed: true, regime: "none", reason: "No regional stablecoin restriction" };
}
