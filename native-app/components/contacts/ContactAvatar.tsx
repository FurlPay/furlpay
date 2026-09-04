import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors } from "@/lib/theme";
import { contactInitial } from "@/lib/contacts/model";

// ---------------------------------------------------------------------------
// A contact's avatar: their initial on the colour they were given.
//
// NOT A PHOTOGRAPH, AND DELIBERATELY SO. A payee's avatar is a recognition cue
// on a screen where recognition is the security control, and an image the user
// did not choose is a cue an attacker can copy. A letter on a colour the user
// picked themselves cannot be spoofed by anyone who does not already have their
// account. Tangem's address book makes the same choice for the same reason.
//
// The colour comes from the server-constrained palette (AVATAR_COLORS), so it
// is always safe to place directly into a style.
// ---------------------------------------------------------------------------

export function ContactAvatar({
  name,
  color,
  size = 40,
  /** Renders the favourite star over the corner. */
  favorite = false,
}: {
  name: string;
  color: string;
  size?: number;
  favorite?: boolean;
}) {
  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: color },
      ]}
      // The initial is decoration; the row that owns this avatar carries the
      // contact's name for a screen reader, so announcing "A" here would only
      // add a letter between the user and the name they are listening for.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Text style={[styles.initial, { fontSize: size * 0.42 }]} allowFontScaling={false}>
        {contactInitial(name)}
      </Text>
      {favorite ? (
        <View style={[styles.star, { width: size * 0.4, height: size * 0.4 }]}>
          <Text style={{ fontSize: size * 0.22 }}>★</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: { alignItems: "center", justifyContent: "center" },
  initial: { color: "#FFFFFF", fontWeight: "800" },
  star: {
    position: "absolute",
    right: -2,
    bottom: -2,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
