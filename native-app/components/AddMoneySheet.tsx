import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { api } from "@/lib/api";
import { colors, radius, spacing, type } from "@/lib/theme";
import { Sheet, Surface } from "@/components/ui";

// ---------------------------------------------------------------------------
// Add money — the native counterpart of the web dashboard's DepositModal:
// crypto QR, bank transfer details, or card on-ramp.
//
// EXTRACTED FROM app/(tabs)/index.tsx, where it was a private component. It is
// shared rather than copied because the cards tab needs the same sheet: a card
// has no balance of its own (PaymentCard carries `settlementCurrency`, not an
// amount), so "top up this card" and "add money" are the SAME operation on the
// same account. Two sheets would be two places to add a funding rail to, and
// the second one would be found by a user before it was found by us.
// ---------------------------------------------------------------------------

interface FiatAccount {
  currency: string;
  amount: number;
  usdValue: number;
  localDetails?: Record<string, string>;
}

function DepositRow({
  icon,
  title,
  sub,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  sub: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={sub}
      style={({ pressed }) => [styles.depositRow, pressed && { opacity: 0.7 }]}
    >
      <View style={styles.depositIcon}>
        <Ionicons name={icon} size={20} color={colors.text} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[type.body, { fontWeight: "700" }]}>{title}</Text>
        <Text style={[type.dim, { fontSize: 12 }]}>{sub}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
    </Pressable>
  );
}

export function AddMoneySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [bankOpen, setBankOpen] = useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["banking"],
    queryFn: () => api<{ accounts: FiatAccount[] }>("/banking"),
    enabled: open,
  });
  const withDetails = (data?.accounts ?? []).filter((a) => a.localDetails);

  const go = (path: "/receive" | "/banking") => {
    onClose();
    router.push(path);
  };

  return (
    <Sheet open={open} title="Add money" onClose={onClose}>
      <DepositRow
        icon="qr-code-outline"
        title="Deposit crypto"
        sub="Your self-custodial USDC address (Arbitrum)"
        onPress={() => go("/receive")}
      />
      <DepositRow
        icon="business-outline"
        title="Bank transfer"
        sub="Free · arrives in minutes"
        onPress={() => setBankOpen((b) => !b)}
      />
      {bankOpen ? (
        // Three distinct states, because "no rows" has three different
        // meanings and collapsing them tells the user the wrong one. The
        // original rendered the empty-state copy while the query was still in
        // flight, so a slow /banking call read as "you have no accounts".
        isLoading ? (
          <Text style={[type.dim, { paddingHorizontal: 4 }]}>Loading your account details…</Text>
        ) : isError ? (
          <Text style={[type.dim, { paddingHorizontal: 4 }]}>
            Couldn&rsquo;t load your bank details. Pull to refresh, or open Banking.
          </Text>
        ) : withDetails.length ? (
          withDetails.map((a) => (
            <Surface key={a.currency} style={{ gap: 2 }}>
              <Text style={[type.dim, { fontSize: 11, fontWeight: "700" }]}>{a.currency}</Text>
              {Object.entries(a.localDetails!).map(([k, v]) => (
                <Pressable
                  key={k}
                  accessibilityRole="button"
                  accessibilityLabel={`Copy ${k.replace(/([A-Z])/g, " $1")}`}
                  onPress={() =>
                    void Clipboard.setStringAsync(v).then(() =>
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                    )
                  }
                  style={({ pressed }) => [styles.bankRow, pressed && { opacity: 0.6 }]}
                >
                  <Text style={[type.dim, { fontSize: 12, textTransform: "capitalize" }]}>
                    {k.replace(/([A-Z])/g, " $1")}
                  </Text>
                  <Text style={[type.mono, { fontSize: 12, color: colors.text }]}>{v}</Text>
                </Pressable>
              ))}
            </Surface>
          ))
        ) : (
          <Text style={[type.dim, { paddingHorizontal: 4 }]}>
            No bank details yet — open a local account under Banking first.
          </Text>
        )
      ) : null}
      <DepositRow
        icon="add-outline"
        title="Buy with card"
        sub="Visa / Mastercard on-ramp"
        onPress={() => go("/banking")}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  depositRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  depositIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
  },
  bankRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.md,
  },
});
