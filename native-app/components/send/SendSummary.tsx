import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { usd } from "@/lib/format";
import { CHAINS, type ChainId } from "@/lib/swap/assets";
import { colors, radius, spacing, type } from "@/lib/theme";

// What the user is about to authorize, itemised — the send counterpart of the
// swap screen's FeeBreakdown, same card, same progressive disclosure.
//
// The headline is what the RECIPIENT gets, not what leaves the account. On this
// rail they are the same number because gas is sponsored, and saying so
// explicitly is the point: "why did they receive less than I sent" is the
// question a single figure always provokes.
//
// The full recipient address lives under "Advanced details" rather than in the
// headline rows, because it is already shown, grouped and verifiable, on the
// recipient card itself. Repeating it in a cramped right-aligned row would
// invite exactly the ends-only glance that address poisoning relies on.

export interface SendFacts {
  amountUsd: number;
  token: string;
  chain: ChainId;
  destination: string;
  /** Amount restated in the source token, when a unit price is known. */
  tokenEquivalent?: number;
  /** USD value of the source balance, for the "left after" line. */
  balanceUsd?: number;
}

export function SendSummary({ facts }: { facts: SendFacts }) {
  const [open, setOpen] = useState(false);
  const chain = CHAINS[facts.chain];
  const remaining =
    facts.balanceUsd === undefined ? undefined : facts.balanceUsd - facts.amountUsd;

  return (
    <View style={styles.card}>
      <Row label="Recipient gets" value={usd(facts.amountUsd)} strong />
      <Row label="Network" value={chain?.name ?? facts.chain} />
      <Row
        label="Network fee"
        value="Sponsored by FurlPay"
        hint="Gas on this transfer is paid by FurlPay, so the full amount arrives."
      />

      <Pressable
        onPress={() => setOpen((o) => !o)}
        style={styles.disclosure}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={open ? "Hide advanced details" : "Show advanced details"}
      >
        <Text style={styles.disclosureText}>Advanced details</Text>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color={colors.textFaint} />
      </Pressable>

      {open ? (
        <View style={{ gap: spacing.sm }}>
          <Row label="Paying with" value={facts.token} />
          {facts.tokenEquivalent !== undefined ? (
            <Row
              label="Token amount"
              value={`${facts.tokenEquivalent.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${facts.token}`}
            />
          ) : null}
          {facts.balanceUsd !== undefined ? (
            <Row label="Balance before" value={usd(facts.balanceUsd)} />
          ) : null}
          {remaining !== undefined ? (
            <Row label="Balance after" value={usd(Math.max(0, remaining))} />
          ) : null}
          <View style={{ gap: 4 }}>
            <Text style={type.dim}>Recipient</Text>
            <Text style={styles.address} selectable allowFontScaling={false}>
              {facts.destination}
            </Text>
          </View>
          <Text style={[type.dim, styles.disclaimer]}>
            Once {chain?.name ?? facts.chain} confirms this payment it is final. Neither you nor
            FurlPay can reverse it or recover funds sent to the wrong address.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function Row({
  label,
  value,
  hint,
  strong,
}: {
  label: string;
  value: string;
  hint?: string;
  strong?: boolean;
}) {
  return (
    <View style={styles.row} accessible accessibilityLabel={`${label}: ${value}`}>
      <View style={{ flex: 1 }}>
        <Text style={type.dim}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      <Text style={[styles.value, strong && styles.valueStrong]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  row: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  value: { color: colors.text, fontSize: 13, fontWeight: "600", flexShrink: 1, textAlign: "right" },
  valueStrong: { fontSize: 16, fontWeight: "800" },
  hint: { color: colors.textFaint, fontSize: 11, marginTop: 1 },
  disclosure: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  disclosureText: { color: colors.textFaint, fontSize: 13, fontWeight: "600" },
  address: {
    color: colors.text,
    fontFamily: "monospace",
    fontSize: 12,
    lineHeight: 18,
  },
  disclaimer: { marginTop: spacing.xs, lineHeight: 18 },
});
