import React, { useState } from "react";
import { Image, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { colors, radius, spacing, type } from "@/lib/theme";
import { usd } from "@/lib/format";
import { fetchDeals, fetchTrips, type Deal, type Trip } from "@/lib/travel";
import { Button, EmptyState, ErrorNote, Field, Screen, SectionHeader, StatusBadge, Surface } from "@/components/ui";

// Fully-native travel home. Deals and trips render natively; tapping a deal or
// searching a destination opens the native hotel results screen — no browser
// hand-off. See lib/travel.ts.

function DealCard({ deal, onPress }: { deal: Deal; onPress: () => void }) {
  const wasNightly = deal.nightlyUsd / (1 - deal.discountPct / 100);
  return (
    <TouchableOpacity
      style={styles.deal}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={`${deal.name}, ${deal.city}. ${usd(deal.nightlyUsd)} a night, ${deal.discountPct}% off. Shows hotels in ${deal.city}.`}
      onPress={onPress}
    >
      <Image source={{ uri: deal.photo }} style={styles.dealPhoto} />
      <View style={styles.dealBody}>
        <Text style={type.dim} numberOfLines={1}>
          {deal.city} · {deal.country}
        </Text>
        <Text style={styles.dealName} numberOfLines={1}>
          {deal.name}
        </Text>
        <View style={styles.dealPrice}>
          <Text style={styles.dealNightly}>{usd(deal.nightlyUsd)}</Text>
          <Text style={styles.dealWas}>{usd(wasNightly)}</Text>
          <Text style={type.dim}>/night</Text>
        </View>
        <View style={styles.dealTags}>
          <Text style={styles.tag}>−{deal.discountPct}%</Text>
          <Text style={styles.tag}>Pay in {deal.payToken}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

function TripRow({ trip, onPress }: { trip: Trip; onPress: () => void }) {
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={`${trip.name} in ${trip.city}, ${trip.checkIn} to ${trip.checkOut}. Opens itinerary.`}
      onPress={onPress}
    >
      <Surface style={styles.trip}>
        <View style={styles.tripMain}>
          <Text style={styles.tripName} numberOfLines={1}>
            {trip.name}
          </Text>
          <Text style={type.dim} numberOfLines={1}>
            {trip.city} · {trip.checkIn} → {trip.checkOut} · {trip.nights}n
          </Text>
          <Text style={type.dim} numberOfLines={1}>
            {trip.method}
          </Text>
        </View>
        <View style={styles.tripRight}>
          <Text style={styles.tripAmount}>{usd(trip.amountUsd)}</Text>
          <StatusBadge status={trip.status} />
        </View>
      </Surface>
    </TouchableOpacity>
  );
}

export default function Travel() {
  const router = useRouter();
  const [destination, setDestination] = useState("");

  const deals = useQuery({ queryKey: ["travel", "deals"], queryFn: fetchDeals, staleTime: 60_000 });
  const trips = useQuery({ queryKey: ["travel", "trips"], queryFn: fetchTrips, staleTime: 30_000 });

  const refreshing = deals.isRefetching || trips.isRefetching;
  const refresh = () => {
    void deals.refetch();
    void trips.refetch();
  };

  const openCity = (city: string) => router.push({ pathname: "/travel/hotels", params: { city } });
  const openTrip = (id: string) => router.push({ pathname: "/travel/trip/[id]", params: { id } });

  const search = () => {
    const q = destination.trim();
    if (q) openCity(q);
  };

  // Upcoming first — a traveller opens this screen to check the trip they're on
  // or about to take, not the one they took last year.
  const upcoming = trips.data?.upcoming ?? [];
  const past = trips.data?.past ?? [];

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.text} />}
      >
        <Surface style={styles.search}>
          <Field
            label="Where to?"
            placeholder="Bali, Tokyo, Lisbon…"
            value={destination}
            onChangeText={setDestination}
            autoCapitalize="words"
            returnKeyType="search"
            onSubmitEditing={search}
          />
          <Button title="Search stays" onPress={search} disabled={!destination.trim()} />
          <Text style={styles.hint}>Book stays with USDC, SOL or BTC — 2% cashback, paid natively in the app.</Text>
        </Surface>

        <SectionHeader title="Your trips" />
        {trips.isLoading ? (
          <Text style={type.dim}>Loading trips…</Text>
        ) : trips.error ? (
          <ErrorNote message={(trips.error as Error).message} />
        ) : upcoming.length === 0 && past.length === 0 ? (
          <EmptyState title="No trips yet" subtitle="Book a stay and it'll show up here." />
        ) : (
          <View style={styles.list}>
            {upcoming.map((t) => (
              <TripRow key={t.id} trip={t} onPress={() => openTrip(t.id)} />
            ))}
            {past.slice(0, 3).map((t) => (
              <TripRow key={t.id} trip={t} onPress={() => openTrip(t.id)} />
            ))}
          </View>
        )}

        <SectionHeader title="Flash deals" />
        {deals.isLoading ? (
          <Text style={type.dim}>Loading deals…</Text>
        ) : deals.error ? (
          <ErrorNote message={(deals.error as Error).message} />
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.deals}>
            {(deals.data?.deals ?? []).map((d) => (
              <DealCard key={d.id} deal={d} onPress={() => openCity(d.city)} />
            ))}
          </ScrollView>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  search: { gap: spacing.sm },
  hint: { ...type.dim, fontSize: 12 },
  list: { gap: spacing.sm },

  trip: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  tripMain: { flex: 1, gap: 2 },
  tripName: { ...type.body, fontWeight: "600" },
  tripRight: { alignItems: "flex-end", gap: spacing.xs },
  tripAmount: { ...type.body, fontWeight: "700" },

  deals: { gap: spacing.sm, paddingRight: spacing.md },
  deal: {
    width: 220,
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: colors.surface,
  },
  dealPhoto: { width: "100%", height: 120, backgroundColor: colors.border },
  dealBody: { padding: spacing.sm, gap: 2 },
  dealName: { ...type.body, fontWeight: "600" },
  dealPrice: { flexDirection: "row", alignItems: "baseline", gap: spacing.xs },
  dealNightly: { ...type.body, fontWeight: "700" },
  dealWas: { ...type.dim, textDecorationLine: "line-through" },
  dealTags: { flexDirection: "row", gap: spacing.xs, marginTop: spacing.xs },
  tag: {
    ...type.dim,
    fontSize: 11,
    color: colors.text,
    backgroundColor: colors.border,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radius.sm,
    overflow: "hidden",
  },
});
