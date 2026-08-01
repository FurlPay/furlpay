import React, { memo, useCallback, useMemo, useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { TokenIcon } from "@/components/money/TokenIcon";
import { Button } from "@/components/ui";
import { usd } from "@/lib/format";
import { assetForToken } from "@/lib/send/useSend";
import { CHAINS, type ChainId } from "@/lib/swap/assets";
import { colors, radius, spacing, type } from "@/lib/theme";
import type { TokenBalance } from "@/lib/types";

// Which balance the payment comes out of — the send counterpart of the swap
// screen's TokenSelector, and the same sheet: full-height, searchable, one row
// per option, chain shown on the icon badge.
//
// EMPTY BALANCES ARE SHOWN AND DISABLED, not hidden — the same rule the swap
// selector applies to unroutable assets, for the same reason. A user who holds
// USDT on a chain with nothing in it should see "Nothing to send" against it,
// not a list that silently omits an asset they know they have somewhere.

interface Props {
  visible: boolean;
  balances: TokenBalance[];
  selected: TokenBalance | null;
  onClose: () => void;
  onSelect: (balance: TokenBalance) => void;
}

const keyOf = (b: TokenBalance) => `${b.token}-${b.chain}`;

export function SourceSelector({ visible, balances, selected, onClose, onSelect }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = balances.filter(
      (b) =>
        !q ||
        b.token.toLowerCase().includes(q) ||
        b.chain.toLowerCase().includes(q) ||
        CHAINS[b.chain as ChainId]?.name.toLowerCase().includes(q)
    );
    // Spendable first, then by value — a zero row at the top of the list would
    // be actively unhelpful.
    return [...matched].sort(
      (a, b) =>
        Number(b.usdValue > 0) - Number(a.usdValue > 0) ||
        b.usdValue - a.usdValue ||
        a.token.localeCompare(b.token)
    );
  }, [balances, query]);

  const choose = useCallback(
    (b: TokenBalance) => {
      void Haptics.selectionAsync();
      onSelect(b);
      setQuery("");
      onClose();
    },
    [onClose, onSelect]
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.sheet}>
        <View style={styles.header}>
          <Text style={type.h2}>Pay with</Text>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Close balance picker"
          >
            <Ionicons name="close" size={24} color={colors.textDim} />
          </Pressable>
        </View>

        <View style={styles.search}>
          <Ionicons name="search" size={18} color={colors.textFaint} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search asset or network"
            placeholderTextColor={colors.textFaint}
            style={styles.searchInput}
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Search your balances"
          />
          {query ? (
            <Pressable onPress={() => setQuery("")} hitSlop={10} accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={18} color={colors.textFaint} />
            </Pressable>
          ) : null}
        </View>

        <FlatList
          data={rows}
          keyExtractor={keyOf}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: spacing.xl }}
          renderItem={({ item }) => (
            <BalanceRow
              balance={item}
              isSelected={!!selected && keyOf(selected) === keyOf(item)}
              onPress={() => {
                if (item.usdValue <= 0) {
                  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                  return;
                }
                choose(item);
              }}
            />
          )}
          ListEmptyComponent={
            query ? (
              <Text style={[type.dim, styles.empty]}>Nothing matches “{query}”.</Text>
            ) : (
              // Reaching this sheet with nothing in it used to be a dead end.
              // The question a user actually has here is "so how do I get
              // something to send?", so answer it rather than restating the
              // emptiness they can already see.
              <View style={styles.emptyState}>
                <Ionicons name="wallet-outline" size={28} color={colors.textFaint} />
                <Text style={[type.body, { fontWeight: "700" }]}>Nothing to send yet</Text>
                <Text style={[type.dim, { textAlign: "center" }]}>
                  Add funds to your account and they'll appear here as assets you can send.
                </Text>
                <Button
                  title="Receive funds"
                  onPress={() => {
                    onClose();
                    router.push("/receive");
                  }}
                  style={{ alignSelf: "stretch" }}
                />
              </View>
            )
          }
        />
      </View>
    </Modal>
  );
}

const BalanceRow = memo(function BalanceRow({
  balance,
  isSelected,
  onPress,
}: {
  balance: TokenBalance;
  isSelected: boolean;
  onPress: () => void;
}) {
  const empty = balance.usdValue <= 0;
  const asset = assetForToken(balance.token);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        pressed && !empty ? styles.rowPressed : null,
        isSelected ? styles.rowSelected : null,
      ]}
      accessibilityRole="button"
      accessibilityState={{ disabled: empty, selected: isSelected }}
      accessibilityLabel={
        empty
          ? `${balance.token} on ${CHAINS[balance.chain as ChainId]?.name ?? balance.chain}. Nothing to send.`
          : `${balance.token} on ${CHAINS[balance.chain as ChainId]?.name ?? balance.chain}, ${usd(balance.usdValue)} available`
      }
    >
      <TokenIcon asset={asset} chain={balance.chain as ChainId} size={40} muted={empty} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.symbol, empty && styles.mutedText]}>{balance.token}</Text>
        <Text style={[type.dim, empty && styles.mutedText]} numberOfLines={1}>
          {CHAINS[balance.chain as ChainId]?.name ?? balance.chain}
        </Text>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={[styles.value, empty && styles.mutedText]}>
          {empty ? "Nothing to send" : usd(balance.usdValue)}
        </Text>
        <Text style={styles.amount} numberOfLines={1}>
          {balance.amount.toLocaleString(undefined, { maximumFractionDigits: 6 })} {balance.token}
        </Text>
      </View>
      {isSelected && !empty ? (
        <Ionicons name="checkmark-circle" size={20} color={colors.neon} />
      ) : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: colors.bg, paddingTop: spacing.md },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 15, padding: 0 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
  },
  rowPressed: { backgroundColor: colors.surface },
  rowSelected: { backgroundColor: colors.surface },
  symbol: { color: colors.text, fontSize: 16, fontWeight: "700" },
  mutedText: { color: colors.textFaint },
  value: { color: colors.text, fontSize: 14, fontWeight: "700" },
  amount: { color: colors.textFaint, fontSize: 11 },
  empty: { textAlign: "center", paddingTop: spacing.xl },
  emptyState: {
    alignItems: "center",
    gap: spacing.sm,
    paddingTop: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
});
