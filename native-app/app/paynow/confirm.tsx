import React, { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { classifySgqrScan } from "@/lib/sgqr";
import { colors, radius, spacing, type } from "@/lib/theme";
import { Button, Field, Screen } from "@/components/ui";

// Confirmation for a scanned Singapore SGQR / PayNow label.
//
// WHAT THIS SCREEN IS FOR — the same reason the UPI confirm screen exists, and
// a sharper one. A PayNow sticker on a hawker stall is a printed sheet of
// paper. Anyone can print another and tape it over the real one; this has
// happened repeatedly in Singapore. Everything on the label EXCEPT the proxy
// (the UEN or mobile number) is decoration: the merchant name is a string the
// person who printed the QR chose. So the proxy is displayed with equal weight
// to the name, never tucked underneath it as a subtitle.
//
// The CRC is verified before this screen is reachable (classifySgqrScan refuses
// a bad checksum at the scanner), which catches a corrupted or clumsily edited
// label — but NOT a cleanly re-generated fake, because an attacker computes a
// valid CRC too. The checksum proves integrity, not authenticity. Only the
// proxy identifies who gets paid, which is why the user has to look at it.
//
// NOTE: this screen does not move money yet. The PayNow payout rail
// (apps/web/src/lib/rails/singapore/straitsx.ts) has no live implementation
// and hard-stops in production, so "Confirm" is deliberately disabled with the
// reason shown rather than wired to something that would fail after the user
// believed they had paid.
export default function PayNowConfirm() {
  const router = useRouter();
  const { payload } = useLocalSearchParams<{ payload: string }>();
  const scan = useMemo(() => (payload ? classifySgqrScan(payload) : { kind: "not_sgqr" as const }), [payload]);

  // A static sticker carries no amount — the user supplies one.
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (scan.kind !== "payable") {
    const detail =
      scan.kind === "unpayable"
        ? scan.detail
        : "That QR is not a Singapore PayNow code.";
    return (
      <Screen style={styles.center}>
        <Text style={[type.body, styles.centered]}>{detail}</Text>
        <Button title="Back to scanner" onPress={() => router.replace("/scan")} />
      </Screen>
    );
  }

  const { payment, payNow } = scan;
  const fixedAmount = payment.amountCents !== undefined && !payNow.amountEditable;
  const needsAmount = payment.amountCents === undefined;

  const displayAmount =
    payment.amountCents !== undefined
      ? `S$${(payment.amountCents / 100).toFixed(2)}`
      : amount.trim()
        ? `S$${amount.trim()}`
        : "—";

  const onConfirm = () => {
    setError(null);
    if (needsAmount && !/^\d{1,7}(?:\.\d{1,2})?$/.test(amount.trim())) {
      setError("Enter an amount in Singapore dollars, e.g. 4.80");
      return;
    }
    // Honest dead end rather than a spinner that resolves into nothing. When
    // the StraitsX FAST payout rail is live this is where it gets called.
    setError(
      "PayNow payments aren't switched on in this build yet — nothing has been charged. The code scanned correctly."
    );
  };

  return (
    <Screen style={styles.screen}>
      <Text style={[type.dim, styles.centered]}>Paying via PayNow</Text>

      {/* The proxy is what actually routes the money. It is shown at full
          weight beside the name, which is unverified QR content. */}
      <View style={styles.card}>
        <Text style={type.dim}>{payNow.proxyType === "uen" ? "Business (UEN)" : "Mobile"}</Text>
        <Text style={[type.body, styles.proxy]}>{payNow.proxyValue}</Text>

        {payment.merchantName ? (
          <>
            <Text style={[type.dim, styles.spaced]}>Name on the code</Text>
            <Text style={type.body}>{payment.merchantName}</Text>
          </>
        ) : null}

        {payment.merchantCity ? (
          <Text style={[type.dim, styles.spaced]}>{payment.merchantCity}</Text>
        ) : null}

        {payment.referenceLabel || payment.billNumber ? (
          <>
            <Text style={[type.dim, styles.spaced]}>Reference</Text>
            <Text style={type.body}>{payment.referenceLabel ?? payment.billNumber}</Text>
          </>
        ) : null}
      </View>

      <View style={styles.card}>
        <Text style={type.dim}>Amount</Text>
        <Text style={[type.body, styles.amount]}>{displayAmount}</Text>
        {fixedAmount ? (
          <Text style={type.dim}>Set by the merchant and not editable on this code.</Text>
        ) : null}
      </View>

      {needsAmount ? (
        <Field
          label="Amount (SGD)"
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          placeholder="4.80"
        />
      ) : null}

      {/* The one thing the user must actually check. Kept as plain visible
          text, not a dismissible toast: it is the only defence against a
          pasted-over sticker, and a warning nobody reads is not a defence. */}
      <Text style={[type.dim, styles.centered]}>
        Check the {payNow.proxyType === "uen" ? "UEN" : "number"} above matches the merchant before paying.
      </Text>

      {error ? <Text style={[type.dim, styles.error]}>{error}</Text> : null}

      <Button title="Confirm payment" onPress={onConfirm} />
      <Button title="Cancel" onPress={() => router.replace("/scan")} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { gap: spacing.md, padding: spacing.md },
  center: { alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.lg },
  centered: { textAlign: "center" },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  proxy: { fontVariant: ["tabular-nums"], fontSize: 18, fontWeight: "700" },
  amount: { fontVariant: ["tabular-nums"], fontSize: 24, fontWeight: "700" },
  spaced: { marginTop: spacing.sm },
  error: { textAlign: "center", color: colors.warning },
});
