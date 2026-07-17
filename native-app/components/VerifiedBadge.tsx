import React from "react";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/lib/theme";

// Small identity-verification tick shown next to the user's name.
//   verified   -> FurlPay green  (backend-confirmed verification state)
//   unverified -> muted gray
//
// The `verified` value MUST come from authoritative backend data (e.g. the
// account's kycStatus), never inferred from the mere existence of a session.
//
// Ionicons `checkmark-circle` is used as the CircleCheck/BadgeCheck equivalent
// — the app already ships Ionicons, so this avoids adding lucide-react-native
// (a native dependency) for one glyph.
export function VerifiedBadge({ verified, size = 16 }: { verified: boolean; size?: number }) {
  return (
    <Ionicons
      name="checkmark-circle"
      size={size}
      color={verified ? colors.neon : colors.textFaint}
      accessibilityLabel={verified ? "Verified account" : "Unverified account"}
    />
  );
}
