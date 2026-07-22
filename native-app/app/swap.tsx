import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useQueryClient } from "@tanstack/react-query";
import { AbortedError, api, ApiError } from "@/lib/api";
import { confirmWithBiometrics } from "@/lib/biometrics";
import { usd } from "@/lib/format";
import { parseUsdcAmount, tryParseUsdcAmount } from "@/lib/money";
import { colors, radius, spacing, type } from "@/lib/theme";
import { Button, ErrorNote, Field, Screen, Surface } from "@/components/ui";

// Mirrors SwapSchema in apps/web/src/lib/schemas.ts.
const TOKENS = ["USDC", "USDT", "EURC", "PYUSD", "DAI", "XSGD", "XUSD", "SOL", "ETH"] as const;
const CHAINS = ["ethereum", "polygon", "base", "arbitrum", "solana", "gnosis", "robinhood", "bsc"] as const;

// A quote is a price at a moment. Executing against one the user fetched before
// backgrounding the app trades at a price nobody agreed to, so a stale quote is
// re-fetched and re-shown rather than executed.
//
// The server is the authority here: it issues `quoteId`, holds the quote for
// its own TTL, and executes against the STORED quote (see
// apps/web/src/lib/services/swapQuote.ts). This constant mirrors that TTL so
// the app can re-quote before the server would reject — keep them in step.
const QUOTE_TTL_MS = 30_000;

// Client-side slippage ceiling. The server sets slippagePct, but "the server
// said so" is not a safety property: a misconfigured or hostile response must
// not be able to hand the user a 50%-slippage trade behind a biometric prompt.
const MAX_SLIPPAGE_PCT = 5;
const WARN_SLIPPAGE_PCT = 1;

// Long enough for any real amount (parseUsdcAmount caps at 9 whole digits),
// short enough that a paste can't build a huge re-quote payload.
const AMOUNT_MAX_LENGTH = 20;

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

/** POST /swaps (quote phase). `quoteId` is what execution is authorized
 *  against — without it the server refuses to execute at all. */
interface QuoteResponse {
  quote: SwapQuote;
  quoteId: string;
  expiresAt: string;
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
  const [quoteId, setQuoteId] = useState<string | null>(null);
  const [quotedAt, setQuotedAt] = useState(0);
  const [quoting, setQuoting] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [executed, setExecuted] = useState<SwapQuote | null>(null);

  // Money is parsed to atomic units, never through `Number()`: "0.0000001"
  // passes `Number(x) > 0` and then truncates to zero atomic units — the exact
  // bug lib/sendValidation.ts documents fixing for the Send tab. A swap that
  // passes validation and biometric confirmation at zero value must be
  // impossible here too.
  const atomic = useMemo(() => tryParseUsdcAmount(amount), [amount]);
  const amountIn = atomic === null ? 0 : Number(atomic) / 1_000_000;
  const samePair = fromToken === toToken && fromChain === toChain;
  const valid = atomic !== null && !samePair;

  // The reason the amount was rejected, shown verbatim (AmountError messages
  // are written for users: too many decimals, separators, above the cap…).
  const amountError = useMemo(() => {
    if (atomic !== null) return null;
    try {
      parseUsdcAmount(amount);
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }, [amount, atomic]);

  // Live re-quote (debounced) whenever the pair or amount changes. Each request
  // owns an AbortController so a slow earlier quote can never land after — and
  // overwrite — the quote for what the user actually typed.
  useEffect(() => {
    setQuote(null);
    setQuoteId(null);
    setQuotedAt(0);
    setError(null);
    if (!valid) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      setQuoting(true);
      api<QuoteResponse>("/swaps", {
        method: "POST",
        body: { fromToken, toToken, fromChain, toChain, amountIn },
        signal: ctrl.signal,
      })
        .then((res) => {
          setQuote(res.quote);
          setQuoteId(res.quoteId);
          setQuotedAt(Date.now());
        })
        .catch((e) => {
          if (e instanceof AbortedError) return; // superseded, not a failure
          setError(e instanceof ApiError ? e.message : (e as Error).message);
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setQuoting(false);
        });
    }, 450);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [fromToken, toToken, fromChain, toChain, amountIn, valid]);

  const slippageBlocked = quote !== null && quote.slippagePct > MAX_SLIPPAGE_PCT;
  const slippageWarn =
    quote !== null && quote.slippagePct > WARN_SLIPPAGE_PCT && !slippageBlocked;

  /** Re-price and show the new number; never auto-executes at it. */
  const requote = async (note: string) => {
    setQuoting(true);
    setError(null);
    try {
      const res = await api<QuoteResponse>("/swaps", {
        method: "POST",
        body: { fromToken, toToken, fromChain, toChain, amountIn },
      });
      setQuote(res.quote);
      setQuoteId(res.quoteId);
      setQuotedAt(Date.now());
      setError(note);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setQuoting(false);
    }
  };

  const execute = async () => {
    if (!quote || !quoteId || slippageBlocked) return;

    // Stale quote: re-fetch and hand the new price back to the user for review
    // instead of executing at a rate they never saw. The server would reject
    // the expired id anyway — this just makes the outcome a fresh price rather
    // than an error.
    if (Date.now() - quotedAt > QUOTE_TTL_MS) {
      await requote("That quote expired — this is the current price. Review it and swap again.");
      return;
    }

    const confirmed = await confirmWithBiometrics(
      `Swap ${quote.amountIn} ${quote.fromToken} → ${quote.toToken}`
    );
    if (!confirmed) return;
    setExecuting(true);
    setError(null);
    try {
      // Executes against the quote the server issued and is holding — the
      // amount and route travel with `quoteId`, not as re-quotable parameters.
      const res = await api<{ quote: SwapQuote; executed: boolean }>("/swaps", {
        method: "POST",
        body: { execute: true, quoteId, fromToken, toToken, fromChain, toChain, amountIn },
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setExecuted(res.quote);
      void qc.invalidateQueries({ queryKey: ["overview"] });
    } catch (e) {
      // The server refused the id — most often because the biometric prompt
      // outlasted the TTL. Nothing settled, so re-price and let the user decide
      // against the current number instead of stranding them on an error.
      const code = e instanceof ApiError ? (e.data as { error?: string })?.error : undefined;
      if (code === "expired" || code === "already_used") {
        setExecuting(false);
        await requote("That quote expired before it was submitted — nothing was swapped. This is the current price.");
        return;
      }
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
            maxLength={AMOUNT_MAX_LENGTH}
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
                {usd(quote.feeUsd)} + {usd(quote.gasUsd)} gas · slippage{" "}
                <Text
                  style={
                    slippageBlocked
                      ? { color: colors.accent }
                      : slippageWarn
                        ? { color: colors.warning }
                        : undefined
                  }
                >
                  {quote.slippagePct}%
                </Text>
              </Text>
            </View>
            {slippageBlocked ? (
              <Text style={{ color: colors.accent }}>
                Slippage is above the {MAX_SLIPPAGE_PCT}% limit — this swap is blocked. Try a
                smaller amount or a different route.
              </Text>
            ) : slippageWarn ? (
              <Text style={{ color: colors.warning }}>
                High slippage — you may receive noticeably less than quoted.
              </Text>
            ) : null}
            <View style={styles.row}>
              <Text style={type.dim}>ETA</Text>
              <Text style={type.dim}>
                ~{Math.ceil(quote.etaSeconds / 60)} min · {quote.source === "lifi" ? "Li.Fi live" : "estimate"}
              </Text>
            </View>
          </Surface>
        ) : null}

        <ErrorNote
          message={
            samePair
              ? "Pick a different token or destination chain."
              : amount.trim() && atomic === null
                ? amountError
                : error
          }
        />
        <Button
          title="Swap"
          onPress={() => void execute()}
          loading={executing}
          disabled={!quote || !quoteId || quoting || slippageBlocked}
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
