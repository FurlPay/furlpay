import React, { useEffect, useRef, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { colors, radius, spacing, type } from "@/lib/theme";
import { usd } from "@/lib/format";
import { bookStay, quoteStay, TRAVEL_RATES, type BookResult } from "@/lib/travel";
import { queryClient } from "@/lib/queries";
import { Button, ErrorNote, Screen, SummaryRow, Surface } from "@/components/ui";

// Native checkout — the last leg of the travel funnel that used to hand off to
// the web. Mirrors apps/web/src/app/travel/checkout/page.tsx exactly: same
// price math (10% taxes, 2% cashback off the total), same 15-minute rate lock,
// same payment methods, same /api/travel/book call — so a booking made here is
// indistinguishable server-side from one made on the web.

const RATE_LOCK_SECONDS = 15 * 60;
const GUESTS = 2;

type MethodId = "wallet" | "balance" | "vcard" | "card" | "agent";

const METHODS: {
  id: MethodId;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  sub: string;
  source: "travala" | "legacy";
}[] = [
  { id: "wallet", icon: "wallet-outline", title: "Pay with Crypto Wallet", sub: "Phantom, Solflare or Coinbase Wallet · x402 on Base", source: "travala" },
  { id: "balance", icon: "server-outline", title: "Pay with FurlPay Balance", sub: "USDC from your FurlPay account", source: "travala" },
  { id: "vcard", icon: "card-outline", title: "One-time Virtual Card", sub: "Single-use, MCC-locked Visa card", source: "legacy" },
  { id: "card", icon: "card-outline", title: "Credit / Debit Card", sub: "Visa · Mastercard · Amex", source: "legacy" },
  { id: "agent", icon: "hardware-chip-outline", title: "AI Agent Authorization", sub: "Set a budget; your agent completes the booking", source: "travala" },
];

function MethodOption({
  method,
  selected,
  onPress,
}: {
  method: (typeof METHODS)[number];
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${method.title}. ${method.sub}`}
      style={[styles.method, selected && styles.methodSelected]}
    >
      <View style={[styles.methodIcon, selected && styles.methodIconSelected]}>
        <Ionicons name={method.icon} size={16} color={selected ? colors.neon : colors.textDim} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.methodTitle}>{method.title}</Text>
        <Text style={styles.methodSub} numberOfLines={1}>
          {method.sub}
        </Text>
      </View>
      {method.source === "travala" && <Text style={styles.x402}>x402</Text>}
    </TouchableOpacity>
  );
}

export default function Checkout() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    name?: string;
    city?: string;
    amount?: string;
    nights?: string;
    img?: string;
    propertyId?: string;
    roomIndex?: string;
  }>();
  const name = params.name ?? "Your stay";
  const city = params.city ?? "—";
  const nights = Number(params.nights) || 3;
  const roomRate = Number(params.amount) || 0;
  const img = params.img ?? "";
  const propertyId = params.propertyId;
  const roomIndex = params.roomIndex !== undefined ? Number(params.roomIndex) : undefined;

  // ESTIMATE ONLY. quoteStay here mirrors the server's formula so the user sees
  // the price before paying, but the amount actually charged is whatever the
  // server returns (booking.amountUsd / booking.quote) — the server re-derives
  // it from propertyId + roomIndex, never from a number this screen sends.
  const est = quoteStay(roomRate);
  const { taxesUsd: taxes, cashbackUsd: cashback, totalUsd: total } = est;

  const [methodId, setMethodId] = useState<MethodId>("wallet");
  const [agree, setAgree] = useState(false);
  const [lock, setLock] = useState(RATE_LOCK_SECONDS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [booking, setBooking] = useState<BookResult["booking"] | null>(null);
  // Double-submit guard that survives re-renders: the server's distributed
  // lock would catch a race too, but a second tap must not even leave the phone.
  const inFlight = useRef(false);
  // One idempotency key per checkout attempt (lazy, stable across renders). The
  // server dedupes on it, so a timeout-retry / double-tap / process-death
  // re-send books at most once. Regenerated only on a fresh checkout mount.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    const t = setInterval(() => setLock((l) => (l > 0 ? l - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, []);
  const mm = String(Math.floor(lock / 60)).padStart(2, "0");
  const ss = String(lock % 60).padStart(2, "0");

  const pay = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const m = METHODS.find((x) => x.id === methodId)!;
    try {
      const res = await bookStay({
        source: m.source,
        name,
        city,
        image: img || undefined,
        nights,
        guests: GUESTS,
        method: m.title,
        // Server-authoritative price inputs — identifiers, not a total.
        propertyId,
        roomIndex,
        // Fallback subtotal for a checkout reached without a propertyId; the
        // server still owns taxes/cashback/total computed from it.
        subtotalUsd: roomRate || undefined,
        idempotencyKey,
      });
      setBooking(res.booking);
      // The new trip must be there when the user lands back on the travel home.
      void queryClient.invalidateQueries({ queryKey: ["travel", "trips"] });
    } catch (e) {
      setError(
        (e as Error).message === "duplicate_booking_in_flight"
          ? "This booking is already being processed — check My Trips before retrying."
          : "Payment couldn't be authorized — you were not charged. Please try again."
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  // --- confirmation ----------------------------------------------------------
  if (booking) {
    const auth = booking.authorization;
    return (
      <Screen>
        <Stack.Screen options={{ title: "Booking confirmed" }} />
        <ScrollView contentContainerStyle={styles.confirm}>
          <Ionicons name="checkmark-circle" size={64} color={colors.neon} />
          <Text style={styles.confirmTitle}>Booking confirmed</Text>
          <Text style={type.dim}>{name}</Text>
          <Surface style={styles.confirmCard}>
            <SummaryRow k="Booking ID" v={booking.id} />
            <SummaryRow k="Reference" v={booking.reference} />
            <SummaryRow k="Paid" v={usd(booking.amountUsd)} bold />
            <SummaryRow k="Route" v={auth.route === "travala" ? "x402 · USDC on Base" : "Visa VCN"} />
            {auth.x402 && <SummaryRow k="Settlement" v={`${auth.x402.network} · ${auth.x402.proof.slice(0, 14)}…`} />}
            {auth.card && <SummaryRow k="Card" v={`•••• ${auth.card.last4}`} />}
            <SummaryRow k="Cashback earned" v={`${usd(auth.cashbackUsd)} USDC`} />
          </Surface>
          <View style={styles.confirmButtons}>
            <Button
              title="View itinerary"
              onPress={() =>
                router.replace({ pathname: "/travel/trip/[id]", params: { id: booking.trip.id } })
              }
            />
            <Button title="Back to Travel" variant="secondary" onPress={() => router.replace("/travel")} />
          </View>
        </ScrollView>
      </Screen>
    );
  }

  // --- checkout ---------------------------------------------------------------
  const expired = lock === 0;
  return (
    <Screen>
      <Stack.Screen options={{ title: "Checkout" }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Surface style={styles.summary}>
          {img ? <Image source={{ uri: img }} style={styles.photo} /> : null}
          <View style={styles.summaryBody}>
            <Text style={styles.name}>{name}</Text>
            <Text style={type.dim}>
              {city} · {nights} nights · {GUESTS} adults
            </Text>
            <View style={styles.rows}>
              <SummaryRow k={`Room rate (${nights} nights)`} v={usd(roomRate)} />
              <SummaryRow k="Taxes & fees" v={usd(taxes)} />
              <SummaryRow k="FurlPay cashback (2%)" v={`−${usd(cashback)}`} />
              <SummaryRow k="Total" v={usd(total)} bold />
            </View>
            <Text style={styles.fx}>
              ≈ {total.toFixed(2)} USDC · {(total * TRAVEL_RATES.SOL).toFixed(2)} SOL ·{" "}
              {(total * TRAVEL_RATES.BTC).toFixed(5)} BTC
            </Text>
            <View style={[styles.lockNote, expired && styles.lockNoteExpired]}>
              <Ionicons name="lock-closed-outline" size={12} color={expired ? colors.warning : colors.textDim} />
              <Text style={[styles.lockText, expired && { color: colors.warning }]}>
                {expired ? "Rate lock expired — refresh to re-quote" : `Rate locked for ${mm}:${ss}`}
              </Text>
            </View>
          </View>
        </Surface>

        <Text style={styles.sectionTitle}>Payment method</Text>
        <View style={styles.methods} accessibilityRole="radiogroup">
          {METHODS.map((m) => (
            <MethodOption key={m.id} method={m} selected={m.id === methodId} onPress={() => setMethodId(m.id)} />
          ))}
        </View>

        <Pressable
          onPress={() => setAgree((a) => !a)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: agree }}
          style={styles.agree}
        >
          <Ionicons
            name={agree ? "checkbox" : "square-outline"}
            size={20}
            color={agree ? colors.neon : colors.textFaint}
          />
          <Text style={styles.agreeText}>I agree to the travel terms & cancellation policy</Text>
        </Pressable>

        <ErrorNote message={error} />
        <Text style={styles.secured}>Secured by FurlPay · Travel Rule & KYC enforced over $1,000</Text>
      </ScrollView>

      <View style={styles.footer}>
        <View>
          <Text style={styles.footerTotal}>{usd(total)}</Text>
          <Text style={type.dim}>incl. taxes, after cashback</Text>
        </View>
        <Button
          title={expired ? "Refresh rate" : busy ? "Authorizing…" : `Pay ${usd(total)}`}
          onPress={expired ? () => setLock(RATE_LOCK_SECONDS) : pay}
          disabled={busy || (!expired && !agree)}
          loading={busy}
          style={{ paddingHorizontal: spacing.xl }}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },

  summary: { padding: 0, overflow: "hidden" },
  photo: { width: "100%", height: 140, backgroundColor: colors.surfaceRaised },
  summaryBody: { padding: spacing.md, gap: spacing.xs },
  name: { ...type.body, fontSize: 17, fontWeight: "700" },
  rows: { marginTop: spacing.sm, gap: 6, borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.sm },
  fx: { ...type.dim, fontSize: 11, textAlign: "right" },
  lockNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: spacing.xs,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.sm,
  },
  lockNoteExpired: { backgroundColor: "#2A1F0A" },
  lockText: { ...type.dim, fontSize: 11 },

  sectionTitle: { ...type.h2, fontSize: 17 },
  methods: { gap: spacing.sm },
  method: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
  },
  methodSelected: { borderColor: colors.neon, backgroundColor: colors.neonSoft },
  methodIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceRaised,
  },
  methodIconSelected: { backgroundColor: "#0F3A2C" },
  methodTitle: { ...type.body, fontWeight: "600" },
  methodSub: { ...type.dim, fontSize: 11 },
  x402: {
    color: colors.neon,
    fontSize: 10,
    fontWeight: "700",
    backgroundColor: colors.neonSoft,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radius.sm,
    overflow: "hidden",
  },

  agree: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xs },
  agreeText: { ...type.dim, fontSize: 12, flex: 1 },
  secured: { ...type.dim, fontSize: 11, textAlign: "center" },

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

  confirm: { alignItems: "center", padding: spacing.lg, gap: spacing.sm, paddingTop: spacing.xl },
  confirmTitle: { ...type.title, fontSize: 22, marginTop: spacing.xs },
  confirmCard: { alignSelf: "stretch", gap: 6, marginTop: spacing.md },
  confirmButtons: { alignSelf: "stretch", gap: spacing.sm, marginTop: spacing.md },
});
