import React, { useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/lib/theme";

// User avatar. Priority:
//   1. a real profile photo (pictureUrl) — a verified Google image or a
//      user-uploaded one, IF the backend persists one (it does not today; see
//      the account audit — reported as an optional enhancement).
//   2. a NEUTRAL human silhouette fallback.
//
// Deliberately NOT deterministic art (no per-user icon/colour, no email initial,
// no emoji): a plain person silhouette reads immediately as "your profile" and
// looks professional. A failed remote image falls back to the silhouette with no
// layout shift (the disc reserves the space regardless of load state).

export function Avatar({
  name,
  email,
  pictureUrl,
  size = 46,
  ring = false,
}: {
  name?: string | null;
  email?: string | null;
  pictureUrl?: string | null;
  size?: number;
  /** Subtle neon ring, for the home-screen treatment. */
  ring?: boolean;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const label = name || email || "Your account";
  const useImage = Boolean(pictureUrl) && !imgFailed;

  const base = { width: size, height: size, borderRadius: size / 2 } as const;

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${label} profile photo`}
      style={[
        base,
        styles.wrap,
        ring && { borderColor: colors.neonDeep, borderWidth: 1.5 },
      ]}
    >
      {useImage ? (
        <Image source={{ uri: pictureUrl as string }} style={base} onError={() => setImgFailed(true)} />
      ) : (
        <Ionicons name="person" size={Math.round(size * 0.56)} color={colors.textDim} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
});
