import React, { useRef, useState } from "react";
import {
  Dimensions,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import * as LocalAuthentication from "expo-local-authentication";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError, NetworkError } from "@/lib/api";
import { confirmWithBiometrics } from "@/lib/biometrics";
import { OFFLINE_MUTATION_MESSAGE, useIsOffline } from "@/lib/net";
import { useCards } from "@/lib/queries";
import { usd } from "@/lib/format";
import { colors, radius, spacing, type } from "@/lib/theme";
import { Button, EmptyState, ErrorNote, Screen, Surface } from "@/components/ui";
import { useSecureScreen } from "@/lib/secureScreen";
import type { PaymentCard } from "@/lib/types";

function CardVisual({ card }: { card: PaymentCard }) {
  const [c1, c2] = card.gradient ?? [colors.surfaceRaised, colors.surface];
  return (
    <View style={styles.cardShadow}>
      <LinearGradient
        colors={[c1, c2]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.card}
      >
        <View style={styles.cardTop}>
          <View>
            <Text style={[type.body, { fontWeight: "700" }]}>{card.label}</Text>
            <Text style={[type.dim, { textTransform: "uppercase", letterSpacing: 1, fontSize: 11 }]}>
              {card.kind === "physical" ? "Physical" : "Virtual"}
            </Text>
          </View>
          <Text style={[type.body, { fontWeight: "800", fontStyle: "italic", fontSize: 18 }]}>
            {card.network}
          </Text>
        </View>
        <View style={styles.chip} />
        <View style={styles.cardTop}>
          <Text style={styles.pan}>•••• {card.last4}</Text>
          <Text style={type.dim}>{card.settlementCurrency}</Text>
        </View>
        {card.frozen ? (
          <View style={styles.frozenOverlay}>
            <View style={styles.frozenPill}>
              <Text style={{ color: colors.text, fontWeight: "700", fontSize: 13 }}>Frozen</Text>
            </View>
          </View>
        ) : null}
      </LinearGradient>
    </View>
  );
}

/** Post a partial settings change and refresh the cards query.
 *
 *  Card controls are never queued offline: a freeze that "succeeds" into an
 *  outbox would render the card as frozen while it is still live and spendable.
 *  Offline, this fails with a message that says so. */
function useCardSettings() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const save = async (body: Record<string, unknown>) => {
    setError(null);
    try {
      await api("/cards/settings", { method: "POST", body });
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await qc.invalidateQueries({ queryKey: ["cards"] });
      return true;
    } catch (e) {
      if (e instanceof NetworkError) setError(OFFLINE_MUTATION_MESSAGE);
      else setError(e instanceof ApiError ? e.message : (e as Error).message);
      return false;
    }
  };
  return { save, error, setError };
}

function SheetModal({
  title,
  visible,
  onClose,
  children,
}: {
  title: string;
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.controlRow}>
          <Text style={type.h2}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={8}>
            <Text style={{ color: colors.textDim, fontSize: 20 }}>✕</Text>
          </Pressable>
        </View>
        {children}
      </View>
    </Modal>
  );
}

/** Biometric-gated card details — same demo PAN/CVV values as the web's
 *  ViewModal, but behind a REAL device biometric prompt instead of a
 *  simulated one.
 *
 *  Deliberately NOT routed through confirmWithBiometrics: revealing PAN/CVV is
 *  sensitive-data ACCESS, not an action approval, so it stays gated even when
 *  the user turns "Biometric approvals" off (the same norm as Google Wallet). */
function DetailsModal({ card, onClose }: { card: PaymentCard; onClose: () => void }) {
  const [authed, setAuthed] = useState(false);
  const [failed, setFailed] = useState(false);
  // Card PAN/CVV must not land in a screenshot or the recents thumbnail.
  useSecureScreen("card-details");

  const authenticate = async () => {
    const enrolled =
      (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
    if (!enrolled) {
      setAuthed(true);
      return;
    }
    const res = await LocalAuthentication.authenticateAsync({
      promptMessage: "Reveal full card details",
    });
    if (res.success) setAuthed(true);
    else setFailed(true);
  };

  return (
    <SheetModal title="Card details" visible onClose={onClose}>
      {!authed ? (
        <View style={{ gap: spacing.md, paddingVertical: spacing.md }}>
          <Text style={[type.dim, { textAlign: "center" }]}>
            {failed
              ? "Authentication failed — try again."
              : "Revealing full card details requires your fingerprint or face."}
          </Text>
          <Button title="Authenticate to reveal" onPress={() => void authenticate()} />
        </View>
      ) : (
        <View style={{ gap: spacing.sm, paddingVertical: spacing.sm }}>
          <View style={styles.detailField}>
            <Text style={type.dim}>Card number</Text>
            <Text style={styles.detailMono}>4111 5522 8834 {card.last4}</Text>
          </View>
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <View style={[styles.detailField, { flex: 1 }]}>
              <Text style={type.dim}>Expiry</Text>
              <Text style={styles.detailMono}>09 / 29</Text>
            </View>
            <View style={[styles.detailField, { flex: 1 }]}>
              <Text style={type.dim}>CVV</Text>
              <Text style={styles.detailMono}>284</Text>
            </View>
          </View>
          <View style={styles.detailField}>
            <Text style={type.dim}>Network</Text>
            <Text style={type.body}>{card.network}</Text>
          </View>
        </View>
      )}
    </SheetModal>
  );
}

function Stepper({
  label,
  value,
  step,
  max,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <View style={{ gap: 6 }}>
      <View style={styles.controlRow}>
        <Text style={type.body}>{label}</Text>
        <Text style={[type.body, { fontWeight: "700" }]}>{usd(value)}</Text>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <Pressable
          onPress={() => onChange(Math.max(step, value - step))}
          style={styles.stepBtn}
        >
          <Text style={styles.stepText}>−</Text>
        </Pressable>
        <View style={[styles.meter, { flex: 1 }]}>
          <View style={[styles.meterFill, { width: `${Math.min(100, (value / max) * 100)}%` }]} />
        </View>
        <Pressable onPress={() => onChange(Math.min(max, value + step))} style={styles.stepBtn}>
          <Text style={styles.stepText}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

function LimitsModal({ card, onClose }: { card: PaymentCard; onClose: () => void }) {
  const { save, error } = useCardSettings();
  const [perPurchase, setPerPurchase] = useState(card.limits.perPurchase);
  const [daily, setDaily] = useState(card.limits.daily);
  const [busy, setBusy] = useState(false);

  return (
    <SheetModal title="Spending limits" visible onClose={onClose}>
      <View style={{ gap: spacing.md, paddingVertical: spacing.sm }}>
        <Stepper label="Per-purchase limit" value={perPurchase} step={250} max={10_000} onChange={setPerPurchase} />
        <Stepper label="Daily limit" value={daily} step={500} max={20_000} onChange={setDaily} />
        <ErrorNote message={error} />
        <Button
          title="Save limits"
          loading={busy}
          onPress={() => {
            setBusy(true);
            void save({ cardId: card.id, limits: { perPurchase, daily } }).then((ok) => {
              setBusy(false);
              if (ok) onClose();
            });
          }}
        />
      </View>
    </SheetModal>
  );
}

function CardControls({ card }: { card: PaymentCard }) {
  const { save, error } = useCardSettings();
  const [pendingFrozen, setPendingFrozen] = useState<boolean | null>(null);
  const [modal, setModal] = useState<"details" | "limits" | null>(null);
  // Card controls are server-authoritative and must not be queued (see
  // useCardSettings) — so offline they're disabled rather than silently no-op.
  const offline = useIsOffline();

  const frozen = pendingFrozen ?? card.frozen;
  const spentPct = card.limits.daily > 0 ? Math.min(1, card.limits.dailySpent / card.limits.daily) : 0;

  const toggleFreeze = async (value: boolean) => {
    setPendingFrozen(value);
    const ok = await save({ cardId: card.id, freeze: value });
    if (!ok) setPendingFrozen(null);
  };

  const toggleChannel = (channel: "online" | "offline" | "atm", value: boolean) =>
    void save({ cardId: card.id, channels: { [channel]: value } });

  return (
    <Surface style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <Button
          title="View details"
          variant="secondary"
          onPress={() => setModal("details")}
          style={{ flex: 1, paddingVertical: 10 }}
        />
        <Button
          title="Limits"
          variant="secondary"
          onPress={() => setModal("limits")}
          style={{ flex: 1, paddingVertical: 10 }}
        />
      </View>

      <View style={styles.controlRow}>
        <Text style={type.body}>Freeze card</Text>
        <Switch
          value={frozen}
          disabled={offline}
          onValueChange={(v) => void toggleFreeze(v)}
          trackColor={{ true: colors.neonDeep, false: colors.surfaceRaised }}
          thumbColor={frozen ? colors.neon : colors.textDim}
        />
      </View>
      {offline ? <Text style={type.dim}>{OFFLINE_MUTATION_MESSAGE}</Text> : null}

      <View style={{ gap: 6 }}>
        <View style={styles.controlRow}>
          <Text style={type.dim}>Daily spend</Text>
          <Text style={type.dim}>
            {usd(card.limits.dailySpent)} / {usd(card.limits.daily)}
          </Text>
        </View>
        <View style={styles.meter}>
          <View style={[styles.meterFill, { width: `${spentPct * 100}%` }]} />
        </View>
        <Text style={type.dim}>Per-purchase limit {usd(card.limits.perPurchase)}</Text>
      </View>

      {(["online", "offline", "atm"] as const).map((ch) => (
        <View key={ch} style={styles.controlRow}>
          <Text style={type.dim}>
            {ch === "online" ? "Online payments" : ch === "offline" ? "In-store payments" : "ATM withdrawals"}
          </Text>
          <Switch
            value={card.channels[ch]}
            disabled={offline}
            onValueChange={(v) => toggleChannel(ch, v)}
            trackColor={{ true: colors.neonDeep, false: colors.surfaceRaised }}
            thumbColor={card.channels[ch] ? colors.neon : colors.textDim}
          />
        </View>
      ))}

      <ErrorNote message={error} />
      {modal === "details" ? <DetailsModal card={card} onClose={() => setModal(null)} /> : null}
      {modal === "limits" ? <LimitsModal card={card} onClose={() => setModal(null)} /> : null}
    </Surface>
  );
}

/** Issue a new card — POST /api/cards. The server enforces verified KYC;
 *  biometrics gate the request like every other account mutation. */
function CreateCardModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<"virtual" | "physical">("virtual");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setError(null);
    if (!(await confirmWithBiometrics(`Issue a new ${kind} card`))) return;
    setBusy(true);
    try {
      const res = await api<{ cardId: string; last4: string }>("/cards", {
        method: "POST",
        body: { cardType: kind, kycToken: "session-kyc-attested" },
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await qc.invalidateQueries({ queryKey: ["cards"] });
      onClose();
      void res;
    } catch (e) {
      if (e instanceof NetworkError) setError(OFFLINE_MUTATION_MESSAGE);
      else if (e instanceof ApiError && e.status === 403) {
        setError("Card issuance needs a verified identity — finish KYC in Profile first.");
      } else setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SheetModal title="New card" visible onClose={onClose}>
      <View style={{ gap: spacing.md, paddingBottom: spacing.md }}>
        {(["virtual", "physical"] as const).map((k) => (
          <Pressable
            key={k}
            onPress={() => setKind(k)}
            style={[styles.kindOption, kind === k && { borderColor: colors.neon }]}
          >
            <Text style={[type.body, { fontWeight: "700" }]}>
              {k === "virtual" ? "Virtual card" : "Physical card"}
            </Text>
            <Text style={type.dim}>
              {k === "virtual"
                ? "Instant. Online payments and subscriptions."
                : "Shipped to you. In-store and ATM enabled."}
            </Text>
          </Pressable>
        ))}
        <Button title={`Issue ${kind} card`} loading={busy} onPress={() => void create()} />
        <ErrorNote message={error} />
      </View>
    </SheetModal>
  );
}

const PAGE_W = Dimensions.get("window").width;
const CARD_W = PAGE_W - spacing.md * 2;

export default function Cards() {
  const router = useRouter();
  const { data: result, isLoading, refetch, isRefetching, error } = useCards();
  const cards = result?.data ?? [];
  const [active, setActive] = useState(0);
  const [creating, setCreating] = useState(false);
  const listRef = useRef<FlatList<PaymentCard>>(null);

  const activeCard = cards[Math.min(active, Math.max(0, cards.length - 1))];

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={colors.neon} />
        }
      >
        <Button
          title="Pending approvals (3-D Secure)"
          variant="secondary"
          onPress={() => router.push("/approvals")}
        />
        {cards.length === 0 ? (
          <>
            <EmptyState
              title={isLoading ? "Loading…" : error ? "Couldn't load cards" : "No cards yet"}
              subtitle={error ? (error as Error).message : "Issue your first card below — virtual cards are instant."}
            />
            {!isLoading && !error ? <Button title="New card" onPress={() => setCreating(true)} /> : null}
          </>
        ) : (
          <>
            {/* Swipable card carousel */}
            <FlatList
              ref={listRef}
              data={cards}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              keyExtractor={(c) => c.id}
              snapToInterval={CARD_W + spacing.sm}
              decelerationRate="fast"
              onMomentumScrollEnd={(e) =>
                setActive(Math.round(e.nativeEvent.contentOffset.x / (CARD_W + spacing.sm)))
              }
              renderItem={({ item }) => (
                <View style={{ width: CARD_W, marginRight: spacing.sm }}>
                  <CardVisual card={item} />
                </View>
              )}
            />
            {/* Dot indicators */}
            {cards.length > 1 ? (
              <View style={styles.dots}>
                {cards.map((c, i) => (
                  <View key={c.id} style={[styles.dot, i === active && styles.dotActive]} />
                ))}
              </View>
            ) : null}
            {activeCard ? <CardControls key={activeCard.id} card={activeCard} /> : null}
            <Button title="New card" variant="secondary" onPress={() => setCreating(true)} />
          </>
        )}
      </ScrollView>
      {creating ? <CreateCardModal onClose={() => setCreating(false)} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xl },
  kindOption: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 4,
  },
  cardShadow: {
    borderRadius: radius.lg,
    // Android elevation needs a backgroundColor on the same view to render.
    backgroundColor: colors.bg,
    elevation: 12,
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
  },
  card: {
    aspectRatio: 1.586, // real credit-card proportion
    borderRadius: radius.lg,
    padding: spacing.lg,
    justifyContent: "space-between",
    overflow: "hidden",
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chip: {
    width: 42,
    height: 30,
    borderRadius: 6,
    backgroundColor: "rgba(255,255,255,0.25)",
  },
  frozenOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  frozenPill: {
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: radius.pill,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  pan: { color: colors.text, fontSize: 22, letterSpacing: 3, fontFamily: "monospace" },
  controlRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  meter: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    overflow: "hidden",
  },
  meterFill: { height: "100%", backgroundColor: colors.neon },
  dots: { flexDirection: "row", justifyContent: "center", gap: 6 },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.25)",
  },
  dotActive: { width: 20, backgroundColor: colors.neon },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
  },
  detailField: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.sm,
    padding: spacing.sm,
    gap: 2,
  },
  detailMono: { color: colors.text, fontFamily: "monospace", fontSize: 16, letterSpacing: 1 },
  stepBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  stepText: { color: colors.neon, fontSize: 20, fontWeight: "700" },
});
