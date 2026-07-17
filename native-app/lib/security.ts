import { colors } from "@/lib/theme";

// Pure, dependency-free security-posture logic so it is unit-testable and the
// Security screen can render a level derived from REAL account signals, never a
// hardcoded score.

export interface SecuritySignals {
  /** At least one active passkey credential genuinely exists. */
  passkey: boolean;
  /** The account's email has been verified per the backend identity model. */
  emailVerified: boolean;
  /** The app's biometric lock is actually enabled. */
  biometric: boolean;
}

export type SecurityLevel = "strong" | "medium" | "weak";

/**
 * Derive the account's security level from authoritative signals only.
 *   strong  — passkey + verified email + biometric app lock
 *   medium  — verified email plus at least one strong protection
 *   weak    — missing verified email, or email with no passkey/biometric
 */
export function securityLevel(s: SecuritySignals): SecurityLevel {
  if (s.emailVerified && s.passkey && s.biometric) return "strong";
  if (s.emailVerified && (s.passkey || s.biometric)) return "medium";
  return "weak";
}

export interface LevelPresentation {
  label: string;
  blurb: string;
  color: string;
}

export function levelPresentation(level: SecurityLevel): LevelPresentation {
  switch (level) {
    case "strong":
      return { label: "Strong", blurb: "Your account is well protected.", color: colors.neon };
    case "medium":
      return {
        label: "Medium",
        blurb: "Add a passkey and app lock to fully protect your account.",
        color: colors.warning,
      };
    default:
      return {
        label: "Weak",
        blurb: "Verify your email and add a passkey to protect your account.",
        color: colors.accent,
      };
  }
}
