import React from "react";
import { StyleSheet, Text, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useOverview } from "@/lib/queries";
import { colors, radius, spacing, type } from "@/lib/theme";
import { Button, EmptyState, Screen, Surface } from "@/components/ui";

export default function Receive() {
  const { data: result, isLoading } = useOverview();
  const address = result?.data.user.safeAddress;

  const copy = async () => {
    if (!address) return;
    await Clipboard.setStringAsync(address);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  if (!address) {
    return (
      <Screen>
        <EmptyState
          title={isLoading ? "Loading…" : "No wallet address"}
          subtitle="Connect once while online so your address is cached."
        />
      </Screen>
    );
  }

  return (
    <Screen style={styles.screen}>
      <Text style={[type.dim, { textAlign: "center" }]}>
        Share this address to receive USDC and other stablecoins. Gas-free deposits on Arbitrum & Base.
      </Text>
      <View style={styles.qrWrap}>
        <QRCode value={address} size={220} backgroundColor="#FFFFFF" color="#000000" />
      </View>
      <Surface style={{ alignSelf: "stretch" }}>
        <Text style={[type.mono, { textAlign: "center" }]}>{address}</Text>
      </Surface>
      <Button title="Copy address" onPress={() => void copy()} style={{ alignSelf: "stretch" }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.lg,
    padding: spacing.lg,
  },
  qrWrap: {
    backgroundColor: "#FFFFFF",
    padding: spacing.md,
    borderRadius: radius.lg,
  },
});
