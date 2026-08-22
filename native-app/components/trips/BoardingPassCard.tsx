import React from "react";
import { LayoutChangeEvent, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Rect } from "react-native-svg";
import { barcodeBars } from "@/lib/barcode";
import { trips, tripsRadius } from "./tripsTheme";
import type { BoardingPass } from "@/lib/boardingPass";

/** The scannable strip. Bar widths are a pure function of the pass id. */
export function Barcode({ value, width, height = 46 }: { value: string; width: number; height?: number }) {
  const bars = React.useMemo(() => barcodeBars(value), [value]);
  const total = bars.reduce((sum, b) => sum + b, 0);
  const unit = width / total;

  let x = 0;
  const rects = bars.map((w, i) => {
    const at = x;
    x += w;
    // Even indices are bars, odd indices the gaps between them.
    return i % 2 === 0 ? <Rect key={i} x={at * unit} y={0} width={w * unit} height={height} fill="#0A0A0A" /> : null;
  });

  return (
    <Svg width={width} height={height} accessibilityLabel={`Boarding pass barcode for ${value}`}>
      {rects}
    </Svg>
  );
}

function Field({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={[styles.fieldValue, accent && styles.fieldValueAccent]}>{value}</Text>
    </View>
  );
}

/**
 * The pass a passenger actually shows at the gate.
 *
 * Light, on a black app, on purpose: a gate scanner reads a dark barcode on a
 * light ground, and inverting it to match the app's theme would trade a working
 * pass for a consistent one. Apple Wallet makes the same choice.
 */
export function BoardingPassCard({
  pass,
  expanded,
  onToggle,
}: {
  pass: BoardingPass;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { flight, passenger } = pass;
  const [barWidth, setBarWidth] = React.useState(0);
  const onBarLayout = (e: LayoutChangeEvent) => setBarWidth(e.nativeEvent.layout.width);

  return (
    <View style={styles.card}>
      <Pressable
        onPress={onToggle}
        style={styles.header}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${expanded ? "Hide" : "Show"} full boarding pass for ${flight.number}`}
      >
        <Text style={styles.flightNumber}>{flight.number}</Text>
        <Text style={styles.aircraftChip}>{flight.aircraft}</Text>
      </Pressable>

      <View style={styles.rule} />

      <View style={styles.grid}>
        <Field label="Boarding" value={flight.boardingTime} accent />
        <Field label="Departs" value={flight.departureTime} />
        <Field label="Gate" value={flight.gate} />
        <Field label="Seat" value={flight.seat} />
      </View>

      <View style={styles.arrives}>
        <Field label="Arrives" value={flight.arrivalTime} />
      </View>

      {expanded && (
        <View style={styles.inset}>
          <View style={styles.insetRow}>
            <Field label="From" value={`${flight.originCity} (${flight.originCode})`} />
            <Field label="To" value={`${flight.destinationCity} (${flight.destinationCode})`} />
          </View>
          <View style={styles.insetRow}>
            <Field label="Aircraft" value={flight.aircraft} />
            <Field label="Boarding gate" value={flight.gate} />
          </View>
        </View>
      )}

      <View style={styles.rule} />

      <View style={styles.passengerRow}>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Passenger</Text>
          <Text style={styles.passengerName}>{passenger.name}</Text>
        </View>
        {passenger.verified && (
          <View style={styles.verified} accessibilityLabel="Identity verified">
            <Ionicons name="checkmark" size={18} color="#FFFFFF" />
          </View>
        )}
      </View>

      <View style={styles.rule} />

      <View style={styles.barcode} onLayout={onBarLayout}>
        {barWidth > 0 && <Barcode value={pass.id} width={barWidth} height={expanded ? 70 : 46} />}
      </View>
      <Text style={styles.wordmark}>FURLPAY</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: trips.passBg,
    borderRadius: tripsRadius.pass,
    paddingHorizontal: 19,
    paddingTop: 15,
    paddingBottom: 13,
    marginTop: -16,
  },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  flightNumber: { fontSize: 29, fontWeight: "600", color: trips.passInk, letterSpacing: -0.7 },
  aircraftChip: {
    fontSize: 14,
    color: "#3C3C43",
    backgroundColor: trips.passChip,
    borderRadius: tripsRadius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
    overflow: "hidden",
  },
  rule: { height: 1, backgroundColor: trips.passRule, marginTop: 13 },
  grid: { flexDirection: "row", justifyContent: "space-between", marginTop: 13, gap: 6 },
  arrives: { marginTop: 13 },
  field: { gap: 9, minWidth: 0 },
  fieldLabel: { fontSize: 13, color: trips.passInkDim },
  fieldValue: { fontSize: 24, color: trips.passInk, letterSpacing: -0.4 },
  fieldValueAccent: { color: trips.ink },
  inset: {
    marginTop: 14,
    gap: 14,
    borderRadius: tripsRadius.tile,
    backgroundColor: trips.passInset,
    padding: 14,
  },
  insetRow: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  passengerRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    marginTop: 13,
  },
  passengerName: { fontSize: 24, color: trips.passInk, letterSpacing: -0.5 },
  verified: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: trips.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  barcode: { marginTop: 12, width: "100%" },
  wordmark: {
    marginTop: 7,
    textAlign: "center",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.2,
    color: "#3C3C43",
  },
});
