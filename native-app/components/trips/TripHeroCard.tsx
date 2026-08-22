import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { trips, tripsRadius } from "./tripsTheme";

// Trip hero: emerald title block over the airline photography. The photo's own
// sky continues the header colour, so the two read as one surface rather than a
// banner stacked on an image.
//
// The image is BUNDLED, not fetched. It is the airline's own livery on a screen
// a passenger opens at a gate — often on airport wifi that is captive, slow, or
// both — and a hero that renders as a grey box at the moment of use is worse
// than one that costs 95KB in the APK.
const HERO = require("../../assets/travel/furlpay-airways-a321.jpg");

export function TripHeroCard({ title, routeLabel }: { title: string; routeLabel: string }) {
  return (
    <View style={styles.card}>
      <LinearGradient colors={[trips.heroTop, trips.heroBottom]} style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.route}>{routeLabel}</Text>
      </LinearGradient>
      <Image
        source={HERO}
        style={styles.photo}
        resizeMode="cover"
        accessibilityLabel="FurlPay Airways Airbus A321 in flight above the clouds"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: tripsRadius.card, overflow: "hidden" },
  header: { paddingHorizontal: 21, paddingTop: 16, paddingBottom: 13, gap: 11 },
  title: { fontSize: 26, fontWeight: "600", color: "#FFFFFF", letterSpacing: -0.5 },
  route: { fontSize: 15, color: "rgba(255,255,255,0.9)" },
  photo: { width: "100%", height: 132 },
});
