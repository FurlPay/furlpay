import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { MarkerView } from "@maplibre/maplibre-react-native";
import {
  bandFor,
  categoryColor,
  type MapCluster,
  type MapPoint,
} from "@/lib/hotelMap";

// ---------------------------------------------------------------------------
// The map's markers.
//
// SIZE AND COLOUR BOTH CARRY MEANING, and different meaning: size is how many
// properties, colour is which band that count falls in. Both are read off one
// table in lib/hotelMap.ts, so a marker can never be large and green.
//
// WHY MarkerView AND NOT A SYMBOL LAYER. The web draws these on the GPU because it
// has up to 400 of them and DOM markers stall a pan. Here the render budget is
// the same but the screen is a tenth the size, so a viewport holds tens of
// markers rather than hundreds — and MarkerView gives real React children, which
// is what makes them touchable and reachable by TalkBack without building a
// parallel list. Different constraint, different answer.
// ---------------------------------------------------------------------------

export function ClusterMarker({
  cluster,
  onPress,
}: {
  cluster: MapCluster;
  onPress: (c: MapCluster) => void;
}) {
  const band = bandFor(cluster.count);
  const size = band.r * 2;

  return (
    <MarkerView
      id={cluster.id}
      coordinate={[cluster.longitude, cluster.latitude]}
      anchor={{ x: 0.5, y: 0.5 }}
    >
      <Pressable
        onPress={() => onPress(cluster)}
        // A cluster is a summary, so it reads as a count and says how to open
        // it. TalkBack announces this instead of "unlabelled button".
        accessibilityRole="button"
        accessibilityLabel={`${cluster.label}, ${cluster.count} luxury ${
          cluster.count === 1 ? "property" : "properties"
        }`}
        accessibilityHint="Opens the area summary"
        style={[
          styles.marker,
          {
            width: size,
            height: size,
            borderRadius: band.r,
            backgroundColor: band.bg,
          },
        ]}
      >
        <Text
          style={[
            styles.count,
            { color: band.fg, fontSize: cluster.count >= 1000 ? 12 : cluster.count >= 100 ? 13 : 14 },
          ]}
          // A long count must not reflow the circle — the circle's size is the
          // density signal and must stay tied to the band, not to the digits.
          numberOfLines={1}
        >
          {cluster.count}
        </Text>
      </Pressable>
    </MarkerView>
  );
}

export function PropertyMarker({
  point,
  selected,
  onPress,
}: {
  point: MapPoint;
  selected: boolean;
  onPress: (p: MapPoint) => void;
}) {
  const curated = point.source === "curated";
  const color = curated ? categoryColor(point.categories) : "#FFFFFF";
  const approximate = curated && point.precision !== "exact";
  const size = curated ? 34 : 14;

  return (
    <MarkerView
      id={point.id}
      coordinate={[point.longitude, point.latitude]}
      anchor={{ x: 0.5, y: 0.5 }}
    >
      <Pressable
        onPress={() => onPress(point)}
        accessibilityRole="button"
        accessibilityLabel={[
          point.name,
          point.city,
          point.stars ? `${point.stars} star` : null,
          approximate ? "approximate position" : null,
        ]
          .filter(Boolean)
          .join(", ")}
        accessibilityHint="Opens this property"
        style={[
          styles.marker,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: color,
            // An unconfirmed position is drawn differently rather than hidden.
            // The property is real; where exactly it stands is what we do not
            // know, and a faded ring says so without removing it from the map.
            borderColor: curated
              ? approximate
                ? "rgba(255,255,255,0.55)"
                : "rgba(255,255,255,0.92)"
              : "#94A3B8",
            opacity: approximate ? 0.85 : 1,
          },
          selected && styles.selected,
        ]}
      >
        {curated && point.stars ? (
          <Text style={styles.stars} numberOfLines={1}>
            {point.stars}
          </Text>
        ) : null}
      </Pressable>
    </MarkerView>
  );
}

const styles = StyleSheet.create({
  marker: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2.5,
    borderColor: "rgba(255,255,255,0.9)",
    // Android needs elevation for a shadow; iOS uses the shadow* props. Both
    // are set so the marker lifts off the ivory basemap on either platform.
    elevation: 4,
    shadowColor: "#0F172A",
    shadowOpacity: 0.28,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
  },
  selected: {
    // Selection replaces the web's hover glow — on a touch screen there is no
    // hover, so the ring marks what the open sheet is describing.
    borderColor: "#FFFFFF",
    borderWidth: 3.5,
    transform: [{ scale: 1.12 }],
  },
  count: { fontWeight: "700", letterSpacing: -0.2 },
  stars: { color: "#FFFFFF", fontSize: 12, fontWeight: "700" },
});
