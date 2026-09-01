import React, { useMemo, useState } from "react";
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { colors, radius, spacing, type } from "@/lib/theme";
import { usd } from "@/lib/format";
import {
  CASHBACK_PCT,
  RATE_LOCK_MINUTES,
  addDays,
  deriveRooms,
  fetchProperty,
  formatStayDate,
  todayIso,
  type HotelsResponse,
  type Room,
  type Stay,
} from "@/lib/travel";
import { Button, ErrorNote, Screen, Stepper } from "@/components/ui";

const GOLD = "#F5B851";
const MAX_NIGHTS = 21;
const MAX_GUESTS = 8;
// How many days out the check-in strip offers.
const CHECKIN_WINDOW = 60;

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

/** Horizontal strip of selectable check-in dates (today … +CHECKIN_WINDOW). */
function DateStrip({ value, onChange }: { value: string; onChange: (iso: string) => void }) {
  const days = useMemo(() => Array.from({ length: CHECKIN_WINDOW }, (_, i) => addDays(todayIso(), i)), []);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dateStrip}>
      {days.map((iso) => {
        const selected = iso === value;
        const d = new Date(iso + "T00:00:00Z");
        return (
          <TouchableOpacity
            key={iso}
            activeOpacity={0.85}
            onPress={() => onChange(iso)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={`Check in ${formatStayDate(iso)}`}
            style={[styles.dateChip, selected && styles.dateChipSelected]}
          >
            <Text style={[styles.dateDow, selected && { color: colors.onNeon }]}>
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()]}
            </Text>
            <Text style={[styles.dateNum, selected && { color: colors.onNeon }]}>{d.getUTCDate()}</Text>
            <Text style={[styles.dateMon, selected && { color: colors.onNeon }]}>
              {["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()]}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

export default function Property() {
  const router = useRouter();
  const qc = useQueryClient();
  const { id, city } = useLocalSearchParams<{ id: string; city?: string }>();
  const c = (city ?? "").trim();
  const [roomIdx, setRoomIdx] = useState(0);
  // Check-in defaults two weeks out (matches the server's default trip window).
  const [checkIn, setCheckIn] = useState(() => addDays(todayIso(), 14));
  const [nights, setNights] = useState(3);
  const [guests, setGuests] = useState(2);
  const checkOut = addDays(checkIn, nights);

  // The hotels list the user just came from already holds the full Stay. Find
  // it in ANY cached hotels query (deal card, typed search, or collection —
  // regardless of how the city key was cased) and render from it: no extra
  // round-trip, and — crucially — it works with live Duffel inventory, whose
  // ids the /property route can't re-resolve (it re-derives demo inventory).
  const cachedStay = useMemo<Stay | undefined>(() => {
    const lists = qc.getQueriesData<HotelsResponse>({ queryKey: ["travel", "hotels"] });
    for (const [, data] of lists) {
      const all = data?.hotels ?? data?.collections?.flatMap((col) => col.hotels) ?? [];
      const found = all.find((s) => s.id === id);
      if (found) return found;
    }
    return undefined;
  }, [qc, id]);

  // Only hit the network on a cold deep-link (e.g. a notification) where no
  // hotels list is cached. The normal navigation path never fetches here.
  const detail = useQuery({
    queryKey: ["travel", "property", id, c],
    queryFn: () => fetchProperty(String(id), c),
    enabled: !cachedStay,
    staleTime: 60_000,
  });

  const p: Stay | undefined = cachedStay ?? detail.data?.property;
  const rooms: Room[] | undefined = cachedStay ? deriveRooms(cachedStay) : detail.data?.rooms;
  const cashbackPct = cachedStay ? CASHBACK_PCT : detail.data?.cashbackPct ?? CASHBACK_PCT;
  const rateLockMinutes = cachedStay ? RATE_LOCK_MINUTES : detail.data?.rateLockMinutes ?? RATE_LOCK_MINUTES;

  if (!p || !rooms) {
    const loading = !cachedStay && detail.isLoading;
    return (
      <Screen>
        <Stack.Screen options={{ title: "Hotel" }} />
        <View style={styles.center}>
          {loading ? (
            <Text style={type.dim}>Loading property…</Text>
          ) : (
            <ErrorNote message={(detail.error as Error)?.message ?? "Property not found."} />
          )}
        </View>
      </Screen>
    );
  }

  // undefined when there are no rooms — see the footer.
  //
  // Math.min(roomIdx, rooms.length - 1) is -1 on an empty list, so this used
  // to read rooms[-1] and dereference undefined one line later. That never
  // happened while the server always returned three derived rooms; it does now
  // that a property with no live rate returns none, and it would have been a
  // crash on the first such screen.
  const room: Room | undefined =
    rooms.length > 0 ? rooms[Math.min(roomIdx, rooms.length - 1)] : undefined;
  const roomTotal = room ? Math.round(room.nightlyUsd * nights * 100) / 100 : 0;

  const book = () => {
    // Unreachable while the footer hides the button without a room, but the
    // guard is cheap and this is the function that spends money.
    if (!room) return;
    return router.push({
      pathname: "/travel/checkout",
      params: {
        name: `${p.name} · ${room.name}`,
        city: p.city,
        // subtotal, for the checkout ESTIMATE only — the server re-derives the
        // authoritative price from propertyId + roomIndex + nights.
        amount: String(roomTotal),
        nights: String(nights),
        guests: String(guests),
        checkIn,
        checkOut,
        img: p.photo ?? "",
        propertyId: p.id,
        roomIndex: String(roomIdx),
      },
    });
  };

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
            {p.stars !== undefined && (
              <View style={styles.stars}>
                {Array.from({ length: p.stars }).map((_, i) => (
                  <Ionicons key={i} name="star" size={13} color={GOLD} />
                ))}
              </View>
            )}
            {/* The rating and its count travel together: 4.9 over three
                reviews and 4.4 over nine thousand are not the same claim. */}
            {p.rating !== undefined && (
              <View style={styles.ratingBadge}>
                <Ionicons name="star" size={12} color={colors.neon} />
                <Text style={styles.ratingText}>
                  {p.rating}
                  {p.reviews !== undefined ? ` · ${p.reviews.toLocaleString()} reviews` : ""}
                </Text>
              </View>
            )}
          </View>
          <View style={styles.cityRow}>
            <Ionicons name="location-outline" size={13} color={colors.textDim} />
            <Text style={type.dim}>
              {p.city} · {p.country !== "—" ? p.country : p.type}
            </Text>
          </View>
        </View>

        {p.amenities !== undefined && p.amenities.length > 0 && (
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

        <Text style={styles.sectionTitle}>Your stay</Text>
        <View style={styles.stayBlock}>
          <Text style={styles.stayLabel}>Check-in</Text>
          <DateStrip value={checkIn} onChange={setCheckIn} />
          <View style={styles.stayControls}>
            <Stepper label="Nights" value={nights} min={1} max={MAX_NIGHTS} onChange={setNights} suffix={["night", "nights"]} />
            <Stepper label="Guests" value={guests} min={1} max={MAX_GUESTS} onChange={setGuests} suffix={["guest", "guests"]} />
          </View>
          <View style={styles.stayDates}>
            <Ionicons name="calendar-outline" size={13} color={colors.textDim} />
            <Text style={type.dim}>
              {formatStayDate(checkIn)} → {formatStayDate(checkOut)} · {nights} {nights === 1 ? "night" : "nights"}
            </Text>
          </View>
        </View>

        {rooms.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Choose your room</Text>
            <View style={styles.rooms}>
              {rooms.map((r, i) => (
                <RoomOption key={r.name} room={r} selected={i === roomIdx} onPress={() => setRoomIdx(i)} />
              ))}
            </View>
          </>
        )}
      </ScrollView>

      {/* NO ROOMS MEANS NO BOOKING, and the button goes with them.
          Room tiers are multipliers over a live nightly rate; without one
          there is nothing to price, and the server agrees — /api/travel/book
          answers 503 rate_unavailable rather than charging a derived amount.
          Leaving "Book now" on screen would offer a purchase that cannot
          complete, which is worse than saying so. */}
      {rooms.length > 0 && room ? (
        <View style={styles.footer}>
          <View style={{ flex: 1 }}>
            <Text style={styles.footerTotal}>{usd(roomTotal)}</Text>
            <Text style={type.dim} numberOfLines={1}>
              {nights} {nights === 1 ? "night" : "nights"} · {guests} {guests === 1 ? "guest" : "guests"} · {room.name}
            </Text>
          </View>
          <Button title="Book now" onPress={book} style={{ paddingHorizontal: spacing.xl }} />
        </View>
      ) : (
        <View style={styles.footer}>
          <View style={{ flex: 1 }}>
            <Text style={styles.footerTotal}>Live pricing unavailable</Text>
            <Text style={type.dim} numberOfLines={2}>
              This property is indexed with its rating and photographs. Rates need a
              live booking provider, which is not connected yet.
            </Text>
          </View>
        </View>
      )}
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

  stayBlock: { paddingHorizontal: spacing.md, gap: spacing.sm },
  stayLabel: { ...type.dim, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5 },
  dateStrip: { gap: spacing.xs, paddingVertical: 2, paddingRight: spacing.md },
  dateChip: {
    width: 52,
    alignItems: "center",
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    gap: 1,
  },
  dateChipSelected: { backgroundColor: colors.neon, borderColor: colors.neon },
  dateDow: { ...type.dim, fontSize: 10, textTransform: "uppercase" },
  dateNum: { color: colors.text, fontSize: 17, fontWeight: "800" },
  dateMon: { ...type.dim, fontSize: 10, textTransform: "uppercase" },
  stayControls: { gap: spacing.sm, marginTop: spacing.xs },
  stayDates: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },

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
