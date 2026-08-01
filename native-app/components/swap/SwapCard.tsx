import React, { useCallback, useRef } from "react";
import { Animated, Easing, Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { colors, radius } from "@/lib/theme";

// The controls unique to a swap: the flip, and the read-only "you receive"
// figure. The panel the two halves sit in is shared with send — see
// components/money/ValuePanel.
//
// The panels are separate surfaces with the flip button straddling the seam:
// the direction of the trade is then readable at a glance, from layout alone,
// without reading a single label. That matters on a screen where picking the
// wrong direction costs real money.

export function FlipButton({ onPress, disabled }: { onPress: () => void; disabled?: boolean }) {
  const spin = useRef(new Animated.Value(0)).current;
  const turns = useRef(0);

  const press = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    turns.current += 1;
    // Animate to a monotonically increasing target rather than toggling 0↔1, so
    // repeated taps keep rotating the same way instead of snapping back.
    Animated.timing(spin, {
      toValue: turns.current,
      duration: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    onPress();
  }, [onPress, spin]);

  const rotate = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "180deg"],
    extrapolate: "extend",
  });

  return (
    <View style={styles.flipWrap} pointerEvents="box-none">
      <Pressable
        onPress={press}
        disabled={disabled}
        hitSlop={12}
        style={({ pressed }) => [styles.flip, pressed && { backgroundColor: colors.neonSoft }]}
        accessibilityRole="button"
        accessibilityLabel="Swap direction"
        accessibilityHint="Exchanges the from and to assets"
      >
        <Animated.View style={{ transform: [{ rotate }] }}>
          <Ionicons name="swap-vertical" size={20} color={disabled ? colors.textFaint : colors.neon} />
        </Animated.View>
      </Pressable>
    </View>
  );
}

/** The "you receive" figure — a read-only mirror of the amount input. */
export function ReceiveAmount({
  amount,
  symbol,
  loading,
  placeholder = "—",
}: {
  amount?: number;
  symbol?: string;
  loading?: boolean;
  placeholder?: string;
}) {
  const pulse = useRef(new Animated.Value(1)).current;

  // A gentle breathing opacity while quoting. It reads as "this number is being
  // worked out" without a spinner displacing the figure it replaces.
  React.useEffect(() => {
    if (!loading) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.35, duration: 600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [loading, pulse]);

  const text =
    amount === undefined
      ? placeholder
      : amount.toLocaleString(undefined, { maximumFractionDigits: 6 });

  return (
    <Animated.Text
      style={[styles.receive, { opacity: pulse }]}
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={0.6}
      allowFontScaling={false}
      accessibilityLabel={
        amount === undefined ? "Amount not quoted yet" : `You receive ${text} ${symbol ?? ""}`
      }
    >
      {text}
    </Animated.Text>
  );
}

const styles = StyleSheet.create({
  // Negative margins pull the button onto the seam between the two panels.
  flipWrap: { alignItems: "center", marginVertical: -18, zIndex: 2 },
  flip: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 3,
    borderColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  receive: {
    color: colors.neon,
    fontSize: 40,
    fontWeight: "800",
    includeFontPadding: false,
  },
});
