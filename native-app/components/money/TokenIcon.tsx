import React, { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { hasTokenMark, TokenGlyph } from "@/components/money/TokenGlyphs";
import { CHAINS, type ChainId, type SwapAsset } from "@/lib/swap/assets";
import { colors } from "@/lib/theme";

// Token icon with an optional chain badge.
//
// Drawn from the asset's own colour and glyph rather than fetched. On a money
// screen the icon is the thing a user scans to confirm they picked the right
// asset, so it has to be there before the network is — a spinner or a broken
// image in that position reads as a broken app, not a slow one.
//
// The badge is what makes "USDC" unambiguous: the same symbol exists on five
// chains and they are not interchangeable. Showing the chain on the icon means
// a user never has to cross-reference a separate row to know what they hold.

interface Props {
  asset: SwapAsset;
  chain?: ChainId;
  size?: number;
  /** Dim the icon for assets that cannot be routed yet. */
  muted?: boolean;
}

function TokenIconBase({ asset, chain, size = 40, muted = false }: Props) {
  const badge = Math.round(size * 0.42);
  const chainMeta = chain ? CHAINS[chain] : undefined;
  // 56% of the tile — the optical size at which a mark reads as a logo sitting
  // ON a coin rather than a shape cropped by one.
  const glyph = hasTokenMark(asset.symbol) ? (
    <TokenGlyph
      symbol={asset.symbol}
      size={Math.round(size * 0.56)}
      color={muted ? colors.textFaint : "#FFFFFF"}
    />
  ) : null;

  return (
    <View style={{ width: size, height: size }}>
      <View
        style={[
          styles.token,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: muted ? colors.surfaceRaised : asset.color,
            opacity: muted ? 0.5 : 1,
          },
        ]}
      >
        {/* The official brand mark when one is published, the drawn lettermark
            otherwise. Never a remote image, and never a blank tile. */}
        {glyph ?? (
          <Text
            allowFontScaling={false}
            style={[
              styles.glyph,
              {
                fontSize: Math.round(size * (asset.glyph.length > 1 ? 0.34 : 0.44)),
                color: muted ? colors.textFaint : "#FFFFFF",
              },
            ]}
          >
            {asset.glyph}
          </Text>
        )}
      </View>

      {chainMeta ? (
        <View
          style={[
            styles.badge,
            {
              width: badge,
              height: badge,
              borderRadius: badge / 2,
              backgroundColor: chainMeta.color,
              // Ring in the page background so the badge reads as separate from
              // the token even when their colours are close.
              borderColor: colors.bg,
              opacity: muted ? 0.5 : 1,
            },
          ]}
        >
          <Text
            allowFontScaling={false}
            style={[styles.badgeText, { fontSize: Math.round(badge * 0.44) }]}
            numberOfLines={1}
          >
            {chainMeta.short.slice(0, 2)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  token: { alignItems: "center", justifyContent: "center" },
  glyph: { fontWeight: "800", includeFontPadding: false },
  badge: {
    position: "absolute",
    right: -2,
    bottom: -2,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: "#0B0B0B", fontWeight: "900", includeFontPadding: false },
});

// The catalogue is static, so an icon only re-renders when its own inputs move.
// On a list of 40 assets re-rendering on every keystroke of the search box is
// the difference between a smooth filter and a janky one.
export const TokenIcon = memo(TokenIconBase);
