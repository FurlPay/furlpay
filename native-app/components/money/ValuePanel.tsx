import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { TokenIcon } from "@/components/money/TokenIcon";
import { CHAINS, type ChainId, type SwapAsset } from "@/lib/swap/assets";
import { colors, radius, spacing } from "@/lib/theme";

// One side of a money movement: a caption, the asset it is denominated in, and
// whatever control enters or displays the figure.
//
// SHARED BY SWAP AND SEND so the two screens are the same object in the user's
// head. Swap stacks two of these with a flip control on the seam; send stacks
// the amount panel over the recipient panel. Same surface, same asset pill,
// same caption treatment — only the contents differ.

export function ValuePanel({
  caption,
  asset,
  chain,
  onPress,
  disabled,
  placeholder = "Select asset",
  children,
}: {
  caption: string;
  asset?: SwapAsset;
  /**
   * Optional on purpose. With no asset chosen there IS no network, and naming
   * one anyway — "Arbitrum One" under a pill reading "Select" — states a
   * selection the user never made. On a screen that moves money, a default
   * dressed up as a choice is the same class of problem as a fabricated
   * balance.
   */
  chain?: ChainId;
  onPress: () => void;
  disabled?: boolean;
  /** Shown in place of a symbol when nothing is chosen yet. */
  placeholder?: string;
  /** Amount input, output figure, or recipient control. */
  children?: React.ReactNode;
}) {
  const chainName = asset && chain ? CHAINS[chain]?.name : undefined;

  return (
    <View style={styles.panel}>
      <View style={styles.panelHead}>
        <Text style={styles.caption}>{caption}</Text>
        <Pressable
          onPress={() => {
            void Haptics.selectionAsync();
            onPress();
          }}
          disabled={disabled}
          style={({ pressed }) => [styles.assetPill, pressed && styles.assetPillPressed]}
          accessibilityRole="button"
          accessibilityLabel={
            asset
              ? `${caption}: ${asset.name}${chainName ? ` on ${chainName}` : ""}. Change asset.`
              : `${caption}: ${placeholder}`
          }
        >
          {asset ? (
            <TokenIcon asset={asset} chain={chain} size={28} />
          ) : (
            // A neutral coin-shaped placeholder, not an empty gap: the pill
            // keeps its shape and reads as "an asset goes here".
            <View style={styles.placeholderIcon}>
              <Ionicons name="ellipse-outline" size={16} color={colors.textFaint} />
            </View>
          )}
          <View>
            <Text style={[styles.assetSymbol, !asset && { color: colors.textDim }]}>
              {asset?.symbol ?? placeholder}
            </Text>
            {chainName ? <Text style={styles.assetChain}>{chainName}</Text> : null}
          </View>
          {disabled ? null : <Ionicons name="chevron-down" size={16} color={colors.textFaint} />}
        </Pressable>
      </View>
      {children}
    </View>
  );
}

/** A plain panel with a caption and no asset pill — used where the right-hand
 *  side of the header has nothing to choose (the recipient panel's own actions
 *  live inside it, next to the field they act on). */
export function CaptionPanel({
  caption,
  right,
  children,
}: {
  caption: string;
  right?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <View style={styles.panel}>
      <View style={styles.panelHead}>
        <Text style={styles.caption}>{caption}</Text>
        {right}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  panelHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    minHeight: 40,
  },
  caption: { color: colors.textFaint, fontSize: 12, fontWeight: "700", letterSpacing: 0.6 },
  assetPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingLeft: 6,
    paddingRight: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  assetPillPressed: { borderColor: colors.neon },
  placeholderIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  assetSymbol: { color: colors.text, fontSize: 15, fontWeight: "700" },
  assetChain: { color: colors.textFaint, fontSize: 11 },
});

/** The panel surface itself, exported so a screen that needs its own gesture
 *  handling on the card (the send recipient card holds-to-paste) can render an
 *  identical surface rather than approximate one. */
export const PANEL_STYLE = styles.panel;
export const PANEL_HEAD_STYLE = styles.panelHead;
export const PANEL_CAPTION_STYLE = styles.caption;
