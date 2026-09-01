import React from "react";
import { FlatList, Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { colors, radius, spacing, type } from "@/lib/theme";
import { usd } from "@/lib/format";
import { fetchHotels, type Stay } from "@/lib/travel";
import { EmptyState, ErrorNote, Screen } from "@/components/ui";

const GOLD = "#F5B851";
const NIGHTS = 3;

function Stars({ n }: { n: number }) {
  return (
    <View style={styles.stars}>
      {Array.from({ length: n }).map((_, i) => (
        <Ionicons key={i} name="star" size={11} color={GOLD} />
      ))}
    </View>
  );
}

function StayCard({ stay, onPress }: { stay: Stay; onPress: () => void }) {
  // A rate is absent whenever no live provider returned one, which today is
  // every property: the indexed dataset carries no prices. The card used to
  // multiply a fabricated nightlyUsd into a total; now it shows what it knows
  // and says so about the rest.
  const total = stay.nightlyUsd !== undefined ? stay.nightlyUsd * NIGHTS : null;
  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={[
        stay.name,
        stay.stars !== undefined ? `${stay.stars} star` : null,
        stay.type ?? null,
        stay.rating !== undefined ? `rated ${stay.rating}` : "no rating yet",
        stay.nightlyUsd !== undefined ? `${usd(stay.nightlyUsd)} a night` : "price unavailable",
      ]
        .filter(Boolean)
        .join(". ")}
      onPress={onPress}
    >
      <View style={styles.photoWrap}>
        {stay.photo ? (
          <Image source={{ uri: stay.photo }} style={styles.photo} />
        ) : (
          <View style={[styles.photo, { backgroundColor: colors.surfaceRaised }]} />
        )}
        <View style={styles.badgeRow}>
          <Text style={[styles.pill, styles.pillGain]}>2% back</Text>
          {stay.eco && <Text style={[styles.pill, styles.pillAccent]}>Eco</Text>}
        </View>
        <Text style={styles.typeTag}>{stay.type}</Text>
      </View>

      <View style={styles.body}>
        <View style={styles.titleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.name} numberOfLines={1}>
              {stay.name}
            </Text>
            <View style={styles.cityRow}>
              <Ionicons name="location-outline" size={12} color={colors.textDim} />
              <Text style={type.dim} numberOfLines={1}>
                {stay.city}
              </Text>
            </View>
          </View>
          {stay.rating !== undefined && (
            <View style={styles.ratingBadge}>
              <Ionicons name="star" size={11} color={colors.neon} />
              <Text style={styles.ratingText}>{stay.rating}</Text>
            </View>
          )}
        </View>

        <View style={styles.starsRow}>
          {stay.stars !== undefined && <Stars n={stay.stars} />}
          {stay.reviews !== undefined && (
            <Text style={styles.reviews}>({stay.reviews.toLocaleString()} reviews)</Text>
          )}
        </View>

        <View style={styles.priceRow}>
          <View>
            {total !== null && stay.nightlyUsd !== undefined ? (
              <>
                <Text style={styles.price}>
                  {usd(stay.nightlyUsd)}
                  <Text style={styles.perNight}> /night</Text>
                </Text>
                <Text style={styles.totalLine}>
                  {usd(total)} total · {NIGHTS} nights
                </Text>
              </>
            ) : (
              // Saying why beats an empty gap that reads as a spinner that
              // never resolves.
              <Text style={styles.totalLine}>Live pricing unavailable</Text>
            )}
          </View>
          <View style={styles.cta}>
            <Text style={styles.ctaText}>View</Text>
          </View>
        </View>

        {stay.roomsLeft !== undefined && stay.roomsLeft <= 3 && (
          <Text style={styles.roomsLeft}>
            Only {stay.roomsLeft} {stay.roomsLeft === 1 ? "room" : "rooms"} left
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

export default function Hotels() {
  const router = useRouter();
  const { city } = useLocalSearchParams<{ city?: string }>();
  const q = (city ?? "").trim() || "Anywhere";

  const hotels = useQuery({
    queryKey: ["travel", "hotels", q],
    queryFn: () => fetchHotels(q),
    staleTime: 60_000,
  });

  const list: Stay[] = hotels.data?.hotels ?? hotels.data?.collections?.flatMap((c) => c.hotels) ?? [];

  const open = (stay: Stay) =>
    router.push({ pathname: "/travel/property/[id]", params: { id: stay.id, city: stay.city } });

  return (
    <Screen>
      <Stack.Screen options={{ title: `Stays in ${q}` }} />
      {hotels.isLoading ? (
        <View style={styles.center}>
          <Text style={type.dim}>Finding the best 4–5★ stays…</Text>
        </View>
      ) : hotels.error ? (
        <View style={styles.center}>
          <ErrorNote message={(hotels.error as Error).message} />
        </View>
      ) : list.length === 0 ? (
        <EmptyState title={`No stays for ${q}`} subtitle="Try another destination." />
      ) : (
        <FlatList
          data={list}
          keyExtractor={(s) => s.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => <StayCard stay={item} onPress={() => open(item)} />}
          ListHeaderComponent={
            <Text style={styles.header}>
              {list.length} top-rated {list.length === 1 ? "stay" : "stays"} · rates lock 15 min at checkout
            </Text>
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  listContent: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  header: { ...type.dim, fontSize: 12, marginBottom: spacing.xs },

  card: { borderRadius: radius.md, overflow: "hidden", backgroundColor: colors.surface, borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth },
  photoWrap: { height: 160, backgroundColor: colors.surfaceRaised },
  photo: { width: "100%", height: "100%" },
  badgeRow: { position: "absolute", top: spacing.sm, left: spacing.sm, flexDirection: "row", gap: spacing.xs },
  pill: { fontSize: 11, fontWeight: "700", paddingHorizontal: spacing.xs, paddingVertical: 2, borderRadius: radius.sm, overflow: "hidden" },
  pillGain: { backgroundColor: colors.neonSoft, color: colors.neon },
  pillAccent: { backgroundColor: "rgba(0,0,0,0.55)", color: "#FFFFFF" },
  typeTag: {
    position: "absolute",
    top: spacing.sm,
    right: spacing.sm,
    fontSize: 11,
    fontWeight: "600",
    color: "#FFFFFF",
    backgroundColor: "rgba(0,0,0,0.5)",
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radius.pill,
    overflow: "hidden",
  },

  body: { padding: spacing.md, gap: spacing.xs },
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  name: { ...type.body, fontWeight: "700" },
  cityRow: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 2 },
  ratingBadge: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: colors.surfaceRaised, paddingHorizontal: 6, paddingVertical: 3, borderRadius: radius.sm },
  ratingText: { color: colors.text, fontSize: 12, fontWeight: "700" },

  starsRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  stars: { flexDirection: "row", gap: 1 },
  reviews: { ...type.dim, fontSize: 11 },

  priceRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", marginTop: spacing.xs },
  price: { ...type.body, fontSize: 18, fontWeight: "700" },
  perNight: { ...type.dim, fontWeight: "400", fontSize: 12 },
  totalLine: { ...type.dim, fontSize: 11 },
  cta: { backgroundColor: colors.neon, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md },
  ctaText: { color: colors.onNeon, fontWeight: "700", fontSize: 13 },

  roomsLeft: { color: colors.accent, fontSize: 11, fontWeight: "600", marginTop: spacing.xs },
});
