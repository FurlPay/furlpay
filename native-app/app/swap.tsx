import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { confirmWithBiometrics } from "@/lib/biometrics";
import { usd } from "@/lib/format";
import { colors, radius, spacing, type } from "@/lib/theme";
import { Button, ErrorNote, Field, Screen, Surface } from "@/components/ui";

// Mirrors SwapSchema in apps/web/src/lib/schemas.ts.
const TOKENS = ["USDC", "USDT", "EURC", "PYUSD", "DAI", "XSGD", "XUSD", "SOL", "ETH"] as const;
const CHAINS = ["ethereum", "polygon", "base", "arbitrum", "solana", "gnosis", "robinhood", "bsc"] as const;

interface SwapQuote {
  fromToken: string;
  toToken: string;
  fromChain: string;
  toChain: string;
  amountIn: number;
  amountOut: number;
  slippagePct: number;
  gasUsd: number;
  feeUsd: number;
  route: string[];
  etaSeconds: number;
  source: "lifi" | "mock";
}

function ChipPicker<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={type.dim}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {options.map((o) => {
          const active = o === value;
          return (
            <Pressable
              key={o}
              onPress={() => onChange(o)}
              style={[styles.chip, active && { backgroundColor: colors.neon }]}
            >
              <Text style={{ color: active ? colors.onNeon : colors.text, fontWeight: "600" }}>{o}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

export default function Swap() {
  const qc = useQueryClient();
  const [fromToken, setFromToken] = useState<(typeof TOKENS)[number]>("USDT");
  const [toToken, setToToken] = useState<(typeof TOKENS)[number]>("USDC");
  const [fromChain, setFromChain] = useState<(typeof CHAINS)[number]>("arbitrum");
  const [toChain, setToChain] = useState<(typeof CHAINS)[number]>("arbitrum");
  const [amount, setAmount] = useState("100");

  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [executed, setExecuted] = useState<SwapQuote | null>(null);

  const amountIn = Number(amount);
  const valid = useMemo(
    () => amountIn > 0 && !(fromToken === toToken && fromChain === toChain),
    [amountIn, fromToken, toToken, fromChain, toChain]
  );

  // Live re-quote (debounced) whenever the pair or amount changes.
  useEffect(() => {
    setQuote(null);
    setError(null);
    if (!valid) return;
    const t = setTimeout(() => {
      setQuoting(true);
      api<{ quote: SwapQuote }>("/swaps", {
        method: "POST",
        body: { fromToken, toToken, fromChain, toChain, amountIn },
      })
        .then((res) => setQuote(res.quote))
        .catch((e) => setError(e instanceof ApiError ? e.message : (e as Error).message))
        .finally(() => setQuoting(false));
    }, 450);
    return () => clearTimeout(t);
  }, [fromToken, toToken, fromChain, toChain, amountIn, valid]);

  const execute = async () => {
    if (!quote) return;
    const confirmed = await confirmWithBiometrics(
      `Swap ${quote.amountIn} ${quote.fromToken} → ${quote.toToken}`
    );
    if (!confirmed) return;
    setExecuting(true);
    setError(null);
    try {
      const res = await api<{ quote: SwapQuote; executed: boolean }>("/swaps", {
        method: "POST",
        body: { fromToken, toToken, fromChain, toChain, amountIn, execute: true },
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setExecuted(res.quote);
      void qc.invalidateQueries({ queryKey: ["overview"] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setExecuting(false);
    }
  };

  if (executed) {
    return (
      <Screen style={styles.done}>
        <Text style={{ fontSize: 56 }}>✓</Text>
        <Text style={type.h2}>Swap complete</Text>
        <Text style={[type.dim, { textAlign: "center" }]}>
          {executed.amountIn} {executed.fromToken} on {executed.fromChain} →{" "}
          {executed.amountOut.toFixed(4)} {executed.toToken} on {executed.toChain}
        </Text>
        <Button title="Done" onPress={() => setExecuted(null)} style={{ alignSelf: "stretch" }} />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Surface style={{ gap: spacing.md }}>
          <ChipPicker label="From token" options={TOKENS} value={fromToken} onChange={setFromToken} />
          <ChipPicker label="From chain" options={CHAINS} value={fromChain} onChange={setFromChain} />
          <Field
            label="Amount"
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            placeholder="0.00"
          />
        </Surface>

        <View style={{ alignItems: "center" }}>
          <Pressable
            onPress={() => {
              setFromToken(toToken);
              setToToken(fromToken);
              setFromChain(toChain);
              setToChain(fromChain);
            }}
            style={styles.flip}
            hitSlop={8}
          >
            <Text style={{ color: colors.neon, fontSize: 18 }}>⇅</Text>
          </Pressable>
        </View>

        <Surface style={{ gap: spacing.md }}>
          <ChipPicker label="To token" options={TOKENS} value={toToken} onChange={setToToken} />
          <ChipPicker label="To chain" options={CHAINS} value={toChain} onChange={setToChain} />
        </Surface>

        {quoting ? <Text style={[type.dim, { textAlign: "center" }]}>Fetching best route…</Text> : null}

        {quote ? (
          <Surface style={{ gap: 6 }}>
            <View style={styles.row}>
              <Text style={type.dim}>You receive</Text>
              <Text style={[type.h2, { color: colors.neon }]}>
                {quote.amountOut.toFixed(4)} {quote.toToken}
              </Text>
            </View>
            <View style={styles.row}>
              <Text style={type.dim}>Route</Text>
              <Text style={type.dim}>{quote.route.join(" → ")}</Text>
            </View>
            <View style={styles.row}>
              <Text style={type.dim}>Fees</Text>
              <Text style={type.dim}>
                {usd(quote.feeUsd)} + {usd(quote.gasUsd)} gas · slippage {quote.slippagePct}%
              </Text>
            </View>
            <View style={styles.row}>
              <Text style={type.dim}>ETA</Text>
              <Text style={type.dim}>
                ~{Math.ceil(quote.etaSeconds / 60)} min · {quote.source === "lifi" ? "Li.Fi live" : "estimate"}
              </Text>
            </View>
          </Surface>
        ) : null}

        <ErrorNote message={!valid && amountIn > 0 ? "Pick a different token or destination chain." : error} />
        <Button
          title="Swap"
          onPress={() => void execute()}
          loading={executing}
          disabled={!quote || quoting}
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  chip: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  flip: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.neonSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  done: { alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.xl },
});
