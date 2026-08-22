import React from "react";
import { LayoutChangeEvent, StyleSheet, Text, View } from "react-native";
import { FurlPayMark } from "./FurlPayMark";
import { RouteArc } from "./FlightRoute";
import { trips, tripsRadius } from "./tripsTheme";
import { liveStatus, statusLabel, type BoardingPass } from "@/lib/boardingPass";

function Tile({ label, value, flex = 1 }: { label: string; value: string; flex?: number }) {
  return (
    <View style={[styles.tile, { flex }]}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={styles.tileValue}>{value}</Text>
    </View>
  );
}

/**
 * The expanded live activity — the full real-time picture of one flight.
 *
 * The trajectory sits between the flight number and the airport codes so the
 * aircraft appears to be arriving over the destination code below it, and the
 * bead only leaves the origin once the flight has actually departed.
 */
export function FlightStatusCard({ pass, now }: { pass: BoardingPass; now: number }) {
  const { flight } = pass;
  const status = liveStatus(pass, now);
  const [arcWidth, setArcWidth] = React.useState(0);
  const onArcLayout = (e: LayoutChangeEvent) => setArcWidth(e.nativeEvent.layout.width);

  const boardingLabel =
    pass.minutesToBoarding != null && status !== "boarding" && status !== "departed"
      ? `${pass.minutesToBoarding} min`
      : flight.boardingTime;

  return (
    <View style={styles.card}>
      <View style={styles.headRow}>
        <View style={styles.brand}>
          <FurlPayMark size={22} />
          <Text style={styles.brandText}>FurlPay</Text>
        </View>
        <Text style={styles.livePill}>LIVE</Text>
      </View>

      <Text style={styles.equipment}>
        {flight.number} <Text style={styles.dot}>·</Text> {flight.aircraft}
      </Text>

      <View style={styles.arc} onLayout={onArcLayout}>
        {arcWidth > 0 && <RouteArc width={arcWidth} height={48} progress={pass.progress} />}
      </View>

      <View style={styles.codeRow}>
        <Text style={styles.code}>{flight.originCode}</Text>
        <Text style={styles.code}>{flight.destinationCode}</Text>
      </View>

      <View style={styles.cityRow}>
        <View>
          <Text style={styles.city}>{flight.originCity}</Text>
          <Text style={styles.time}>{flight.departureTime}</Text>
        </View>
        <View style={styles.cityRight}>
          <Text style={styles.city}>{flight.destinationCity}</Text>
          <Text style={styles.time}>{flight.arrivalTime}</Text>
        </View>
      </View>

      <View style={styles.tiles}>
        <Tile label="Gate" value={flight.gate} />
        <Tile label="Seat" value={flight.seat} />
        <Tile label="Boarding" value={boardingLabel} flex={1.7} />
      </View>

      <View style={styles.statusTile}>
        <View>
          <Text style={styles.tileLabel}>Status</Text>
          <Text style={styles.tileValue}>{statusLabel(status)}</Text>
        </View>
        <View style={styles.switch}>
          <View style={styles.switchKnob} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: tripsRadius.card,
    borderWidth: 1,
    borderColor: trips.border,
    backgroundColor: "rgba(9, 46, 33, 0.5)",
    paddingHorizontal: 18,
    paddingTop: 15,
    paddingBottom: 13,
  },
  headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  brand: { flexDirection: "row", alignItems: "center", gap: 8 },
  brandText: { fontSize: 21, fontWeight: "600", color: "#F7FAF8", letterSpacing: -0.5 },
  livePill: {
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.4,
    color: "#7FE7B0",
    backgroundColor: "#0F4A31",
    borderRadius: tripsRadius.pill,
    paddingHorizontal: 13,
    paddingVertical: 5,
    overflow: "hidden",
  },
  equipment: { marginTop: 12, fontSize: 19, fontWeight: "500", color: "rgba(255,255,255,0.95)" },
  dot: { color: "rgba(255,255,255,0.45)" },
  arc: { height: 48, marginTop: -4, width: "100%" },
  codeRow: { flexDirection: "row", justifyContent: "space-between", marginTop: -6 },
  code: { fontSize: 24, fontWeight: "600", color: "#FFFFFF", letterSpacing: -0.4 },
  cityRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 12 },
  cityRight: { alignItems: "flex-end" },
  city: { fontSize: 15, color: trips.subText },
  time: { marginTop: 9, fontSize: 22, fontWeight: "500", color: "#FFFFFF", letterSpacing: -0.3 },
  tiles: { flexDirection: "row", gap: 12, marginTop: 15 },
  tile: {
    borderRadius: tripsRadius.tile,
    borderWidth: 1,
    borderColor: trips.tileBorder,
    backgroundColor: trips.tile,
    paddingHorizontal: 12,
    paddingTop: 9,
    paddingBottom: 10,
    gap: 9,
  },
  tileLabel: { fontSize: 14, color: trips.subText },
  tileValue: { fontSize: 21, fontWeight: "600", color: "#FFFFFF", letterSpacing: -0.3 },
  statusTile: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    borderRadius: tripsRadius.tile,
    borderWidth: 1,
    borderColor: trips.tileBorder,
    backgroundColor: trips.tile,
    paddingHorizontal: 12,
    paddingTop: 9,
    paddingBottom: 10,
    marginTop: 11,
    gap: 9,
  },
  switch: {
    width: 54,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#124B33",
    alignItems: "flex-end",
    justifyContent: "center",
    paddingHorizontal: 3,
    marginBottom: 3,
  },
  switchKnob: { width: 18, height: 18, borderRadius: 9, backgroundColor: "#68E7A3" },
});
