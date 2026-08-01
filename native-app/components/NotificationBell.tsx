import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { unreadNotificationCount } from "@/lib/db";
import { colors, radius } from "@/lib/theme";

// Notification entry point with an unread indicator.
//
// The count was already being maintained — lib/push.ts writes every push this
// device received into SQLite and lib/db.ts has exposed
// `unreadNotificationCount()` all along — but nothing on the home screen read
// it, so the inbox was reachable only from Settings and the account drawer. A
// push that arrived while the app was closed left no trace anywhere the user
// would look.
//
// READ ON FOCUS, NOT ON AN INTERVAL. The count lives in local SQLite, so it can
// only change when a push lands or when the user opens the inbox. Re-reading
// when this screen regains focus covers both and costs one synchronous query,
// where a timer would spin the JS thread forever for a number that is usually
// unchanged.

export function NotificationBell({ onPress }: { onPress: () => void }) {
  const [count, setCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      try {
        setCount(unreadNotificationCount());
      } catch {
        // The badge is never worth failing the home screen over.
        setCount(0);
      }
    }, [])
  );

  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={styles.button}
      accessibilityRole="button"
      accessibilityLabel={
        count > 0
          ? `Notifications, ${count} unread`
          : "Notifications"
      }
    >
      <Ionicons name="notifications-outline" size={20} color={colors.text} />
      {count > 0 ? (
        // A dot, not a number: the exact count of unread pushes is not a
        // decision input, and a two-digit badge on a 40px control is unreadable
        // anyway. The ring separates it from the icon at any background.
        <View style={styles.dot} accessibilityElementsHidden />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    position: "absolute",
    top: 9,
    right: 10,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: colors.surfaceRaised,
  },
});
