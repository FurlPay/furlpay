import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Defs, LinearGradient as SvgGradient, Path, Stop } from "react-native-svg";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { colors, radius, spacing, type } from "@/lib/theme";

// Interactive price chart over GET /api/markets/bars — the native counterpart
// of the web's PriceChart. Pure SVG (react-native-svg), no chart library.

const TIMEFRAMES = ["1D", "1W", "1M", "3M", "1Y", "ALL"] as const;
type Tf = (typeof TIMEFRAMES)[number];

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

const W = 340;
const H = 120;

function pathFor(candles: Candle[]): { line: string; area: string; up: boolean } {
  const closes = candles.map((c) => c.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min || 1;
  const pts = closes.map((v, i) => {
    const x = (i / Math.max(1, closes.length - 1)) * W;
    const y = H - ((v - min) / span) * (H - 8) - 4;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = `M${pts.join(" L")}`;
  const area = `${line} L${W},${H} L0,${H} Z`;
  return { line, area, up: closes[closes.length - 1] >= closes[0] };
}

export function PriceChart({ symbol }: { symbol: string }) {
  const [tf, setTf] = useState<Tf>("1M");
  const { data, isLoading } = useQuery({
    queryKey: ["bars", symbol, tf],
    queryFn: () => api<{ candles: Candle[] }>(`/markets/bars?symbol=${symbol}&tf=${tf}`),
    staleTime: 120_000,
    retry: 0, // 404 = no history source for this asset; show the empty note
  });

  const candles = data?.candles ?? [];
  const geom = useMemo(() => (candles.length >= 2 ? pathFor(candles) : null), [candles]);
  const stroke = geom?.up === false ? colors.accent : colors.neon;

  return (
    <View style={styles.wrap}>
      {geom ? (
        <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          <Defs>
            <SvgGradient id="fill" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={stroke} stopOpacity="0.25" />
              <Stop offset="1" stopColor={stroke} stopOpacity="0" />
            </SvgGradient>
          </Defs>
          <Path d={geom.area} fill="url(#fill)" />
          <Path d={geom.line} stroke={stroke} strokeWidth={2} fill="none" />
        </Svg>
      ) : (
        <View style={[styles.placeholder, { height: H }]}>
          <Text style={type.dim}>{isLoading ? "Loading chart…" : "No price history available"}</Text>
        </View>
      )}
      <View style={styles.tfs}>
        {TIMEFRAMES.map((t) => (
          <Pressable key={t} onPress={() => setTf(t)} style={[styles.tf, tf === t && styles.tfActive]}>
            <Text
              style={{
                color: tf === t ? colors.onNeon : colors.textDim,
                fontWeight: "700",
                fontSize: 12,
              }}
            >
              {t}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  placeholder: { alignItems: "center", justifyContent: "center" },
  tfs: { flexDirection: "row", justifyContent: "space-between" },
  tf: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  tfActive: { backgroundColor: colors.neon },
});
