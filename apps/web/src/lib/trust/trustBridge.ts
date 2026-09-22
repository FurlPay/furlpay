import { type TrustAction, type DecisionRecord, assessTrust, explainDecision } from "./score";
import type { ObservedReason, ReasonCode } from "./reasons";

// ---------------------------------------------------------------------------
// Trust Bridge
//
// This module bridges legacy signal shapes (device intel, velocity, manual
// heuristics) into the new Trust Layer's `ObservedReason[]` format.
//
// It translates deprecated boolean flags and custom rule outcomes into
// strongly typed ReasonCodes with appropriate confidence intervals.
// ---------------------------------------------------------------------------

export interface TransferRiskInput {
  deviceSignals?: Record<string, unknown>;
  deviceIntelResult?: { action: string; isLikelyAgent?: boolean; signals?: string[] };
  velocityResult?: {
    action: string;
    flags?: { burst: boolean; dailyVolume: boolean; geoJump: boolean };
    reasons?: string[];
  };
  ip?: string | null;
  country?: string | null;
  amountUsd: number;
  userId: string;
}

export interface TransferRiskResult {
  action: TrustAction;
  decision: DecisionRecord;
  /** Whether MFA step-up is required */
  stepUpRequired: boolean;
  /** Reason for blocking/holding, if applicable */
  reason?: string;
  /** Legacy-compatible format for audit logging */
  legacyScore: number;
}

export function evaluateTransferRisk(input: TransferRiskInput): TransferRiskResult {
  const reasons: ObservedReason[] = [];
  const nowStr = new Date().toISOString();
  
  // Helper to add reasons safely
  const addReason = (code: ReasonCode, confidence: number, detail?: string) => {
    reasons.push({
      code,
      confidence,
      observedAt: nowStr,
      detail,
    });
  };

  // 1. Device Signals (from older assessRisk input)
  const dev = input.deviceSignals || {};
  if (dev.automation) {
    addReason("BEH.AUTOMATION", 0.7, "Legacy device signal: automation");
  }
  if (dev.emulator) {
    addReason("DEV.EMULATOR", 0.8, "Legacy device signal: emulator");
  }
  if (dev.vpn) {
    addReason("NET.ANONYMISING_PROXY", 0.5, "Legacy device signal: vpn");
  }
  if (dev.newDevice) {
    addReason("DEV.NEW_TO_ACCOUNT", 0.3, "Legacy device signal: newDevice");
  }

  // 2. Velocity Result
  if (input.velocityResult) {
    const flags = input.velocityResult.flags;
    if (flags?.burst) {
      addReason("VEL.BURST", 0.8, "Velocity flag: burst");
    }
    if (flags?.geoJump) {
      addReason("NET.IMPOSSIBLE_TRAVEL", 0.6, "Velocity flag: geo_anomaly");
    }
    if (flags?.dailyVolume) {
      // Map daily volume to bursting or structuring
      addReason("VEL.BURST", 0.7, "Velocity flag: daily_volume");
    }
  }

  // 3. Device Intel
  if (input.deviceIntelResult) {
    if (input.deviceIntelResult.isLikelyAgent) {
      addReason("BEH.AUTOMATION", 0.75, "Device intel: likely agent");
    }
  }

  // 4. Payment Amount Heuristics
  if (input.amountUsd > 5000) {
    addReason("PAY.NEW_BENEFICIARY_LARGE_AMOUNT", 0.4, "High transaction value");
  }

  // Trust Layer Evaluation
  const assessment = assessTrust(reasons);
  const decision = explainDecision(assessment);

  // Derive legacy responses
  const action = decision.decision.action;
  const stepUpRequired = action === "step_up" || action === "manual_review";
  const legacyScore = assessment.score;
  
  return {
    action,
    decision,
    stepUpRequired,
    reason: action === "decline" || action === "hold" ? decision.decision.explanation : undefined,
    legacyScore,
  };
}
