import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { colors, radius, spacing, type } from "@/lib/theme";
import { usd } from "@/lib/format";
import { fetchTrips, type Trip } from "@/lib/travel";
import { Button, ErrorNote, Screen, StatusBadge, SummaryRow, Surface } from "@/components/ui";

// Native itinerary detail — replaces the old browser hand-off to
// furlpay.com/travel/booking/<id>. Reads the same trips query the travel home
// uses (cache-first), so opening a trip you just looked at is instant.

export default function TripDetail() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const trips = useQuery({ queryKey: ["travel", "trips"], queryFn: fetchTrips, staleTime: 30_000 });

  const all: Trip[] = trips.data
    ? [...trips.data.upcoming, ...trips.data.past, ...trips.data.cancelled]
    : [];
  const trip = all.find((t) => t.id === id);

  if (trips.isLoading) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "Trip" }} />
        <View style={styles.center}>
          <Text style={type.dim}>Loading trip…</Text>
        </View>
      </Screen>
    );
  }
  if (trips.error || !trip) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "Trip" }} />
        <View style={styles.center}>
          <ErrorNote message={(trips.error as Error)?.message ?? "Trip not found."} />
          <Button title="Back to Travel" variant="secondary" onPress={() => router.replace("/travel")} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: trip.city }} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.name}>{trip.name}</Text>
          <View style={styles.headerMeta}>
            <Ionicons name="location-outline" size={13} color={colors.textDim} />
            <Text style={type.dim}>{trip.city}</Text>
            <StatusBadge status={trip.status} />
          </View>
        </View>

        <Surface style={styles.datesCard}>
          <View style={styles.dateCol}>
            <Text style={styles.dateLabel}>Check-in</Text>
            <Text style={styles.dateValue}>{trip.checkIn}</Text>
          </View>
          <Ionicons name="arrow-forward" size={16} color={colors.textFaint} />
          <View style={styles.dateCol}>
            <Text style={styles.dateLabel}>Check-out</Text>
            <Text style={styles.dateValue}>{trip.checkOut}</Text>
          </View>
        </Surface>

        <Surface style={styles.card}>
          <SummaryRow k="Nights" v={`${trip.nights}`} />
          <SummaryRow k="Guests" v={`${trip.guests}`} />
          <SummaryRow k="Paid with" v={trip.method} />
          <SummaryRow k="Total paid" v={usd(trip.amountUsd)} bold />
          <SummaryRow k="Cashback earned" v={`${usd(trip.cashbackUsd)} USDC`} />
          <SummaryRow k="Booking ID" v={trip.id} />
        </Surface>

        {trip.status === "confirmed" && (
          <View style={styles.note}>
            <Ionicons name="shield-checkmark-outline" size={14} color={colors.neon} />
            <Text style={styles.noteText}>
              Your booking is confirmed. Show the booking ID at check-in — no printout needed.
            </Text>
          </View>
        )}

        <Button
          title="Need help with this trip?"
          variant="secondary"
          onPress={() => router.push("/support")}
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },

  header: { gap: spacing.xs },
  name: { ...type.title, fontSize: 22 },
  headerMeta: { flexDirection: "row", alignItems: "center", gap: spacing.xs },

  datesCard: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  dateCol: { gap: 2 },
  dateLabel: { ...type.dim, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 },
  dateValue: { ...type.body, fontWeight: "700" },

  card: { gap: 6 },

  note: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    padding: spacing.sm,
    backgroundColor: colors.neonSoft,
    borderRadius: radius.md,
  },
  noteText: { color: colors.neon, fontSize: 12, flex: 1 },
});
