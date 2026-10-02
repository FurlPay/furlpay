import React, { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text } from "react-native";
import { useQuery } from "@tanstack/react-query";
import * as WebBrowser from "expo-web-browser";
import { useLocalSearchParams } from "expo-router";
import { api } from "@/lib/api";
import { authenticateDeviceOwner } from "@/lib/biometrics";
import { getKnownAddress } from "@/lib/wallet";
import { track } from "@/lib/analytics";
import { useSecureScreen } from "@/lib/secureScreen";
import {
  QUOTE_DEBOUNCE_MS,
  RAMP_CHAINS,
  RAMP_FIATS,
  SELL_TAX_NOTE,
  parseRampAmount,
  quoteSourceLabel,
  rampErrorMessage,
  type HostedCheckout,
  type RampChain,
  type RampFiat,
  type RampQuote,
} from "@/lib/ramp";
import { colors, spacing, type } from "@/lib/theme";
import { Button, EmptyState, ErrorNote, Field, Screen, SectionHeader, Segmented, SummaryRow, Surface } from "@/components/ui";

// Buy / sell crypto through Coinbase's hosted checkout. Logic and the reasons
// behind what is NOT on this screen live in lib/ramp.ts.

type Mode = "buy" | "sell";

export default function RampScreen() {
  useSecureScreen("ramp");
  // furlpay://ramp?mode=buy&amount=50 — sent by the Wear OS hand-off
  // (guardian RampHandoff). Only prefills: nothing is charged without the
  // device-owner prompt below. An invalid amount falls back to the default.
  const params = useLocalSearchParams<{ mode?: string; amount?: string }>();
  const [mode, setMode] = useState<Mode>(params.mode === "sell" ? "sell" : "buy");
  const [amountText, setAmountText] = useState(
    params.amount && parseRampAmount(params.amount) !== null ? params.amount : "50"
  );
  const [fiat, setFiat] = useState<RampFiat>("USD");
  const [chain, setChain] = useState<RampChain>("base");
  const [address, setAddress] = useState<string | null>(null);
  const [quote, setQuote] = useState<RampQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);

  useEffect(() => {
    void getKnownAddress().then(setAddress);
  }, []);

  const amount = parseRampAmount(amountText);

  // Debounced, abortable quote: a slow earlier response must never repaint the
  // screen over a newer one (lib/api.ts, `signal`).
  const inflight = useRef<AbortController | null>(null);
  useEffect(() => {
    setQuote(null);
    setQuoteError(null);
    if (mode !== "buy" || amount === null) return;
    const t = setTimeout(() => {
      inflight.current?.abort();
      const ctl = new AbortController();
      inflight.current = ctl;
      setQuoting(true);
      track("onramp_quote_requested", { fiat, asset: "USDC", method: "card" });
      api<RampQuote>("/onramp/quote", {
        method: "POST",
        anonymous: true,
        signal: ctl.signal,
        body: { fiatAmount: amount, fiatCurrency: fiat, token: "USDC", chain, paymentMethod: "card" },
      })
        .then((q) => !ctl.signal.aborted && setQuote(q))
        .catch((e) => !ctl.signal.aborted && setQuoteError(rampErrorMessage(e, "buy")))
        .finally(() => !ctl.signal.aborted && setQuoting(false));
    }, QUOTE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [mode, amount, fiat, chain]);

  // Bank payouts: the server says whether adding an account is possible at all.
  const payouts = useQuery({
    queryKey: ["offramp-beneficiaries"],
    queryFn: () => api<{ available: boolean }>("/offramp/beneficiary"),
    enabled: mode === "sell",
  });

  async function openCheckout() {
    if (amount === null || !address) return;
    setError(null);
    // Money is about to move: prove the device owner is holding the phone.
    const auth = await authenticateDeviceOwner(mode === "buy" ? "Confirm purchase" : "Confirm sale");
    if (!auth.ok) {
      setError(auth.reason === "no_device_lock" ? "Set a screen lock on this device to buy or sell crypto." : null);
      return;
    }
    setBusy(true);
    try {
      let hosted: HostedCheckout | null;
      if (mode === "buy") {
        const res = await api<{ hosted: HostedCheckout | null }>("/onramp/session", {
          method: "POST",
          body: { fiatAmount: amount, fiatCurrency: fiat, token: "USDC", chain, paymentMethod: "card", destinationAddress: address },
        });
        hosted = res.hosted;
        if (hosted) track("onramp_session_created", { provider: "coinbase", fiat, asset: "USDC" });
      } else {
        track("offramp_quote_requested", { fiat, asset: "USDC" });
        const res = await api<{ hosted: HostedCheckout | null }>("/offramp/session", {
          method: "POST",
          body: { address, chain, token: "USDC", cryptoAmount: amount },
        });
        hosted = res.hosted;
      }
      if (!hosted) {
        setError(`${mode === "buy" ? "Buying" : "Selling"} crypto isn't available on this build.`);
        return;
      }
      // Custom Tabs on Android, SFSafariViewController on iOS: the provider's
      // own page in the system browser, never a WebView this app could read.
      await WebBrowser.openBrowserAsync(hosted.url);
      setOpened(mode);
    } catch (e) {
      setError(rampErrorMessage(e, mode));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Segmented options={["buy", "sell"] as const} value={mode} onChange={(m) => { setMode(m); setOpened(null); setError(null); }} />

        {!address ? (
          <EmptyState title="Set up your wallet first" subtitle="Crypto you buy is delivered to your own wallet address." />
        ) : (
          <>
            <Surface style={styles.card}>
              <Field
                label={mode === "buy" ? `Amount (${fiat})` : "Amount (USDC)"}
                value={amountText}
                onChangeText={setAmountText}
                keyboardType="decimal-pad"
                clearable
              />
              {amount === null ? <Text style={type.dim}>Enter between 1 and 50,000.</Text> : null}
              {mode === "buy" ? <Segmented options={RAMP_FIATS} value={fiat} onChange={setFiat} /> : null}
              <Segmented options={RAMP_CHAINS} value={chain} onChange={setChain} />
            </Surface>

            {mode === "buy" ? (
              <Surface style={styles.card}>
                <SectionHeader title="Quote" />
                {quoting ? <Text style={type.dim}>Getting a price…</Text> : null}
                {quote ? (
                  <>
                    <SummaryRow k="You receive (est.)" v={`${quote.cryptoAmount.toFixed(2)} USDC`} bold />
                    <SummaryRow k="Provider fee" v={`${quote.fees.processing.toFixed(2)} ${fiat}`} />
                    <SummaryRow k="Network fee" v={`${quote.fees.network.toFixed(2)} ${fiat}`} />
                    <Text style={[type.dim, quote.source !== "coinbase" && { color: colors.warning }]}>
                      {quoteSourceLabel(quote)}
                    </Text>
                  </>
                ) : null}
                {quoteError ? <Text style={type.dim}>{quoteError}</Text> : null}
              </Surface>
            ) : (
              <Surface style={styles.card}>
                <SectionHeader title="Where the money goes" />
                <Text style={type.dim}>
                  Coinbase pays out to the bank account or card you choose on its page. Coinbase shows the rate and fees before you confirm.
                </Text>
                {payouts.data && !payouts.data.available ? (
                  <Text style={type.dim}>Direct bank payouts through FurlPay aren&apos;t available yet.</Text>
                ) : null}
                <Text style={type.dim}>{SELL_TAX_NOTE}</Text>
              </Surface>
            )}

            <ErrorNote message={error} />

            {opened ? (
              <Surface style={styles.card}>
                <Text style={type.body}>Checkout opened with Coinbase.</Text>
                <Text style={type.dim}>
                  {opened === "buy"
                    ? "Coinbase delivers USDC to your wallet once the payment clears. It appears in your balance when it lands on-chain; FurlPay does not receive a status from Coinbase."
                    : "Coinbase handles the payout. Check your Coinbase receipt for its status."}
                </Text>
              </Surface>
            ) : null}

            <Button
              title={mode === "buy" ? "Continue to Coinbase" : "Sell with Coinbase"}
              onPress={() => void openCheckout()}
              disabled={amount === null || busy}
              loading={busy}
            />
            <Text style={[type.dim, styles.attribution]}>
              Payments are processed by Coinbase under Coinbase&apos;s terms and identity checks. FurlPay never holds your card or bank details.
            </Text>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing.lg, gap: spacing.md },
  card: { padding: spacing.md, gap: spacing.sm },
  attribution: { textAlign: "center" },
});
