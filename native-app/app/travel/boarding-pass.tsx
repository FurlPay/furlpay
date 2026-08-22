import React from "react";
import { RefreshControl, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { colors, spacing, type } from "@/lib/theme";
import { fetchBoardingPasses, statusLine, type BoardingPass } from "@/lib/boardingPass";
import { Button, EmptyState, ErrorNote, Screen } from "@/components/ui";
import { LiveActivityCard } from "@/components/trips/LiveActivityCard";
import { TripHeroCard } from "@/components/trips/TripHeroCard";
import { BoardingPassCard } from "@/components/trips/BoardingPassCard";
import { GateActionBar } from "@/components/trips/GateActionBar";
import { FlightStatusCard } from "@/components/trips/FlightStatusCard";
import { PaidWithCard } from "@/components/trips/PaidWithCard";

// The FurlPay Trips screen: live flight status, the trip, the pass, and what it
// cost — the order a traveller needs them in on the day.
//
// Everything on this screen comes from GET /api/travel/boarding-passes. There
// is no local fallback pass and no placeholder itinerary: with no flight
// booked, the screen says so.

/** One second is the coarsest tick that still lands "Boarding in 1 min" on time. */
function useNow(active: boolean): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

export default function BoardingPassScreen() {
  const router = useRouter();
  const [expanded, setExpanded] = React.useState(false);

  const query = useQuery({
    queryKey: ["travel", "boarding-passes"],
    queryFn: fetchBoardingPasses,
    staleTime: 30_000,
    // The gate and the boarding time are the two facts that change without
    // warning, so this screen re-reads them while it is open.
    refetchInterval: 60_000,
  });

  const pass: BoardingPass | undefined = query.data?.passes[0];
  const now = useNow(!!pass);

  const share = React.useCallback(async () => {
    if (!pass) return;
    const { flight, passenger } = pass;
    await Share.share({
      message:
        `${flight.number} · ${flight.originCode} → ${flight.destinationCode}\n` +
        `${passenger.name} · Seat ${flight.seat} · Gate ${flight.gate}\n` +
        `Boards ${flight.boardingTime}, departs ${flight.departureTime}, arrives ${flight.arrivalTime}`,
    });
  }, [pass]);

  return (
    <Screen>
      <Stack.Screen options={{ title: "Boarding pass" }} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={() => void query.refetch()}
            tintColor={colors.text}
          />
        }
      >
        {query.isLoading ? (
          <Text style={type.dim}>Loading your boarding pass…</Text>
        ) : query.error ? (
          <ErrorNote message={(query.error as Error).message} />
        ) : !pass ? (
          <EmptyState
            title="No flight booked"
            subtitle="Book a flight and your boarding pass, gate and live status appear here."
          />
        ) : (
          <>
            <LiveActivityCard pass={pass} statusText={statusLine(pass, now)} />

            <View style={styles.tripBlock}>
              <TripHeroCard title={pass.title} routeLabel={pass.routeLabel} />
              <BoardingPassCard
                pass={pass}
                expanded={expanded}
                onToggle={() => setExpanded((v) => !v)}
              />
            </View>

            <GateActionBar pass={pass} onShowDetails={() => setExpanded(true)} onShare={share} />

            <FlightStatusCard pass={pass} now={now} />

            <PaidWithCard payment={pass.payment} />

            <Button
              title="All trips"
              variant="secondary"
              onPress={() => router.push("/travel")}
            />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  // The pass overlaps the hero photo, so the two travel together as one block.
  tripBlock: { gap: 0 },
});
