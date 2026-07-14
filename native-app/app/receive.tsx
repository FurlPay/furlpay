import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import QRCode from "react-native-qrcode-svg";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { getAddress, getKnownAddress, hasWallet } from "@/lib/wallet";
import { useSecureScreen } from "@/lib/secureScreen";
import { colors, radius, spacing, type } from "@/lib/theme";
import { Button, EmptyState, Screen, Surface } from "@/components/ui";

// ---------------------------------------------------------------------------
// Receive — shows ONLY the self-custodial device-wallet address (lib/wallet.ts),
// the one address in this product actually controlled by a real private key.
//
// It must NEVER show the account's `safeAddress`: server-side that value is a
// sha256-derived placeholder with no private key behind it — real funds sent
// to it are unrecoverable. If no device wallet exists, this screen offers to
// create one; it never falls back to a fake address.
//
// Honesty constraints (Phase 3 deposit tracking is NOT active): deposits to
// this address are held by the device key and do not appear in the FurlPay
// account balance. The copy says so.
// ---------------------------------------------------------------------------

const NETWORK_LABEL = "Arbitrum One";
const ASSET_LABEL = "USDC";

type WalletState =
  | { kind: "loading" }
  | { kind: "none" } // no device wallet
  | { kind: "locked" } // wallet exists, address not cached yet (pre-cache install)
  | { kind: "ready"; address: string };

export default function Receive() {
  useSecureScreen("receive");
  const router = useRouter();
  const [state, setState] = useState<WalletState>({ kind: "loading" });
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!(await hasWallet())) {
      setState({ kind: "none" });
      return;
    }
    const address = await getKnownAddress();
    setState(address ? { kind: "ready", address } : { kind: "locked" });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const unlock = async () => {
    // Pre-cache install: one gated read reveals + caches the address.
    try {
      const address = await getAddress();
      setState({ kind: "ready", address });
    } catch {
      // Biometric dismissed — stay on the locked state, the button retries.
    }
  };

  const copy = async () => {
    if (state.kind !== "ready") return;
    await Clipboard.setStringAsync(state.address);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (state.kind === "loading") return <Screen />;

  if (state.kind === "none") {
    return (
      <Screen style={styles.screen}>
        <EmptyState
          title="No wallet on this device yet"
          subtitle="To receive self-custodial funds you first need a wallet — a private key created on this device that only you control."
        />
        <Button
          title="Set up my wallet"
          onPress={() => router.push("/wallet")}
          style={{ alignSelf: "stretch" }}
        />
      </Screen>
    );
  }

  if (state.kind === "locked") {
    return (
      <Screen style={styles.screen}>
        <EmptyState
          title="Unlock to show your address"
          subtitle="Confirm with your fingerprint once — after that this screen opens without a prompt."
        />
        <Button title="Unlock" onPress={() => void unlock()} style={{ alignSelf: "stretch" }} />
      </Screen>
    );
  }

  return (
    <Screen style={styles.screen}>
      <View style={styles.networkChip}>
        <Text style={{ color: colors.neon, fontWeight: "700", fontSize: 13 }}>
          {ASSET_LABEL} · {NETWORK_LABEL}
        </Text>
      </View>
      <View style={styles.qrWrap}>
        <QRCode value={state.address} size={220} backgroundColor="#FFFFFF" color="#000000" />
      </View>
      {/* Full address, monospace and selectable — verify ALL of it, not just
          the ends (address-poisoning counts on partial checks). */}
      <Surface style={{ alignSelf: "stretch" }}>
        <Text style={[type.mono, { textAlign: "center" }]} selectable>
          {state.address}
        </Text>
      </Surface>
      <Button
        title={copied ? "Copied" : "Copy address"}
        onPress={() => void copy()}
        style={{ alignSelf: "stretch" }}
      />
      <Text style={[type.dim, { fontSize: 12, textAlign: "center" }]}>
        Send only {ASSET_LABEL} on {NETWORK_LABEL} to this address — other tokens or networks may be
        lost.
      </Text>
      <Text style={[type.dim, { fontSize: 12, textAlign: "center" }]}>
        This address is controlled by the key on this device — FurlPay never holds it. Deposits here
        are yours on-chain and do not appear in your FurlPay account balance.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.lg,
  },
  networkChip: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  qrWrap: {
    backgroundColor: "#FFFFFF",
    padding: spacing.md,
    borderRadius: radius.lg,
  },
});
