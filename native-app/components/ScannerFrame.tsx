import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import { colors } from "@/lib/theme";

// Camera framing overlay for the scan screen — the "scanner frame" from the web
// (ScanToPay): a dimmed surround, four neon corner brackets marking the target
// zone, and a sweeping scan line. On the built-in Animated driver, so no new
// native module and no rebuild.
//
// The line animates translateY and opacity (both native-driver safe). It does
// NOT animate shadowRadius — React Native cannot animate that on the native
// driver, and doing so silently drops to the JS thread and stutters.

const FRAME = 248;
const BRACKET = 34;
const WEIGHT = 3;

export function ScannerFrame() {
  const sweep = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(sweep, {
          toValue: 1,
          duration: 1600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(sweep, {
          toValue: 0,
          duration: 1600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [sweep]);

  const translateY = sweep.interpolate({
    inputRange: [0, 1],
    outputRange: [WEIGHT, FRAME - WEIGHT * 2],
  });
  const lineOpacity = sweep.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.2, 0.9, 0.2],
  });

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* Dimmed surround focuses the eye on the frame. */}
      <View style={styles.dim} />
      <View style={styles.center}>
        <View style={styles.frame}>
          <View style={[styles.bracket, styles.tl]} />
          <View style={[styles.bracket, styles.tr]} />
          <View style={[styles.bracket, styles.bl]} />
          <View style={[styles.bracket, styles.br]} />
          <Animated.View style={[styles.line, { opacity: lineOpacity, transform: [{ translateY }] }]} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.45)" },
  center: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  frame: { width: FRAME, height: FRAME },
  bracket: { position: "absolute", width: BRACKET, height: BRACKET, borderColor: colors.neon },
  tl: { top: 0, left: 0, borderTopWidth: WEIGHT, borderLeftWidth: WEIGHT, borderTopLeftRadius: 12 },
  tr: { top: 0, right: 0, borderTopWidth: WEIGHT, borderRightWidth: WEIGHT, borderTopRightRadius: 12 },
  bl: { bottom: 0, left: 0, borderBottomWidth: WEIGHT, borderLeftWidth: WEIGHT, borderBottomLeftRadius: 12 },
  br: { bottom: 0, right: 0, borderBottomWidth: WEIGHT, borderRightWidth: WEIGHT, borderBottomRightRadius: 12 },
  line: { position: "absolute", left: WEIGHT, right: WEIGHT, height: 2, backgroundColor: colors.neon },
});

export default ScannerFrame;
