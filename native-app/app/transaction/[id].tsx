import React from "react";
import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { getCachedTransaction } from "@/lib/db";
import { txDate, usd } from "@/lib/format";
import { colors, spacing, type } from "@/lib/theme";
import { Button, EmptyState, Screen, StatusBadge, Surface } from "@/components/ui";

const EXPLORERS: Record<string, string> = {
  arbitrum: "https://arbiscan.io/tx/",
  base: "https://basescan.org/tx/",
  ethereum: "https://etherscan.io/tx/",
  polygon: "https://polygonscan.com/tx/",
  gnosis: "https://gnosisscan.io/tx/",
  solana: "https://solscan.io/tx/",
};

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <Text style={type.dim}>{label}</Text>
      {typeof value === "string" ? (
        <Text style={[type.body, { flexShrink: 1, textAlign: "right" }]}>{value}</Text>
      ) : (
        value
      )}
    </View>
  );
}

export default function TransactionDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // Reads the SQLite cache — every list screen upserts rows on fetch, so any
  // transaction the user can tap is present, online or offline.
  const tx = id ? getCachedTransaction(id) : null;

  if (!tx) {
    return (
      <Screen>
        <EmptyState title="Transaction not found" subtitle="Pull to refresh the list and try again." />
      </Screen>
    );
  }

  const inbound = tx.direction === "in";
  // Demo tx hashes live in the subtitle only for some rails; when the id
  // itself is a hash-shaped string, deep-link the explorer.
  const explorer = tx.chain && /^0x[0-9a-fA-F]{64}$/.test(tx.id) ? EXPLORERS[tx.chain] : null;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={{ alignItems: "center", gap: 6 }}>
          <Text style={[styles.amount, { color: inbound ? colors.neon : colors.text }]}>
            {inbound ? "+" : "-"}
            {usd(tx.amountUsd)}
          </Text>
          <Text style={type.body}>{tx.title}</Text>
          <StatusBadge status={tx.status} />
        </View>

        <Surface style={{ gap: 4 }}>
          <Row label="When" value={txDate(tx.timestamp)} />
          <Row label="Category" value={tx.category} />
          <Row label="Direction" value={inbound ? "Received" : "Sent"} />
          {tx.token ? <Row label="Token" value={tx.token} /> : null}
          {tx.chain ? <Row label="Chain" value={tx.chain} /> : null}
          <Row label="Detail" value={tx.subtitle} />
          <Row label="Reference" value={tx.id} />
        </Surface>

        {explorer ? (
          <Button
            title="View on explorer"
            variant="secondary"
            onPress={() => void Linking.openURL(`${explorer}${tx.id}`)}
          />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xl },
  amount: { fontSize: 40, fontWeight: "800", letterSpacing: -1 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: 6,
  },
});
