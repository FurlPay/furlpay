// The microphone that sits in a search field.
//
// ---------------------------------------------------------------------------
// IT NEVER PRETENDS. Three states are visible and distinct: idle, listening,
// and unavailable. On a build without the native speech module the button is
// still shown but dimmed, and tapping it says WHY rather than doing nothing —
// "Voice search needs the latest app build" is actionable; a dead button is
// not.
//
// The pulse while listening is the only animation, and it exists because
// dictation has no other feedback: the keyboard is down, the field is empty
// until the first partial arrives, and without a moving element the user
// cannot tell the microphone is open.
// ---------------------------------------------------------------------------

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { colors, spacing } from "@/lib/theme";
import {
  describeUnavailable,
  isSpeechAvailable,
  listenOnce,
  requestSpeechPermission,
  speechUnavailableReason,
  stopListening,
  type SpeechUnavailable,
} from "../lib/speech";

interface Props {
  /** Called with the final transcript. */
  onTranscript: (text: string) => void;
  /** Called with interim text so the field fills in as the user speaks. */
  onPartial?: (text: string) => void;
  /** Shown under the field when something goes wrong. */
  onStatus?: (message: string | null) => void;
  size?: number;
}

export function VoiceSearchButton({ onTranscript, onPartial, onStatus, size = 20 }: Props) {
  const [listening, setListening] = useState(false);
  const available = isSpeechAvailable();
  const pulse = useRef(new Animated.Value(0)).current;
  /* A component unmounted mid-recognition must not call setState afterwards,
     and must not leave the microphone open. */
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      stopListening();
    };
  }, []);

  useEffect(() => {
    if (!listening) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 700, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [listening, pulse]);

  const fail = useCallback(
    (reason: SpeechUnavailable) => {
      onStatus?.(describeUnavailable(reason));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => { });
    },
    [onStatus]
  );

  const onPress = useCallback(async () => {
    if (listening) {
      stopListening();
      setListening(false);
      return;
    }

    const blocked = speechUnavailableReason();
    if (blocked) {
      fail(blocked);
      return;
    }

    /* Asked at the moment of the tap, so the system prompt appears when the
       user has just expressed the intent it is asking about. */
    const granted = await requestSpeechPermission();
    if (!granted) {
      fail("permission-denied");
      return;
    }

    onStatus?.(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => { });
    setListening(true);

    const res = await listenOnce({ onPartial, maxMs: 12000 });

    if (!alive.current) return;
    setListening(false);

    if (res.ok) {
      onTranscript(res.transcript);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => { });
    } else {
      fail(res.reason);
    }
  }, [listening, onPartial, onTranscript, onStatus, fail]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] });

  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={listening ? "Stop voice search" : "Search by voice"}
      accessibilityState={{ disabled: !available, busy: listening }}
      accessibilityHint={
        available ? "Dictate your search instead of typing" : "Unavailable on this build"
      }
      style={styles.hit}
    >
      {listening ? (
        <Animated.View style={[styles.halo, { transform: [{ scale }], opacity }]} />
      ) : null}
      <Ionicons
        name={listening ? "mic" : "mic-outline"}
        size={size}
        color={listening ? colors.neon : available ? colors.textFaint : colors.border}
      />
    </Pressable>
  );
}

/** The one-line status shown under a field when voice fails. */
export function VoiceStatus({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View style={styles.status}>
      <Ionicons name="information-circle-outline" size={13} color={colors.textFaint} />
      <Text style={styles.statusText}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hit: { alignItems: "center", justifyContent: "center", width: 44, height: 44 },
  halo: {
    position: "absolute",
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.neon,
  },
  status: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: spacing.xs },
  statusText: { color: colors.textFaint, fontSize: 12, flexShrink: 1 },
});
