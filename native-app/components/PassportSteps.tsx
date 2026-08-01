import React, { useEffect, useRef } from "react";
import { AccessibilityInfo, Animated, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing } from "@/lib/theme";

// Step indicator for the document-verification flow.
//
// The active dot pulses on the built-in Animated driver. Note what pulses and
// what does not: `scale` and `opacity` run natively, but React Native cannot
// animate `shadowRadius` or `shadowOpacity` on the native driver at all — the
// pasted research animates both, which would silently fall back to the JS
// driver and stutter against the rest of the screen. The glow here is a second
// absolutely-positioned ring whose SCALE and OPACITY animate instead, which
// looks the same and stays on the UI thread.
//
// The whole indicator is one accessibility node announcing "Step 2 of 5,
// Document". Five separate nodes would make a screen-reader user swipe through
// decoration to learn one fact.

export interface Step {
  key: string;
  label: string;
}

export const DOCUMENT_STEPS: Step[] = [
  { key: "country", label: "Country" },
  { key: "type", label: "Document" },
  { key: "verify", label: "Verify" },
  { key: "done", label: "Done" },
];

export function PassportSteps({
  steps = DOCUMENT_STEPS,
  current,
}: {
  steps?: Step[];
  current: number;
}) {
  const pulse = useRef(new Animated.Value(0)).current;
  const reduceMotion = useRef(false);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((on) => {
      if (alive) reduceMotion.current = on;
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (reduceMotion.current) return;
    pulse.setValue(0);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1100, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1100, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [current, pulse]);

  const glowScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.9] });
  const glowOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] });

  const label = steps[current]?.label ?? "";

  return (
    <View
      style={styles.row}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${Math.min(current + 1, steps.length)} of ${steps.length}${label ? `, ${label}` : ""}`}
    >
      {steps.map((step, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <React.Fragment key={step.key}>
            {i > 0 ? (
              <View
                style={[styles.line, { backgroundColor: done || active ? colors.neon : colors.border }]}
              />
            ) : null}
            <View style={styles.item}>
              <View style={styles.dotWrap}>
                {active ? (
                  <Animated.View
                    style={[
                      styles.glow,
                      { transform: [{ scale: glowScale }], opacity: glowOpacity },
                    ]}
                    pointerEvents="none"
                  />
                ) : null}
                <View
                  style={[
                    styles.dot,
                    done || active ? { backgroundColor: colors.neon, borderColor: colors.neon } : null,
                  ]}
                >
                  {done ? <Ionicons name="checkmark" size={11} color={colors.onNeon} /> : null}
                </View>
              </View>
              <Text
                style={[
                  styles.label,
                  active ? { color: colors.neon, fontWeight: "700" } : null,
                  done ? { color: colors.textDim } : null,
                ]}
                numberOfLines={1}
              >
                {step.label}
              </Text>
            </View>
          </React.Fragment>
        );
      })}
    </View>
  );
}

const DOT = 22;

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start", paddingHorizontal: spacing.md },
  item: { alignItems: "center", gap: 6, width: 66 },
  dotWrap: { width: DOT, height: DOT, alignItems: "center", justifyContent: "center" },
  glow: {
    position: "absolute",
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    backgroundColor: colors.neon,
  },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  label: { color: colors.textFaint, fontSize: 11, textAlign: "center" },
  line: { flex: 1, height: 2, borderRadius: radius.pill, marginTop: DOT / 2 - 1 },
});

export default PassportSteps;
