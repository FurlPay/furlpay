import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Circle, Path } from "react-native-svg";
import { usd } from "@/lib/format";
import { trips, tripsRadius } from "./tripsTheme";
import type { BoardingPass } from "@/lib/boardingPass";

/** USDC — blue disc, white ring, white dollar glyph. */
function UsdcCoin({ size = 30 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      <Circle cx={16} cy={16} r={16} fill="#2775CA" />
      <Circle cx={16} cy={16} r={11.6} fill="none" stroke="#fff" strokeWidth={1.5} />
      <Path
        d="M16 8.6v1.5c2 .2 3.4 1.3 3.7 3.1h-2c-.2-.9-.9-1.5-2.2-1.5-1.3 0-2 .55-2 1.35 0 .75.45 1.15 2.1 1.4 2.55.4 4.2 1.1 4.2 3.3 0 1.85-1.35 3-3.8 3.25V22h-1.6v-1.5c-2.2-.25-3.65-1.4-3.95-3.25h2c.2 1 1 1.65 2.5 1.65 1.5 0 2.25-.6 2.25-1.45 0-.85-.5-1.25-2.3-1.55-2.6-.4-3.95-1.2-3.95-3.15 0-1.75 1.3-2.9 3.45-3.15V8.6H16Z"
        fill="#fff"
      />
    </Svg>
  );
}

/** Settlement receipt: what was paid for this trip, in what, and what it earned. */
export function PaidWithCard({ payment }: { payment: BoardingPass["payment"] }) {
  return (
    <View style={styles.card}>
      <View style={styles.headRow}>
        <View style={styles.check}>
          <Ionicons name="checkmark" size={15} color="#FFFFFF" />
        </View>
        <Text style={styles.headText}>PAID WITH FURLPAY</Text>
      </View>

      <View style={styles.amountRow}>
        <View style={styles.token}>
          <UsdcCoin size={30} />
          <Text style={styles.tokenText}>{payment.currency}</Text>
        </View>
        <Text style={styles.amount}>{usd(payment.amount)}</Text>
      </View>

      <View style={styles.rewardRow}>
        <Text style={styles.reward}>
          <Text style={styles.rewardRate}>{payment.rewardsRate}%</Text> FurlPay Rewards
        </Text>
        <Ionicons name="sparkles-outline" size={18} color="#7FE0AB" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: tripsRadius.card,
    borderWidth: 1,
    borderColor: trips.border,
    backgroundColor: "rgba(11, 54, 39, 0.55)",
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 20,
    gap: 18,
  },
  headRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  check: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#217A47",
    alignItems: "center",
    justifyContent: "center",
  },
  headText: { fontSize: 16, fontWeight: "500", letterSpacing: 0.7, color: "#4FBF83" },
  amountRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  token: { flexDirection: "row", alignItems: "center", gap: 11, minWidth: 0 },
  tokenText: { fontSize: 28, fontWeight: "700", color: "#FFFFFF", letterSpacing: -0.6 },
  amount: { fontSize: 28, fontWeight: "700", color: "#FFFFFF", letterSpacing: -0.6 },
  rewardRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  reward: { fontSize: 16, color: "#63C793" },
  rewardRate: { fontWeight: "700", color: trips.greenBright },
});
