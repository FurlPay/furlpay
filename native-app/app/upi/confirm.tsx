import React, { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { openUpiApp, parseUpiUri } from "@/lib/upi";
import { colors, radius, spacing, type } from "@/lib/theme";
import { Button, Field, Screen } from "@/components/ui";

// Confirmation for a scanned UPI QR, immediately before handing off to the
// user's UPI app.
//
// WHAT THIS SCREEN IS FOR. Everything shown here except the VPA came out of a
// QR that anyone could have printed and taped over the real one. The merchant
// NAME is not evidence of who gets paid — the VPA is — so the VPA is displayed
// with equal weight rather than tucked away as a subtitle. That is the whole
// reason this screen exists instead of launching the payment app directly.
//
// FurlPay does not move this money: the installed UPI app and the user's bank
// do. No balance is debited here and no FurlPay ledger entry is written.
export default function UpiConfirm() {
  const router = useRouter();
  const { uri } = useLocalSearchParams<{ uri: string }>();
  const request = useMemo(() => (uri ? parseUpiUri(uri) : null), [uri]);

  // Static QRs carry no amount — the user supplies one.
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!request) {
    return (
      <Screen style={styles.center}>
        <Text style={[type.body, styles.centered]}>
          That UPI code could not be read. Ask the merchant for a fresh one.
        </Text>
        <Button title="Back to scanner" onPress={() => router.replace("/scan")} />
      </Screen>
    );
  }

  const needsAmount = request.amount === null;
  const payAmount = request.amount ?? amount.trim();

  const onPay = async () => {
    setError(null);
    if (needsAmount && !/^\d{1,9}(?:\.\d{1,2})?$/.test(payAmount)) {
      setError("Enter an amount in rupees, e.g. 250 or 250.50");
      return;
    }
    setBusy(true);
    try {
      const result = await openUpiApp(request, needsAmount ? payAmount : undefined);
      if (result.ok) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        return;
      }
      // Never fail silently at a shop counter — say what to do instead.
      setError(
        result.reason === "no_upi_app"
          ? "No UPI app found on this device. Install GPay, PhonePe, or any bank UPI app."
          : result.reason === "unsupported"
            ? "Paying through another app isn't available on iOS yet. Scan this merchant's QR with your bank's UPI app."
            : "Could not open a UPI app. Try again."
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen style={styles.screen}>
      <Text style={[type.dim, styles.centered]}>Paying via UPI</Text>

      {/* Name is unverified QR content; the VPA is what actually routes money,
          so both are shown and the VPA is never hidden. */}
      <View style={styles.payeeCard}>
        <Text style={styles.payeeName}>{request.payeeName ?? "Unknown payee"}</Text>
        <Text style={styles.vpa}>{request.payeeVpa}</Text>
        <Text style={[type.dim, styles.centered, styles.caution]}>
          Check this UPI ID matches the merchant before paying.
        </Text>
      </View>

      {needsAmount ? (
        <Field
          label="Amount (₹)"
          value={amount}
          onChangeText={(t) => {
            setAmount(t);
            setError(null);
          }}
          placeholder="0.00"
          keyboardType="decimal-pad"
        />
      ) : (
        <Text style={styles.amount}>₹{request.amount}</Text>
      )}

      {request.transactionNote ? (
        <Text style={[type.dim, styles.centered]}>{request.transactionNote}</Text>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Button
        title={needsAmount ? "Pay with UPI" : `Pay ₹${request.amount} with UPI`}
        loading={busy}
        onPress={() => void onPay()}
        style={{ alignSelf: "stretch" }}
      />
      <Text style={[type.dim, styles.centered, styles.footnote]}>
        Your UPI app completes this payment from your bank account. FurlPay does
        not hold or move these funds.
      </Text>
      <Button title="Cancel" onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { padding: spacing.xl, gap: spacing.lg },
  center: { alignItems: "center", justifyContent: "center", gap: spacing.lg, padding: spacing.xl },
  centered: { textAlign: "center" },
  payeeCard: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: 6,
    alignItems: "center",
  },
  payeeName: { color: colors.text, fontSize: 20, fontWeight: "700", textAlign: "center" },
  vpa: { color: colors.text, fontSize: 15, fontWeight: "600", opacity: 0.9 },
  caution: { fontSize: 12, marginTop: 4 },
  amount: { color: colors.text, fontSize: 44, fontWeight: "800", textAlign: "center" },
  error: { color: colors.accent, fontSize: 13, textAlign: "center" },
  footnote: { fontSize: 11 },
});
