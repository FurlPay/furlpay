import React, { memo, useCallback, useMemo, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { TokenIcon } from "@/components/money/TokenIcon";
import {
  ASSETS,
  CHAINS,
  isAssetUnroutable,
  routableChainsFor,
  type ChainId,
  type SwapAsset,
} from "@/lib/swap/assets";
import { colors, radius, spacing, type } from "@/lib/theme";

// Asset picker — a full-height sheet with search, recents and chain choice.
//
// Unroutable assets are SHOWN AND DISABLED rather than hidden. Hiding SOL would
// make the app look like it does not know about Solana; showing it greyed with
// "Routing coming soon" tells the user the capability is planned and stops the
// question before it reaches support. It also means the list does not silently
// change shape the day Jupiter ships.
//
// FlatList rather than a mapped ScrollView: the catalogue is small today but a
// token list only grows, and the two cost the same to write.

interface Props {
  visible: boolean;
  title: string;
  /** Symbol currently selected, if any. */
  selected?: string;
  selectedChain?: ChainId;
  /** Symbols used recently, most recent first. */
  recents?: string[];
  onClose: () => void;
  onSelect: (asset: SwapAsset, chain: ChainId) => void;
}

interface Row {
  asset: SwapAsset;
  disabled: boolean;
  reason?: string;
}

export function TokenSelector({
  visible,
  title,
  selected,
  selectedChain,
  recents = [],
  onClose,
  onSelect,
}: Props) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    const matched = ASSETS.filter(
      (a) => !q || a.symbol.toLowerCase().includes(q) || a.name.toLowerCase().includes(q)
    );

    const scored = matched.map<Row & { rank: number }>((asset) => {
      const unroutable = isAssetUnroutable(asset);
      const recentIdx = recents.indexOf(asset.symbol);
      return {
        asset,
        disabled: unroutable,
        reason: unroutable ? CHAINS[asset.chains[0]].unroutableReason : undefined,
        // Routable first, then recents, then alphabetical. A disabled row at the
        // top of the list would be actively unhelpful.
        rank: (unroutable ? 1000 : 0) + (recentIdx >= 0 ? recentIdx : 500),
      };
    });

    return scored
      .sort((a, b) => a.rank - b.rank || a.asset.symbol.localeCompare(b.asset.symbol))
      .map(({ asset, disabled, reason }) => ({ asset, disabled, reason }));
  }, [query, recents]);

  const choose = useCallback(
    (asset: SwapAsset, chain: ChainId) => {
      void Haptics.selectionAsync();
      onSelect(asset, chain);
      setQuery("");
      setExpanded(null);
      onClose();
    },
    [onClose, onSelect]
  );

  const renderItem = useCallback(
    ({ item }: { item: Row }) => (
      <AssetRow
        row={item}
        isSelected={item.asset.symbol === selected}
        selectedChain={selectedChain}
        expanded={expanded === item.asset.symbol}
        onPress={() => {
          if (item.disabled) {
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            return;
          }
          const chains = routableChainsFor(item.asset);
          // One routable chain is not a choice — skip the expansion entirely.
          if (chains.length === 1) return choose(item.asset, chains[0].id);
          setExpanded((e) => (e === item.asset.symbol ? null : item.asset.symbol));
          void Haptics.selectionAsync();
        }}
        onPickChain={(chain) => choose(item.asset, chain)}
      />
    ),
    [choose, expanded, selected, selectedChain]
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.header}>
          <Text style={type.h2}>{title}</Text>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Close asset picker"
          >
            <Ionicons name="close" size={24} color={colors.textDim} />
          </Pressable>
        </View>

        <View style={styles.search}>
          <Ionicons name="search" size={18} color={colors.textFaint} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search name or symbol"
            placeholderTextColor={colors.textFaint}
            style={styles.searchInput}
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Search assets"
          />
          {query ? (
            <Pressable onPress={() => setQuery("")} hitSlop={10} accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={18} color={colors.textFaint} />
            </Pressable>
          ) : null}
        </View>

        <FlatList
          data={rows}
          keyExtractor={(r) => r.asset.symbol}
          renderItem={renderItem}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: spacing.xl }}
          ListEmptyComponent={
            <Text style={[type.dim, styles.empty]}>No asset matches “{query}”.</Text>
          }
        />
      </View>
    </Modal>
  );
}

const AssetRow = memo(function AssetRow({
  row,
  isSelected,
  selectedChain,
  expanded,
  onPress,
  onPickChain,
}: {
  row: Row;
  isSelected: boolean;
  selectedChain?: ChainId;
  expanded: boolean;
  onPress: () => void;
  onPickChain: (chain: ChainId) => void;
}) {
  const { asset, disabled, reason } = row;
  const chains = routableChainsFor(asset);

  return (
    <View>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.row,
          pressed && !disabled ? styles.rowPressed : null,
          isSelected ? styles.rowSelected : null,
        ]}
        accessibilityRole="button"
        accessibilityState={{ disabled, selected: isSelected, expanded }}
        accessibilityLabel={
          disabled ? `${asset.name}. ${reason}` : `${asset.name}, ${asset.symbol}`
        }
      >
        <TokenIcon asset={asset} chain={asset.chains[0]} size={40} muted={disabled} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.symbolLine}>
            <Text style={[styles.symbol, disabled && styles.mutedText]}>{asset.symbol}</Text>
            {asset.assetClass === "equity" || asset.assetClass === "etf" ? (
              <View style={styles.tag}>
                <Text style={styles.tagText}>Tokenized</Text>
              </View>
            ) : null}
          </View>
          <Text style={[type.dim, disabled && styles.mutedText]} numberOfLines={1}>
            {disabled ? reason : asset.name}
          </Text>
        </View>
        {disabled ? (
          <Ionicons name="time-outline" size={18} color={colors.textFaint} />
        ) : chains.length > 1 ? (
          <Ionicons
            name={expanded ? "chevron-up" : "chevron-down"}
            size={18}
            color={colors.textFaint}
          />
        ) : isSelected ? (
          <Ionicons name="checkmark-circle" size={20} color={colors.neon} />
        ) : null}
      </Pressable>

      {expanded && !disabled ? (
        <View style={styles.chainRow}>
          {chains.map((c) => {
            const active = isSelected && selectedChain === c.id;
            return (
              <Pressable
                key={c.id}
                onPress={() => onPickChain(c.id)}
                style={[styles.chainChip, active && { borderColor: colors.neon }]}
                accessibilityRole="button"
                accessibilityLabel={`${asset.symbol} on ${c.name}`}
                accessibilityState={{ selected: active }}
              >
                <View style={[styles.chainDot, { backgroundColor: c.color }]} />
                <Text style={[styles.chainText, active && { color: colors.neon }]}>{c.name}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
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
  symbolLine: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  symbol: { color: colors.text, fontSize: 16, fontWeight: "700" },
  mutedText: { color: colors.textFaint },
  tag: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceRaised,
  },
  tagText: { color: colors.textDim, fontSize: 10, fontWeight: "700" },
  chainRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingLeft: spacing.lg + 40 + spacing.md,
    paddingBottom: spacing.sm,
  },
  chainChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chainDot: { width: 8, height: 8, borderRadius: 4 },
  chainText: { color: colors.textDim, fontSize: 13, fontWeight: "600" },
  empty: { textAlign: "center", paddingTop: spacing.xl },
});
