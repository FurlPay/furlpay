import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SvgUri } from "react-native-svg";
import { API_BASE } from "@/lib/api";
import { colors, radius } from "@/lib/theme";

// Native counterpart of the web app's <AssetLogo> (@furlpay/ui). Renders the
// self-hosted TradingView symbol mark that /api/markets returns as `logo`
// (e.g. "/logos/stocks/aapl.svg"), served from furlpay.com. Before this, the
// native markets/holdings screens showed only a 2-letter stub while the web/TWA
// showed real logos — the "missing stock icons" gap.
//
// The logo is an SVG, so we load it with react-native-svg's SvgUri. The 2-letter
// stub renders underneath as an instant, always-present fallback: it shows while
// the SVG loads, and stays if the asset has no logo (logo === null) or the fetch
// fails. So a row is never blank and never a broken-image box.

const ORIGIN = API_BASE.replace(/\/api$/, "");

export function AssetLogo({
  symbol,
  logo,
  size = 38,
}: {
  symbol: string;
  logo?: string | null;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const uri = logo ? (logo.startsWith("http") ? logo : `${ORIGIN}${logo}`) : null;
  const showSvg = Boolean(uri) && !failed;

  return (
    <View style={[styles.wrap, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.stub, { fontSize: size * 0.34 }]} numberOfLines={1}>
        {symbol.slice(0, 2).toUpperCase()}
      </Text>
      {showSvg ? (
        <View style={[StyleSheet.absoluteFill, styles.center]}>
          <SvgUri
            uri={uri as string}
            width={size}
            height={size}
            onError={() => setFailed(true)}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.neonSoft,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  center: { alignItems: "center", justifyContent: "center" },
  stub: { color: colors.neon, fontWeight: "800" },
});
