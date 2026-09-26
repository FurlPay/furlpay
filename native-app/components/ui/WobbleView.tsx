import React, { useEffect, useRef } from "react";
import { Animated, type ViewStyle } from "react-native";
import { haptic } from "@/lib/haptics";

// ---------------------------------------------------------------------------
// WobbleView — the damped lateral shake for a refused action.
//
// WHAT IT IS FOR. A validation failure that only changes text below a field is
// easy to miss: the thumb is over the button, the eye is on the amount, and
// nothing moved. The wobble puts the feedback where the user is already looking.
//
// WHY A DECAYING SEQUENCE AND NOT A LOOP. The amplitude falls 10 -> 8 -> 6 -> 4
// -> 0 over 320ms, which reads as something that was knocked and settled. A
// constant-amplitude shake reads as an alarm, and a looping one as a broken
// screen. It is an underdamped oscillation flattened into five keyframes because
// that is what the built-in Animated driver can express without a spring library.
//
// CONSTRAINTS THIS RESPECTS:
//   * Only translateX is animated, on useNativeDriver — so this never touches
//     layout and cannot reflow the page around it.
//   * No react-native-reanimated and no gesture-handler; both are deliberately
//     absent from package.json to keep the Android AAB standalone.
//   * The haptic comes from lib/haptics.ts, the app's own vocabulary, rather than
//     a raw expo-haptics call.
//
// MOTION IS NEVER THE ONLY SIGNAL. This wraps an error message; it does not
// replace one. A user who cannot perceive the movement — reduced motion, low
// vision, or simply looking away — still has the text and the haptic.
// ---------------------------------------------------------------------------

/** Peak offsets, in px. Decaying, and ending at exactly 0 so nothing is left displaced. */
const KEYFRAMES: { toValue: number; duration: number }[] = [
  { toValue: 10, duration: 45 },
  { toValue: -8, duration: 55 },
  { toValue: 6, duration: 65 },
  { toValue: -4, duration: 75 },
  { toValue: 0, duration: 80 },
];

export const WOBBLE_DURATION_MS = KEYFRAMES.reduce((total, k) => total + k.duration, 0);

export interface WobbleViewProps {
  /**
   * Change this to wobble.
   *
   * A key rather than a boolean, so the SAME error twice still shakes: with a
   * boolean, a user who corrects nothing and retries gets no feedback the second
   * time, which reads as the button having stopped working. Pass an incrementing
   * counter, or the error string itself.
   *
   * Falsy values never wobble, so the first render is still.
   */
  triggerKey?: string | number | boolean | null;
  /** Fire the error haptic alongside the motion. Default true. */
  withHaptic?: boolean;
  style?: ViewStyle | ViewStyle[];
  children: React.ReactNode;
}

export function WobbleView({ triggerKey, withHaptic = true, style, children }: WobbleViewProps) {
  const shake = useRef(new Animated.Value(0)).current;
  // Tracks what we last shook for, so a re-render with an unchanged key does not
  // re-fire. Without this, any parent state change during an error would restart
  // the animation and buzz again.
  const lastKey = useRef<WobbleViewProps["triggerKey"]>(undefined);

  useEffect(() => {
    if (!triggerKey) {
      lastKey.current = triggerKey;
      return;
    }
    if (lastKey.current === triggerKey) return;
    lastKey.current = triggerKey;

    if (withHaptic) haptic.error();

    // Reset first: a wobble interrupted mid-flight would otherwise start from
    // wherever it had got to and travel the wrong distance.
    shake.setValue(0);
    const animation = Animated.sequence(
      KEYFRAMES.map((k) => Animated.timing(shake, { ...k, useNativeDriver: true }))
    );
    animation.start();

    // Stopped on unmount, and the value returned to rest. An animation still
    // running against an unmounted view logs a warning and, on a remount of a
    // pooled view, can leave it visibly offset.
    return () => {
      animation.stop();
      shake.setValue(0);
    };
  }, [triggerKey, withHaptic, shake]);

  return (
    <Animated.View style={[style, { transform: [{ translateX: shake }] }]}>{children}</Animated.View>
  );
}

export default WobbleView;
