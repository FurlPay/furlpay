import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import * as LocalAuthentication from "expo-local-authentication";
import * as Haptics from "expo-haptics";
import { api, ApiError, demoSignature, NetworkError } from "@/lib/api";
import { queuePendingAction } from "@/lib/db";
import { useOverview, useInvalidateAll } from "@/lib/queries";
import { isValidDestination, shortAddress, usd } from "@/lib/format";
import { colors, radius, spacing, type } from "@/lib/theme";
import { Button, ErrorNote, Field, Screen, Surface } from "@/components/ui";
import type { TokenBalance } from "@/lib/types";

type Result =
  | { kind: "sent"; hash: string }
  | { kind: "queued" }
  | null;

export default function Send() {
  const params = useLocalSearchParams<{ to?: string }>();
  const { data: overviewResult } = useOverview();
  const invalidateAll = useInvalidateAll();
  const balances = overviewResult?.data.tokenBalances ?? [];

  const [destination, setDestination] = useState(params.to ?? "");
  const [amount, setAmount] = useState("");
  const [source, setSource] = useState<TokenBalance | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [needsMfa, setNeedsMfa] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);

  const selected = source ?? balances[0] ?? null;
  const amountNum = Number(amount);

  const validation = useMemo(() => {
    if (!destination) return "Enter a recipient address.";
    if (selected && !isValidDestination(destination.trim(), selected.chain))
      return selected.chain === "solana"
        ? "Recipient must be a Solana (base58) address."
        : "Recipient must be a 0x… EVM address.";
    if (!amount) return "Enter an amount.";
    if (!(amountNum > 0)) return "Amount must be greater than zero.";
    if (!selected) return "No balance to send from.";
    if (amountNum > selected.amount) return `Insufficient ${selected.token} balance.`;
    return null;
  }, [destination, amount, amountNum, selected]);

  const send = async () => {
    setError(null);
    if (validation) {
      setError(validation);
      return;
    }
    // Biometric confirmation before any money moves.
    const hasBiometrics =
      (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
    if (hasBiometrics) {
      const auth = await LocalAuthentication.authenticateAsync({
        promptMessage: `Send ${usd(amountNum)} to ${shortAddress(destination.trim())}`,
      });
      if (!auth.success) return;
    }

    const payload = {
      destination: destination.trim(),
      amount: amountNum,
      token: selected!.token,
      chain: selected!.chain,
      // SECURITY: demoSignature() is a random blob — it authorizes NOTHING.
      // /wallets/transfer is the demo-ledger custodial path (mock recovery,
      // same as the web dashboard); its real authorization is the session JWT.
      // If this endpoint is ever wired to real settlement, this screen MUST
      // switch to lib/wallet.ts signTransferAuthorization (genuine EIP-3009,
      // biometric-gated) — see sendGasless for the working pattern.
      signature: demoSignature(),
      ...(mfaCode ? { mfaCode } : {}),
    };

    setBusy(true);
    try {
      const res = await api<{ transactionHash: string }>("/wallets/transfer", {
        method: "POST",
        body: payload,
        headers: { "Idempotency-Key": crypto.randomUUID() },
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setResult({ kind: "sent", hash: res.transactionHash });
      invalidateAll();
    } catch (e) {
      if (e instanceof NetworkError) {
        // Offline: queue in the outbox; OfflineBanner flushes when back online.
        queuePendingAction("transfer", payload);
        setResult({ kind: "queued" });
      } else if (e instanceof ApiError && (e.data as any)?.stepUpRequired) {
        setNeedsMfa(true);
        setError("High-value transfer — enter your authenticator code to continue.");
      } else {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setError(e instanceof ApiError ? e.message : (e as Error).message);
      }
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <Screen style={styles.done}>
        <Text style={{ fontSize: 56 }}>{result.kind === "sent" ? "✓" : "⏳"}</Text>
        <Text style={type.h2}>
          {result.kind === "sent" ? "Payment sent" : "Queued — you're offline"}
        </Text>
        <Text style={[type.dim, { textAlign: "center" }]}>
          {result.kind === "sent"
            ? `${usd(amountNum)} ${selected?.token} to ${shortAddress(destination)}`
            : "This transfer will send automatically when you're back online."}
        </Text>
        {result.kind === "sent" ? <Text style={type.mono}>{shortAddress(result.hash, 10)}</Text> : null}
        <Button
          title="Done"
          onPress={() => {
            setResult(null);
            setDestination("");
            setAmount("");
            setMfaCode("");
            setNeedsMfa(false);
          }}
          style={{ alignSelf: "stretch" }}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Field
          label={selected?.chain === "solana" ? "Recipient (Solana address)" : "Recipient (0x address)"}
          value={destination}
          onChangeText={setDestination}
          placeholder={selected?.chain === "solana" ? "Base58 address…" : "0xabc…"}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Field
          label="Amount (USD)"
          value={amount}
          onChangeText={setAmount}
          placeholder="0.00"
          keyboardType="decimal-pad"
        />

        <View style={{ gap: 6 }}>
          <Text style={type.dim}>Pay with</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
            {balances.map((b) => {
              const active = selected?.token === b.token && selected?.chain === b.chain;
              return (
                <Pressable
                  key={`${b.token}-${b.chain}`}
                  onPress={() => setSource(b)}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text style={{ color: active ? colors.onNeon : colors.text, fontWeight: "600" }}>
                    {b.token} · {b.chain}
                  </Text>
                  <Text style={{ color: active ? colors.onNeon : colors.textDim, fontSize: 12 }}>
                    {usd(b.usdValue)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {needsMfa ? (
          <Field
            label="Authenticator code"
            value={mfaCode}
            onChangeText={setMfaCode}
            placeholder="123456"
            keyboardType="number-pad"
            maxLength={8}
          />
        ) : null}

        {selected && amountNum > 0 && !validation ? (
          <Surface style={{ gap: 4 }}>
            <Text style={type.dim}>Review</Text>
            <Text style={type.body}>
              Send {usd(amountNum)} {selected.token} on {selected.chain}
            </Text>
            {/* Full recipient, monospace — address-poisoning relies on you
                checking only the first/last few characters. Verify all of it. */}
            <Text style={type.dim}>To</Text>
            <Text style={[type.mono, { color: colors.text, fontSize: 13 }]} selectable>
              {destination.trim()}
            </Text>
            <Text style={[type.dim, { fontSize: 12 }]}>
              Check the whole address — sends are irreversible.
            </Text>
            <Text style={[type.dim, { color: colors.neon }]}>Gas sponsored by FurlPay — no fee</Text>
          </Surface>
        ) : null}

        <ErrorNote message={error} />
        <Button title="Send payment" onPress={() => void send()} loading={busy} disabled={!!validation} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  chip: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 2,
  },
  chipActive: { backgroundColor: colors.neon },
  done: {
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.xl,
  },
});
