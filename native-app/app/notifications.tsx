import React, { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { listNotifications, markNotificationsRead, type StoredNotification } from "@/lib/db";
import { timeAgo } from "@/lib/format";
import { colors, radius, spacing, type } from "@/lib/theme";
import { EmptyState, Screen } from "@/components/ui";

// Notification inbox — every push this device received or was opened from,
// persisted in SQLite by lib/push.ts. Local by design: it is a record of what
// reached THIS device, so it needs no network and works offline.

function routeFor(n: StoredNotification): string | null {
  if (!n.url) return null;
  if (n.url.startsWith("/cards/approve")) return "/approvals";
  return n.url.startsWith("/") ? n.url : null;
}

export default function NotificationsInbox() {
  const router = useRouter();
  const [items, setItems] = useState<StoredNotification[]>([]);

  const load = useCallback(() => setItems(listNotifications()), []);

  useEffect(() => {
    load();
    // Entering the inbox is what "reads" it — badge state clears after render.
    markNotificationsRead();
  }, [load]);

  return (
    <Screen>
      <FlatList
        data={items}
        keyExtractor={(n) => n.id}
        contentContainerStyle={styles.content}
        onRefresh={load}
        refreshing={false}
        ListEmptyComponent={
          <EmptyState
            title="No notifications yet"
            subtitle="Transaction approvals and security alerts land here when they arrive."
          />
        }
        renderItem={({ item }) => {
          const target = routeFor(item);
          return (
            <Pressable
              disabled={!target}
              onPress={() => target && router.push(target as never)}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
            >
              <View style={[styles.dot, { backgroundColor: item.read ? colors.surfaceRaised : colors.neon }]} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[type.body, { fontWeight: item.read ? "400" : "700" }]}>{item.title}</Text>
                {item.body ? (
                  <Text style={type.dim} numberOfLines={2}>
                    {item.body}
                  </Text>
                ) : null}
                <Text style={[type.dim, { fontSize: 11, color: colors.textFaint }]}>
                  {timeAgo(item.receivedAt)}
                </Text>
              </View>
              {target ? <Ionicons name="chevron-forward" size={16} color={colors.textFaint} /> : null}
            </Pressable>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xl },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
