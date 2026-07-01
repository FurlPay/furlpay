// ---------------------------------------------------------------------------
// Real-time device & behavioral risk engine (Sardine seam).
//   - Behavioral biometrics: typing cadence, motion, automation detection.
//   - Device fingerprinting: VM/emulator, VPN/proxy, rooted-device signals.
//   - Outcome gates whether the MPC signature co-signing proceeds.
// MOCK: deterministic scoring from the supplied signals.
// ---------------------------------------------------------------------------

export interface RiskSignals {
  deviceId?: string;
  ip?: string;
  vpn?: boolean;
  emulator?: boolean;
  automation?: boolean; // bot / remote-access tool detected
  newDevice?: boolean;
}

export interface RiskAssessment {
  score: number; // 0-100 (higher = riskier)
  level: "low" | "medium" | "high";
  signals: string[];
  action: "allow" | "challenge" | "block";
}

export function assessRisk(signals: RiskSignals): RiskAssessment {
  let score = 5;
  const flags: string[] = [];

  if (signals.automation) { score += 75; flags.push("automation/remote-access detected"); }
  if (signals.emulator) { score += 40; flags.push("emulator/VM detected"); }
  if (signals.vpn) { score += 20; flags.push("VPN/proxy in use"); }
  if (signals.newDevice) { score += 15; flags.push("new/unrecognized device"); }
  score = Math.min(100, score);

  let level: RiskAssessment["level"] = "low";
  if (score >= 70) level = "high";
  else if (score >= 30) level = "medium";

  let action: RiskAssessment["action"] = "allow";
  if (level === "high") action = "block";
  else if (level === "medium") action = "challenge";

  if (flags.length === 0) flags.push("no adverse device/behavioral signals");
  return { score, level, signals: flags, action };
}
