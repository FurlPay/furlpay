import React, { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text } from "react-native";
import { useRouter } from "expo-router";
import { getAddress, getKnownAddress, hasWallet } from "@/lib/wallet";
import { useSecureScreen } from "@/lib/secureScreen";
import { colors, spacing, type } from "@/lib/theme";
import { Button, EmptyState, Screen } from "@/components/ui";
import { WalletQrCard } from "@/components/WalletQrCard";

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
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Shareable QR + Save/Share + WhatsApp/Telegram/X — the receive card
            copied from the web (ScanToPay MyQrView), bound to the DEVICE-WALLET
            address, never safeAddress. */}
        <WalletQrCard address={state.address} rail={`${ASSET_LABEL} · ${NETWORK_LABEL}`} />

        {/* Full address, selectable — verify ALL of it, not just the ends
            (address-poisoning relies on partial checks). */}
        <Text style={[type.mono, styles.fullAddress]} selectable>
          {state.address}
        </Text>

        <Text style={[type.dim, styles.note]}>
          Send only {ASSET_LABEL} on {NETWORK_LABEL} to this address — other tokens or networks may
          be lost.
        </Text>
        <Text style={[type.dim, styles.note]}>
          This address is controlled by the key on this device — FurlPay never holds it. Deposits
          here are yours on-chain and do not appear in your FurlPay account balance.
        </Text>
      </ScrollView>
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
  scroll: { padding: spacing.lg, gap: spacing.md, alignItems: "center" },
  fullAddress: { textAlign: "center", alignSelf: "stretch" },
  note: { fontSize: 12, textAlign: "center" },
});
