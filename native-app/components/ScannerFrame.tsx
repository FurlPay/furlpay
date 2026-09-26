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

/** How long the lock snap takes to read. scan.tsx waits this long before routing. */
export const LOCK_SNAP_MS = 180;

export interface ScannerFrameProps {
  /**
   * True the moment a payable code is recognised.
   *
   * Without this the screen cut straight from "still looking" to the next route,
   * so a successful scan and a camera that had not seen anything yet looked
   * identical right up until the navigation. The snap is the acknowledgement:
   * it tells the user the thing they pointed at was the thing that worked.
   */
  locked?: boolean;
}

export function ScannerFrame({ locked = false }: ScannerFrameProps) {
  const sweep = useRef(new Animated.Value(0)).current;
  const snap = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Stop sweeping the instant we lock. A line still hunting under brackets that
    // have already closed says two contradictory things at once.
    if (locked) return;

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
  }, [sweep, locked]);

  useEffect(() => {
    // Overshoot on the way in, so the brackets visibly grab rather than glide.
    // Reversible: a scan that turns out to be unpayable resets `locked`, and the
    // frame must reopen rather than stay clamped on nothing.
    Animated.spring(snap, {
      toValue: locked ? 0.88 : 1,
      friction: 5,
      tension: 120,
      useNativeDriver: true,
    }).start();
  }, [locked, snap]);

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
        <Animated.View style={[styles.frame, { transform: [{ scale: snap }] }]}>
          {/* Border colour is swapped with a plain conditional style, NOT an
              Animated colour interpolation. React Native cannot animate
              borderColor on the native driver; doing so drops the whole
              animation to the JS thread and stutters — the same trap the sweep
              line avoids by never animating shadowRadius. The scale carries the
              motion; the colour just changes. */}
          <View style={[styles.bracket, styles.tl, locked && styles.bracketLocked]} />
          <View style={[styles.bracket, styles.tr, locked && styles.bracketLocked]} />
          <View style={[styles.bracket, styles.bl, locked && styles.bracketLocked]} />
          <View style={[styles.bracket, styles.br, locked && styles.bracketLocked]} />
          {/* Unmounted rather than faded when locked: an invisible element still
              animating is work done for nothing on a screen about to unmount. */}
          {!locked && (
            <Animated.View
              style={[styles.line, { opacity: lineOpacity, transform: [{ translateY }] }]}
            />
          )}
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.45)" },
  center: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  frame: { width: FRAME, height: FRAME },
  bracket: { position: "absolute", width: BRACKET, height: BRACKET, borderColor: colors.neon },
  // A white flash on lock. The theme has no emerald/success token, and inventing
  // one for a 180ms state would put a colour in the palette that nothing else
  // uses; white against neon is already the strongest available contrast shift.
  bracketLocked: { borderColor: colors.text },
  tl: { top: 0, left: 0, borderTopWidth: WEIGHT, borderLeftWidth: WEIGHT, borderTopLeftRadius: 12 },
  tr: { top: 0, right: 0, borderTopWidth: WEIGHT, borderRightWidth: WEIGHT, borderTopRightRadius: 12 },
  bl: { bottom: 0, left: 0, borderBottomWidth: WEIGHT, borderLeftWidth: WEIGHT, borderBottomLeftRadius: 12 },
  br: { bottom: 0, right: 0, borderBottomWidth: WEIGHT, borderRightWidth: WEIGHT, borderBottomRightRadius: 12 },
  line: { position: "absolute", left: WEIGHT, right: WEIGHT, height: 2, backgroundColor: colors.neon },
});

export default ScannerFrame;
