import React from "react";
import { LayoutChangeEvent, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { FurlPayMark } from "./FurlPayMark";
import { RouteDashed } from "./FlightRoute";
import { trips, tripsRadius } from "./tripsTheme";
import type { BoardingPass } from "@/lib/boardingPass";

/**
 * The compact Live Activity — the same card iOS renders on the Lock Screen,
 * pinned to the top of the Trips screen so the answer to "when do I board" is
 * the first thing on the display.
 *
 * On Android this is the in-app card only. The equivalent OUTSIDE the app is an
 * ongoing notification, not a Live Activity, and it is not faked here: a card
 * that looked like a system surface but only existed inside the app would be a
 * worse lie than not having one.
 */
export function LiveActivityCard({
  pass,
  statusText,
}: {
  pass: BoardingPass;
  statusText: string;
}) {
  const [routeWidth, setRouteWidth] = React.useState(0);
  const onRouteLayout = (e: LayoutChangeEvent) => setRouteWidth(e.nativeEvent.layout.width);

  return (
    <LinearGradient
      colors={[trips.liveCardTop, trips.liveCardBottom]}
      start={{ x: 0.1, y: 0 }}
      end={{ x: 0.9, y: 1 }}
      style={styles.card}
      accessible
      accessibilityLabel={`Live flight status. ${pass.flight.number}, ${pass.flight.originCity} to ${pass.flight.destinationCity}. ${statusText}.`}
    >
      <FurlPayMark size={34} />

      <View style={styles.body}>
        <Text style={styles.brand}>FurlPay</Text>
        <View style={styles.routeRow}>
          <Text style={styles.code}>{pass.flight.originCode}</Text>
          <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
          <Text style={styles.code}>{pass.flight.destinationCode}</Text>
        </View>
        <Text style={styles.flightNo}>{pass.flight.number}</Text>
        <Text style={styles.status}>{statusText}</Text>
      </View>

      <View style={styles.route} onLayout={onRouteLayout}>
        {routeWidth > 0 && <RouteDashed width={routeWidth} height={22} />}
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 11,
    borderRadius: tripsRadius.card,
    paddingHorizontal: 15,
    paddingVertical: 14,
  },
  body: { flex: 1, minWidth: 0, gap: 7 },
  brand: { fontSize: 13, fontWeight: "500", color: trips.greenDim },
  routeRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  code: { fontSize: 24, fontWeight: "700", color: "#FFFFFF", letterSpacing: -0.5 },
  flightNo: { fontSize: 15, fontWeight: "500", color: "rgba(255,255,255,0.9)" },
  status: { fontSize: 15, fontWeight: "500", color: trips.green },
  // Fixed width keeps the trajectory from squeezing the route codes on a small
  // display; below that it simply renders nothing rather than overlapping.
  route: { width: 104, height: 22, marginTop: 26 },
});
