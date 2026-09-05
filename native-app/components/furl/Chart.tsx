import React, { useMemo } from "react";
import { View, Text, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Circle, Line, Path } from "react-native-svg";
import { makeStyles, useTheme } from "@/lib/design";
import { useI18n } from "@/lib/i18n";

export interface FurlChartProps {
  /** Y values in chronological order. At least two points to draw a line. */
  data: number[];
  height?: number;
  /** Overrides the up/down colouring derived from first-vs-last. */
  tone?: "up" | "down" | "neutral";
  showGrid?: boolean;
  /** Emphasizes the latest point with a dot. */
  showEndpoint?: boolean;
  /** Screen-reader summary. Defaults to a change description. */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * A sparkline.
 *
 * Drawn with react-native-svg (already a dependency) rather than a charting
 * library, because the whole requirement is one path, an optional fill and a
 * grid — and every RN charting package costs more bundle than this file.
 *
 * A chart is not accessible to a screen reader no matter how it is drawn, so
 * the summary label is not decoration: it is the entire content for anyone not
 * looking at the pixels.
 */
export function FurlChart({
  data,
  height,
  tone,
  showGrid = true,
  showEndpoint = true,
  accessibilityLabel,
  style,
}: FurlChartProps) {
  const t = useTheme();
  const s = useStyles();
  const i18n = useI18n();
  const h = height ?? t.component.chart.height;

  const geometry = useMemo(() => {
    if (data.length < 2) return null;
    const min = Math.min(...data);
    const max = Math.max(...data);
    // A flat series has zero range; dividing by it puts every point at NaN and
    // the path silently fails to render. Centre it instead.
    const range = max - min || 1;
    const stepX = 100 / (data.length - 1);

    const points = data.map((v, i) => ({
      x: i * stepX,
      y: max === min ? 50 : ((max - v) / range) * 100,
    }));

    const line = points
      .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(3)},${p.y.toFixed(3)}`)
      .join(" ");

    return { points, line, first: data[0], last: data[data.length - 1] };
  }, [data]);

  const direction: "up" | "down" | "neutral" =
    tone ?? (!geometry ? "neutral" : geometry.last >= geometry.first ? "up" : "down");

  const stroke =
    direction === "up" ? t.colors.chartUp : direction === "down" ? t.colors.chartDown : t.colors.textDim;

  const label = useMemo(() => {
    if (accessibilityLabel) return accessibilityLabel;
    if (!geometry) return "Chart unavailable";
    const change = geometry.first === 0 ? 0 : (geometry.last - geometry.first) / Math.abs(geometry.first);
    const dir = change >= 0 ? "up" : "down";
    return `Price chart, ${dir} ${i18n.formatPercent(Math.abs(change))} over the period, ${data.length} points`;
  }, [accessibilityLabel, geometry, data.length, i18n]);

  if (!geometry) {
    return (
      <View style={[s.empty, { height: h }, style]} accessible accessibilityLabel={label}>
        <Text style={[t.type("caption"), { color: t.colors.textFaint }]}>
          {i18n.t("state.emptyTitle")}
        </Text>
      </View>
    );
  }

  return (
    <View style={[{ height: h }, style]} accessible accessibilityRole="image" accessibilityLabel={label}>
      {/* preserveAspectRatio="none" so the 0-100 viewBox stretches to whatever
          width the parent gives it — the chart is a shape, not an image. */}
      <Svg width="100%" height={h} viewBox="0 0 100 100" preserveAspectRatio="none">
        {showGrid
          ? [25, 50, 75].map((y) => (
              <Line
                key={y}
                x1="0"
                y1={y}
                x2="100"
                y2={y}
                stroke={t.colors.chartGrid}
                strokeWidth={0.5}
              />
            ))
          : null}
        <Path
          d={geometry.line}
          fill="none"
          stroke={stroke}
          strokeWidth={t.component.chart.strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          // The viewBox is stretched, so a plain strokeWidth would be scaled
          // unevenly. This keeps the line the same visual weight at any width.
          vectorEffect="non-scaling-stroke"
        />
        {showEndpoint ? (
          <Circle
            cx={geometry.points[geometry.points.length - 1].x}
            cy={geometry.points[geometry.points.length - 1].y}
            r={2}
            fill={stroke}
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
      </Svg>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  empty: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: t.colors.surfaceRaised,
    borderRadius: t.radius.md,
  },
}));
