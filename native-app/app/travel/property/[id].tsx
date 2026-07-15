import React, { useState } from "react";
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { colors, radius, spacing, type } from "@/lib/theme";
import { usd } from "@/lib/format";
import { fetchProperty, type Room } from "@/lib/travel";
import { Button, ErrorNote, Screen } from "@/components/ui";

const GOLD = "#F5B851";
const NIGHTS = 3;

function RoomOption({ room, selected, onPress }: { room: Room; selected: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={[styles.room, selected && styles.roomSelected]}
    >
      <View style={styles.roomRadio}>
        <Ionicons
          name={selected ? "radio-button-on" : "radio-button-off"}
          size={20}
          color={selected ? colors.neon : colors.textFaint}
        />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.roomName}>{room.name}</Text>
        <Text style={type.dim}>
          {room.cancellable ? "Free cancellation" : "Non-refundable"} · pay in USDC / SOL
        </Text>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={styles.roomPrice}>{usd(room.nightlyUsd)}</Text>
        <Text style={type.dim}>/night</Text>
      </View>
    </TouchableOpacity>
  );
}

export default function Property() {
  const router = useRouter();
  const { id, city } = useLocalSearchParams<{ id: string; city?: string }>();
  const c = (city ?? "").trim();
  const [roomIdx, setRoomIdx] = useState(0);

  const detail = useQuery({
    queryKey: ["travel", "property", id, c],
    queryFn: () => fetchProperty(String(id), c),
    staleTime: 60_000,
  });

  if (detail.isLoading) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "Hotel" }} />
        <View style={styles.center}>
          <Text style={type.dim}>Loading property…</Text>
        </View>
      </Screen>
    );
  }
  if (detail.error || !detail.data) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "Hotel" }} />
        <View style={styles.center}>
          <ErrorNote message={(detail.error as Error)?.message ?? "Property not found."} />
        </View>
      </Screen>
    );
  }

  const { property: p, rooms, cashbackPct, rateLockMinutes } = detail.data;
  const room = rooms[Math.min(roomIdx, rooms.length - 1)];
  const roomTotal = Math.round(room.nightlyUsd * NIGHTS * 100) / 100;

  const book = () =>
    router.push({
      pathname: "/travel/checkout",
      params: {
        name: `${p.name} · ${room.name}`,
        city: p.city,
        // subtotal, for the checkout ESTIMATE only — the server re-derives the
        // authoritative price from propertyId + roomIndex + nights.
        amount: String(roomTotal),
        nights: String(NIGHTS),
        img: p.photo ?? "",
        propertyId: p.id,
        roomIndex: String(roomIdx),
      },
    });

  return (
    <Screen>
      <Stack.Screen options={{ title: p.brand === "Independent" ? p.type : p.brand }} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          {p.photo ? (
            <Image source={{ uri: p.photo }} style={styles.heroImg} />
          ) : (
            <View style={[styles.heroImg, { backgroundColor: colors.surfaceRaised }]} />
          )}
        </View>

        <View style={styles.headerBlock}>
          <Text style={styles.name}>{p.name}</Text>
          <View style={styles.metaRow}>
            <View style={styles.stars}>
              {Array.from({ length: p.stars }).map((_, i) => (
                <Ionicons key={i} name="star" size={13} color={GOLD} />
              ))}
            </View>
            <View style={styles.ratingBadge}>
              <Ionicons name="star" size={12} color={colors.neon} />
              <Text style={styles.ratingText}>
                {p.rating} · {p.reviews.toLocaleString()} reviews
              </Text>
            </View>
          </View>
          <View style={styles.cityRow}>
            <Ionicons name="location-outline" size={13} color={colors.textDim} />
            <Text style={type.dim}>
              {p.city} · {p.country !== "—" ? p.country : p.type}
            </Text>
          </View>
        </View>

        {p.amenities.length > 0 && (
          <View style={styles.amenities}>
            {p.amenities.map((a) => (
              <View key={a} style={styles.amenity}>
                <Ionicons name="checkmark-circle-outline" size={13} color={colors.neon} />
                <Text style={styles.amenityText}>{a}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={styles.notice}>
          <Ionicons name="pricetag-outline" size={14} color={colors.neon} />
          <Text style={styles.noticeText}>
            {cashbackPct}% cashback in USDC · rate locks {rateLockMinutes} min at checkout
          </Text>
        </View>

        <Text style={styles.sectionTitle}>Choose your room</Text>
        <View style={styles.rooms}>
          {rooms.map((r, i) => (
            <RoomOption key={r.name} room={r} selected={i === roomIdx} onPress={() => setRoomIdx(i)} />
          ))}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <View>
          <Text style={styles.footerTotal}>{usd(roomTotal)}</Text>
          <Text style={type.dim}>
            {NIGHTS} nights · {room.name}
          </Text>
        </View>
        <Button title="Book now" onPress={book} style={{ paddingHorizontal: spacing.xl }} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  content: { paddingBottom: spacing.xl },

  hero: { height: 220, backgroundColor: colors.surfaceRaised },
  heroImg: { width: "100%", height: "100%" },

  headerBlock: { padding: spacing.md, gap: spacing.xs },
  name: { ...type.title, fontSize: 22 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  stars: { flexDirection: "row", gap: 1 },
  ratingBadge: { flexDirection: "row", alignItems: "center", gap: 4 },
  ratingText: { color: colors.text, fontSize: 12, fontWeight: "600" },
  cityRow: { flexDirection: "row", alignItems: "center", gap: 4 },

  amenities: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, paddingHorizontal: spacing.md },
  amenity: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.surface, paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.pill, borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth },
  amenityText: { color: colors.text, fontSize: 12 },

  notice: { flexDirection: "row", alignItems: "center", gap: spacing.xs, margin: spacing.md, marginBottom: 0, padding: spacing.sm, backgroundColor: colors.neonSoft, borderRadius: radius.md },
  noticeText: { color: colors.neon, fontSize: 12, fontWeight: "600", flex: 1 },

  sectionTitle: { ...type.h2, fontSize: 17, paddingHorizontal: spacing.md, marginTop: spacing.lg, marginBottom: spacing.sm },
  rooms: { paddingHorizontal: spacing.md, gap: spacing.sm },
  room: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
  roomSelected: { borderColor: colors.neon, backgroundColor: colors.neonSoft },
  roomRadio: { width: 22 },
  roomName: { ...type.body, fontWeight: "600" },
  roomPrice: { ...type.body, fontWeight: "700" },

  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: spacing.md,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    backgroundColor: colors.surface,
  },
  footerTotal: { ...type.body, fontSize: 20, fontWeight: "700" },
});
