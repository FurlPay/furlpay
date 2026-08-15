import React, { useMemo, useRef, useState } from "react";
import { PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Defs, Line, LinearGradient as SvgGradient, Path, Rect, Stop } from "react-native-svg";
import { useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { api } from "@/lib/api";
import { colors, radius, spacing, type } from "@/lib/theme";

// Interactive price chart over GET /api/markets/bars — the native counterpart
// of the web's PriceChart. Pure SVG (react-native-svg), no chart library.
//
// Two renderings of the same candles:
//   line     the closes, for the "how has it done" glance
//   candles  full OHLC, for anyone deciding an entry — the API returned
//            open/high/low every time; the old chart just threw them away.
//
// Touch scrubbing: drag across the chart to pin a crosshair on a candle and
// read its date and OHLC in the header row. The readout is the same row that
// shows the period summary when idle, so nothing jumps when a finger lands.

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
const H = 160;
const PAD = 6; // breathing room so extremes don't clip at the viewBox edge

function lineGeom(candles: Candle[]): { line: string; area: string } {
  const closes = candles.map((c) => c.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min || 1;
  const pts = closes.map((v, i) => {
    const x = (i / Math.max(1, closes.length - 1)) * W;
    const y = H - PAD - ((v - min) / span) * (H - PAD * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = `M${pts.join(" L")}`;
  return { line, area: `${line} L${W},${H} L0,${H} Z` };
}

/** y-scale over the full high–low range, not just closes — a candle chart
 *  that clips its own wicks is lying about volatility. */
function candleScale(candles: Candle[]): (v: number) => number {
  const min = Math.min(...candles.map((c) => c.low));
  const max = Math.max(...candles.map((c) => c.high));
  const span = max - min || 1;
  return (v: number) => H - PAD - ((v - min) / span) * (H - PAD * 2);
}

function fmtWhen(time: number, tf: Tf): string {
  const d = new Date(time * 1000);
  if (tf === "1D") {
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: tf === "1Y" || tf === "ALL" ? "2-digit" : undefined });
}

export function PriceChart({ symbol }: { symbol: string }) {
  const [tf, setTf] = useState<Tf>("1M");
  const [mode, setMode] = useState<"line" | "candles">("line");
  const [scrub, setScrub] = useState<number | null>(null);
  const layoutW = useRef(1);
  const lastIdx = useRef<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["bars", symbol, tf],
    queryFn: () => api<{ candles: Candle[] }>(`/markets/bars?symbol=${symbol}&tf=${tf}`),
    staleTime: 120_000,
    retry: 0, // 404 = no history source for this asset; show the empty note
  });

  const candles = useMemo(() => data?.candles ?? [], [data]);
  const n = candles.length;

  const geom = useMemo(() => (n >= 2 ? lineGeom(candles) : null), [candles, n]);
  const yOf = useMemo(() => (n >= 2 ? candleScale(candles) : null), [candles, n]);

  const up = n >= 2 && candles[n - 1].close >= candles[0].close;
  const stroke = up ? colors.neon : colors.accent;

  // The candle under the finger, resolved from the touch x. The chart renders
  // through a scaled viewBox, so the mapping is a plain ratio of the measured
  // layout width — no per-candle hit testing.
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => n >= 2,
        onMoveShouldSetPanResponder: () => n >= 2,
        onPanResponderGrant: (evt) => {
          const i = Math.max(0, Math.min(n - 1, Math.round((evt.nativeEvent.locationX / layoutW.current) * (n - 1))));
          lastIdx.current = i;
          setScrub(i);
        },
        onPanResponderMove: (evt) => {
          const i = Math.max(0, Math.min(n - 1, Math.round((evt.nativeEvent.locationX / layoutW.current) * (n - 1))));
          if (i !== lastIdx.current) {
            lastIdx.current = i;
            // A tick per candle makes the scrub legible without looking — the
            // same reason a scroll wheel clicks.
            void Haptics.selectionAsync();
            setScrub(i);
          }
        },
        onPanResponderRelease: () => {
          lastIdx.current = null;
          setScrub(null);
        },
        onPanResponderTerminate: () => {
          lastIdx.current = null;
          setScrub(null);
        },
      }),
    [n]
  );

  const focused = scrub !== null ? candles[scrub] : null;
  const slot = n > 0 ? W / n : W;
  const bodyW = Math.max(1, slot * 0.6);
  const crossX = scrub === null ? null : mode === "candles" ? (scrub + 0.5) * slot : (scrub / Math.max(1, n - 1)) * W;

  const periodPct = n >= 2 ? ((candles[n - 1].close - candles[0].close) / candles[0].close) * 100 : 0;

  // Candle geometry is memoized so a scrub does NOT rebuild it. Scrubbing sets
  // state on every distinct candle under the finger — up to 60 updates/second —
  // and without this memo each one re-created every <Line>/<Rect> on the chart,
  // which is exactly the load profile where SVG charts fall over. The candles
  // depend only on the data and the layout; the moving parts of a scrub are the
  // crosshair and the readout row, and now they are the only parts that render.
  const candleNodes = useMemo(() => {
    if (!yOf) return null;
    return candles.map((c, i) => {
      const cx = (i + 0.5) * slot;
      const rising = c.close >= c.open;
      const color = rising ? colors.neon : colors.accent;
      const top = yOf(Math.max(c.open, c.close));
      const bottom = yOf(Math.min(c.open, c.close));
      return (
        <React.Fragment key={c.time}>
          <Line x1={cx} y1={yOf(c.high)} x2={cx} y2={yOf(c.low)} stroke={color} strokeWidth={1} />
          <Rect x={cx - bodyW / 2} y={top} width={bodyW} height={Math.max(1, bottom - top)} fill={color} />
        </React.Fragment>
      );
    });
  }, [candles, yOf, slot, bodyW]);

  return (
    <View style={styles.wrap}>
      {/* Readout row: scrubbed OHLC while a finger is down, period summary
          otherwise. One row, one height — the layout never shifts. */}
      <View style={styles.readout}>
        {focused ? (
          <>
            <Text style={[type.dim, styles.readoutWhen]}>{fmtWhen(focused.time, tf)}</Text>
            <Text style={styles.ohlc}>
              <Text style={type.dim}>O </Text>
              {focused.open.toFixed(2)}
              <Text style={type.dim}>  H </Text>
              {focused.high.toFixed(2)}
              <Text style={type.dim}>  L </Text>
              {focused.low.toFixed(2)}
              <Text style={type.dim}>  C </Text>
              <Text style={{ color: focused.close >= focused.open ? colors.neon : colors.accent }}>
                {focused.close.toFixed(2)}
              </Text>
            </Text>
          </>
        ) : (
          <>
            <Text style={[type.dim, styles.readoutWhen]}>{tf}</Text>
            <Text style={[styles.ohlc, { color: up ? colors.neon : colors.accent }]}>
              {n >= 2 ? `${periodPct >= 0 ? "+" : ""}${periodPct.toFixed(2)}%` : "—"}
            </Text>
          </>
        )}
        <Pressable
          onPress={() => setMode((m) => (m === "line" ? "candles" : "line"))}
          accessibilityLabel={mode === "line" ? "Switch to candlestick chart" : "Switch to line chart"}
          style={styles.modeBtn}
        >
          <Text style={{ color: colors.textDim, fontWeight: "700", fontSize: 11 }}>
            {mode === "line" ? "CANDLES" : "LINE"}
          </Text>
        </Pressable>
      </View>

      {geom && yOf ? (
        <View onLayout={(e) => (layoutW.current = Math.max(1, e.nativeEvent.layout.width))} {...responder.panHandlers}>
          <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
            <Defs>
              <SvgGradient id="fill" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={stroke} stopOpacity="0.25" />
                <Stop offset="1" stopColor={stroke} stopOpacity="0" />
              </SvgGradient>
            </Defs>

            {mode === "line" ? (
              <>
                <Path d={geom.area} fill="url(#fill)" />
                <Path d={geom.line} stroke={stroke} strokeWidth={2} fill="none" />
              </>
            ) : (
              candleNodes
            )}

            {crossX !== null && (
              <Line x1={crossX} y1={0} x2={crossX} y2={H} stroke={colors.textFaint} strokeWidth={1} strokeDasharray="3 3" />
            )}
          </Svg>
        </View>
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
  readout: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 24 },
  readoutWhen: { fontVariant: ["tabular-nums"], minWidth: 44 },
  ohlc: { color: colors.text, fontSize: 12, fontVariant: ["tabular-nums"], flex: 1 },
  modeBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  placeholder: { alignItems: "center", justifyContent: "center" },
  tfs: { flexDirection: "row", justifyContent: "space-between" },
  tf: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  tfActive: { backgroundColor: colors.neon },
});
