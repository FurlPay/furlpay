import React, { useCallback, useEffect, useState } from "react";
import { Linking, ScrollView, StyleSheet, Text } from "react-native";
import { useRouter } from "expo-router";
import { getAddress, getKnownAddress, hasWallet } from "@/lib/wallet";
import { getBalance } from "@/lib/evm/rpc";
import { useSecureScreen } from "@/lib/secureScreen";
import { spacing, type } from "@/lib/theme";
import { Button, EmptyState, ErrorNote, Field, Screen, Segmented, Surface, SummaryRow } from "@/components/ui";
import {
  ARC_NETWORKS,
  formatFee,
  formatUsdc18,
  prepareArcSend,
  sendArcUsdc,
  type ArcChain,
  type PreparedArcSend,
} from "@/lib/arc/send";

// ---------------------------------------------------------------------------
// Send USDC on Arc from the device wallet (ARC-P1-005 / P4-001).
//
// Self-custodial: the device key signs behind the biometric prompt, FurlPay
// never holds the funds. Three steps — form, review, result — and the review
// shows the amount and the MAXIMUM fee in USDC, because on Arc the fee is paid
// out of the same balance. Errors are shown as the network or the checks in
// lib/arc/send.ts reported them; nothing here claims success before a receipt.
// ---------------------------------------------------------------------------

const NETWORKS = ["arc", "arc-testnet"] as const satisfies readonly ArcChain[];

type Step =
  | { kind: "form" }
  | { kind: "review"; prepared: PreparedArcSend }
  | { kind: "sent"; hash: string; explorerUrl: string; chain: ArcChain };

export default function ArcSend() {
  useSecureScreen("arc-send");
  const router = useRouter();
  const [address, setAddress] = useState<string | null | undefined>(undefined);
  const [chain, setChain] = useState<ArcChain>("arc");
  const [balance, setBalance] = useState<bigint | null>(null);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<Step>({ kind: "form" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => setAddress((await hasWallet()) ? (await getKnownAddress()) ?? (await getAddress().catch(() => null)) : null))();
  }, []);

  const refreshBalance = useCallback(async () => {
    if (!address) return;
    setBalance(null);
    try {
      setBalance(await getBalance(chain, address));
    } catch (e) {
      setError(`Could not read your ${ARC_NETWORKS[chain].name} balance: ${(e as Error).message}`);
    }
  }, [address, chain]);

  useEffect(() => {
    void refreshBalance();
  }, [refreshBalance]);

  if (address === undefined) return <Screen />;
  if (address === null) {
    return (
      <Screen style={styles.center}>
        <EmptyState title="No wallet on this device yet" subtitle="Sending on Arc uses the self-custodial wallet on this phone." />
        <Button title="Set up my wallet" onPress={() => router.push("/wallet")} style={{ alignSelf: "stretch" }} />
      </Screen>
    );
  }

  const review = async () => {
    setBusy(true);
    setError(null);
    try {
      setStep({ kind: "review", prepared: await prepareArcSend({ chain, from: address, to, amount }) });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const send = async (prepared: PreparedArcSend) => {
    setBusy(true);
    setError(null);
    try {
      const r = await sendArcUsdc(prepared);
      setStep({ kind: "sent", ...r, chain: prepared.chain });
      void refreshBalance();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {step.kind === "form" && (
          <>
            <Segmented options={NETWORKS} value={chain} onChange={(c) => setChain(c)} labels={{ arc: "Arc", "arc-testnet": "Arc Testnet" }} />
            <Text style={type.dim}>
              Balance: {balance === null ? "…" : `${formatUsdc18(balance)} USDC`} · fees are paid in USDC from this balance
            </Text>
            <Field label="Recipient address" value={to} onChangeText={setTo} autoCapitalize="none" autoCorrect={false} placeholder="0x…" clearable />
            <Field label="Amount (USDC)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" />
            <ErrorNote message={error} />
            <Button title="Review" onPress={() => void review()} loading={busy} disabled={!to || !amount} />
          </>
        )}

        {step.kind === "review" && (
          <>
            <Surface style={styles.card}>
              <SummaryRow k="Network" v={ARC_NETWORKS[step.prepared.chain].name} />
              <SummaryRow k="To" v={step.prepared.to} />
              <SummaryRow k="Amount" v={`${formatUsdc18(step.prepared.amount * 1_000_000_000_000n)} USDC`} bold />
              <SummaryRow k="Network fee (at most)" v={formatFee(step.prepared.maxFee)} />
              <SummaryRow k="Balance" v={`${formatUsdc18(step.prepared.balance)} USDC`} />
            </Surface>
            <Text style={[type.dim, styles.note]}>Check every character of the address. Arc transfers are final within a second and cannot be reversed.</Text>
            <ErrorNote message={error} />
            <Button title="Confirm and send" onPress={() => void send(step.prepared)} loading={busy} />
            <Button title="Back" variant="secondary" onPress={() => setStep({ kind: "form" })} disabled={busy} />
          </>
        )}

        {step.kind === "sent" && (
          <>
            <EmptyState title="Sent" subtitle={`Confirmed on ${ARC_NETWORKS[step.chain].name}.`} />
            <Text style={[type.mono, styles.note]} selectable>{step.hash}</Text>
            <Button title="View on explorer" variant="secondary" onPress={() => void Linking.openURL(step.explorerUrl)} />
            <Button title="Send another" onPress={() => { setTo(""); setAmount(""); setStep({ kind: "form" }); }} />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.lg },
  scroll: { padding: spacing.lg, gap: spacing.md },
  card: { gap: spacing.sm },
  note: { fontSize: 12, textAlign: "center" },
});
