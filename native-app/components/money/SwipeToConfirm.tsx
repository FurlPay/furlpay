import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  LayoutChangeEvent,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { colors, radius, spacing } from "@/lib/theme";

// ---------------------------------------------------------------------------
// Swipe to confirm.
//
// WHY A SWIPE AND NOT A BUTTON. A tap is one event; a swipe is a sustained,
// deliberate gesture that cannot be produced by a mis-tap, a double-tap landing
// on a re-rendered layout, or a pocket touch. On the screen that moves money
// irreversibly, that difference is the whole point.
//
// WHY PanResponder AND Animated. react-native-reanimated and gesture-handler
// are not installed, and adding them means a native rebuild that invalidates
// the signed AAB waiting for Play. Everything below runs on RN's built-in
// Animated with `useNativeDriver` for transform and opacity, so the drag stays
// on the UI thread and holds 60fps without a new dependency.
//
// ACCESSIBILITY IS NOT OPTIONAL HERE. A swipe is unusable with a screen reader
// or reduced motor control, so the whole control is also a button: it exposes
// an accessibility action, and when a screen reader is enabled it degrades to
// a two-tap confirm. A payment control that only works for some users is a
// broken payment control.
// ---------------------------------------------------------------------------

/** Fraction of the track that must be crossed before release commits. */
const COMMIT_THRESHOLD = 0.75;
/** A fast flick past this velocity commits from a shorter distance. */
const COMMIT_VELOCITY = 1.2;
/** Below this the flick shortcut is ignored — prevents an accidental fling. */
const FLICK_MIN_FRACTION = 0.45;

export type SwipeState = "idle" | "dragging" | "confirming" | "done";

interface Props {
  label?: string;
  confirmingLabel?: string;
  doneLabel?: string;
  disabled?: boolean;
  /** Blocks the gesture and explains why. Takes precedence over `disabled`. */
  disabledReason?: string;
  state?: SwipeState;
  /**
   * What is being confirmed, lower-case, for every spoken string: "swap",
   * "payment". A screen reader user hears "Confirm payment", not a generic
   * "Confirm" that could belong to any control on the screen.
   */
  noun?: string;
  onConfirm: () => void;
}

export function SwipeToConfirm({
  label = "Swipe to confirm",
  confirmingLabel = "Confirming…",
  doneLabel = "Done",
  disabled = false,
  disabledReason,
  state = "idle",
  noun = "transaction",
  onConfirm,
}: Props) {
  const Noun = noun.charAt(0).toUpperCase() + noun.slice(1);
  const [trackWidth, setTrackWidth] = useState(0);
  const [screenReader, setScreenReader] = useState(false);
  const [armed, setArmed] = useState(false); // screen-reader two-tap path

  const x = useRef(new Animated.Value(0)).current;
  // Mirrors `x` on the JS side. Animated.Value cannot be read synchronously
  // inside the responder, and the release decision needs the current position.
  const dragX = useRef(0);
  // Latched so the threshold haptic fires once per drag, not once per frame.
  const passedThreshold = useRef(false);

  const blocked = disabled || !!disabledReason || state === "confirming" || state === "done";
  const knob = 56;
  const travel = Math.max(0, trackWidth - knob - 8);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isScreenReaderEnabled().then((on) => alive && setScreenReader(on));
    const sub = AccessibilityInfo.addEventListener("screenReaderChanged", setScreenReader);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  const springBack = useCallback(() => {
    passedThreshold.current = false;
    dragX.current = 0;
    Animated.spring(x, {
      toValue: 0,
      useNativeDriver: true,
      // Slightly over-damped: the knob returns decisively without a bounce that
      // could read as a second gesture.
      bounciness: 4,
      speed: 14,
    }).start();
  }, [x]);

  // Reset whenever the control becomes actionable again — e.g. a quote expired
  // mid-drag and the parent re-priced.
  useEffect(() => {
    if (state === "idle") springBack();
  }, [state, springBack]);

  const commit = useCallback(() => {
    dragX.current = travel;
    Animated.spring(x, { toValue: travel, useNativeDriver: true, bounciness: 0, speed: 20 }).start();
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onConfirm();
  }, [onConfirm, travel, x]);

  const responder = useMemo(
    () =>
      PanResponder.create({
        // Claim the gesture only once it is clearly horizontal, so a vertical
        // scroll that starts on the knob still scrolls the page.
        onStartShouldSetPanResponder: () => !blocked && travel > 0,
        onMoveShouldSetPanResponder: (_e, g) =>
          !blocked && travel > 0 && Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy),

        onPanResponderGrant: () => {
          passedThreshold.current = false;
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        },

        onPanResponderMove: (_e, g) => {
          if (travel <= 0) return;
          let next = g.dx;
          if (next < 0) {
            // Rubber-band backwards so the control feels physical rather than
            // clamped, without ever letting the knob leave the track.
            next = next / 4;
            if (next < -knob / 3) next = -knob / 3;
          } else if (next > travel) {
            next = travel + (next - travel) / 6;
          }
          dragX.current = Math.max(0, Math.min(next, travel));
          x.setValue(next);

          const crossed = dragX.current >= travel * COMMIT_THRESHOLD;
          if (crossed && !passedThreshold.current) {
            passedThreshold.current = true;
            // The "you can let go now" cue. Medium, so it is distinct from the
            // light grant tick and from the success notification.
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          } else if (!crossed && passedThreshold.current) {
            passedThreshold.current = false;
          }
        },

        onPanResponderRelease: (_e, g) => {
          if (travel <= 0) return springBack();
          const fraction = dragX.current / travel;
          const flicked = g.vx >= COMMIT_VELOCITY && fraction >= FLICK_MIN_FRACTION;
          if (fraction >= COMMIT_THRESHOLD || flicked) commit();
          else springBack();
        },

        // A system interruption (call, notification) must never commit.
        onPanResponderTerminate: springBack,
        onPanResponderTerminationRequest: () => true,
      }),
    [blocked, commit, springBack, travel, x]
  );

  const onLayout = (e: LayoutChangeEvent) => setTrackWidth(e.nativeEvent.layout.width);

  const progress = travel > 0 ? Animated.divide(x, travel) : new Animated.Value(0);
  const fillOpacity = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.25, 1],
    extrapolate: "clamp",
  });
  const labelOpacity = progress.interpolate({
    inputRange: [0, 0.6],
    outputRange: [1, 0],
    extrapolate: "clamp",
  });

  const busy = state === "confirming";
  const done = state === "done";
  const caption = disabledReason ?? (done ? doneLabel : busy ? confirmingLabel : label);

  // Screen-reader path: an explicit arm-then-confirm, which preserves the
  // "two deliberate actions" property the swipe provides.
  const activate = () => {
    if (blocked) return;
    if (!armed) {
      setArmed(true);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      AccessibilityInfo.announceForAccessibility?.(
        `Armed. Activate again to confirm the ${noun}.`
      );
      return;
    }
    setArmed(false);
    commit();
  };

  return (
    <View
      onLayout={onLayout}
      style={[styles.track, blocked && !busy && !done ? styles.trackDisabled : null]}
      accessible
      accessibilityRole="button"
      accessibilityLabel={
        disabledReason
          ? `${Noun} unavailable. ${disabledReason}`
          : armed
            ? `Armed. Activate again to confirm the ${noun}.`
            : `Confirm ${noun}. Activate twice, or swipe right.`
      }
      accessibilityState={{ disabled: blocked, busy }}
      accessibilityActions={[{ name: "activate", label: `Confirm ${noun}` }]}
      onAccessibilityAction={activate}
    >
      <Animated.View style={[styles.fill, { opacity: fillOpacity }]} pointerEvents="none" />

      <Animated.Text
        style={[styles.label, { opacity: busy || done ? 1 : labelOpacity }]}
        numberOfLines={1}
        pointerEvents="none"
      >
        {caption}
      </Animated.Text>

      {/* Screen readers get a real tappable surface; pointer users get the drag. */}
      {screenReader ? (
        <Pressable
          onPress={activate}
          disabled={blocked}
          style={StyleSheet.absoluteFill}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      ) : null}

      <Animated.View
        {...(screenReader ? {} : responder.panHandlers)}
        style={[
          styles.knob,
          {
            transform: [{ translateX: x }],
            backgroundColor: done ? colors.neon : blocked ? colors.surfaceRaised : colors.neon,
          },
        ]}
      >
        <Ionicons
          name={done ? "checkmark" : busy ? "ellipsis-horizontal" : "arrow-forward"}
          size={22}
          color={blocked && !done && !busy ? colors.textFaint : colors.onNeon}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 64,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: "center",
    paddingHorizontal: 4,
    overflow: "hidden",
  },
  trackDisabled: { opacity: 0.55 },
  fill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.neonSoft,
  },
  label: {
    position: "absolute",
    left: 0,
    right: 0,
    textAlign: "center",
    color: colors.textDim,
    fontSize: 15,
    fontWeight: "600",
  },
  knob: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    ...Platform.select({
      android: { elevation: 4 },
      default: {
        shadowColor: "#000",
        shadowOpacity: 0.4,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
      },
    }),
  },
});
