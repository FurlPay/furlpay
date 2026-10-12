import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  Animated,
  PanResponder,
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
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError, NetworkError } from "@/lib/api";
import { OFFLINE_MUTATION_MESSAGE, useIsOffline } from "@/lib/net";
import { useCards } from "@/lib/queries";
import { usd } from "@/lib/format";
import { colors, radius, spacing, type } from "@/lib/theme";
import { Button, EmptyState, ErrorNote, Screen, Surface } from "@/components/ui";
import { useTheme } from "@/lib/design/theme";
import { AddMoneySheet } from "@/components/AddMoneySheet";
import { CardDetailsReveal } from "@/components/cards/CardDetailsReveal";
import { CardFrontContent, CardSurface } from "@/components/cards/CardArt";
import { designFor } from "@/lib/cards/designs";
import type { PaymentCard } from "@/lib/types";

/** Maximum tilt, in degrees, at the far edge of the card. Small on purpose:
 *  past about 8deg the text starts to read as skewed rather than as a card
 *  catching the light, and a payment card that looks distorted looks broken. */
const MAX_TILT_DEG = 6;

/**
 * The card face, with a touch-driven parallax tilt.
 *
 * DRIVEN BY TOUCH, NOT THE GYROSCOPE. Device-motion tilt needs `expo-sensors`,
 * which is not a dependency of this project, and a motion-driven card inside a
 * horizontally-paging FlatList fights the carousel: every swipe rotates the
 * neighbour you are swiping toward. Touch keeps the effect intentional — it
 * happens because the user put a finger on the card — and costs no new
 * dependency, no motion permission, and nothing on a device without sensors.
 *
 * Built on the core Animated API rather than Reanimated (also absent).
 * `useNativeDriver` is on for every transform, so the tilt runs on the UI
 * thread and does not compete with the carousel for the JS thread.
 *
 * REDUCED MOTION IS HONOURED, and not by animating to zero: with it on the pan
 * responder is never attached at all, so the card is a plain static face and
 * the FlatList keeps every touch for paging.
 */
function CardVisual({ card }: { card: PaymentCard }) {
  const [c1, c2] = card.gradient ?? [colors.surfaceRaised, colors.surface];
  const design = designFor({ gradient: card.gradient });
  const { reduceMotion } = useTheme();

  // -1..1 per axis, derived from where the finger is within the card.
  const tiltX = useRef(new Animated.Value(0)).current;
  const tiltY = useRef(new Animated.Value(0)).current;
  const [size, setSize] = useState({ w: 0, h: 0 });

  const settle = useCallback(() => {
    Animated.parallel([
      Animated.spring(tiltX, { toValue: 0, useNativeDriver: true, friction: 6, tension: 60 }),
      Animated.spring(tiltY, { toValue: 0, useNativeDriver: true, friction: 6, tension: 60 }),
    ]).start();
  }, [tiltX, tiltY]);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        // Vertical intent only. A mostly-horizontal drag is the carousel
        // paging, and claiming it here would break swiping between cards.
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderMove: (e) => {
          if (!size.w || !size.h) return;
          const { locationX, locationY } = e.nativeEvent;
          // Centre-relative and clamped: a finger sliding off the edge is
          // still tracked, and must not tilt the card past the maximum.
          tiltX.setValue(Math.max(-1, Math.min(1, (locationY / size.h) * 2 - 1)));
          tiltY.setValue(Math.max(-1, Math.min(1, (locationX / size.w) * 2 - 1)));
        },
        onPanResponderRelease: settle,
        onPanResponderTerminate: settle,
      }),
    [size.w, size.h, tiltX, tiltY, settle]
  );

  const deg = (v: Animated.Value, invert = false) =>
    v.interpolate({
      inputRange: [-1, 1],
      outputRange: invert
        ? [`${MAX_TILT_DEG}deg`, `-${MAX_TILT_DEG}deg`]
        : [`-${MAX_TILT_DEG}deg`, `${MAX_TILT_DEG}deg`],
    });

  const animatedStyle = reduceMotion
    ? null
    : {
        transform: [
          { perspective: 900 },
          // Touching the TOP tips the top away from the viewer, so rotateX is
          // inverted relative to the raw Y position.
          { rotateX: deg(tiltX, true) },
          { rotateY: deg(tiltY) },
        ],
      };

  // The highlight travels OPPOSITE to the tilt, which is how a reflection
  // behaves — it stays where the light is, not where the card is. Opacity
  // rises with tilt, so a card at rest carries no glare at all.
  const specularStyle = reduceMotion
    ? null
    : {
        opacity: tiltY.interpolate({ inputRange: [-1, 0, 1], outputRange: [0.45, 0, 0.45] }),
        transform: [
          {
            translateX: tiltY.interpolate({
              inputRange: [-1, 1],
              outputRange: [size.w || 0, -(size.w || 0)],
            }),
          },
          { rotate: "18deg" },
        ],
      };

  return (
    <Animated.View
      style={[styles.cardShadow, animatedStyle]}
      onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      {...(reduceMotion ? {} : responder.panHandlers)}
    >
      {design ? (
        <CardSurface design={design} style={styles.card}>
          {reduceMotion ? null : (
            <Animated.View pointerEvents="none" style={[styles.specular, specularStyle]} />
          )}
          <CardFrontContent
            design={design}
            label={card.label}
            kind={card.kind}
            last4={card.last4}
            network={card.network}
            settlementCurrency={card.settlementCurrency}
          />
          {card.frozen ? (
            <View style={styles.frozenOverlay}>
              <View style={styles.frozenPill}>
                <Text style={{ color: colors.text, fontWeight: "700", fontSize: 13 }}>Frozen</Text>
              </View>
            </View>
          ) : null}
        </CardSurface>
      ) : (
      <LinearGradient
        colors={[c1, c2]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.card}
      >
        {reduceMotion ? null : (
          <Animated.View pointerEvents="none" style={[styles.specular, specularStyle]} />
        )}
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
      )}
    </Animated.View>
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
      {/* The dim behind a sheet dismisses it. Screen readers otherwise see a
          full-screen unlabelled control and read it before the content. */}
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close"
      />
      <View style={styles.sheet}>
        <View style={styles.controlRow}>
          <Text style={type.h2}>{title}</Text>
          <Pressable
            onPress={onClose}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Text style={{ color: colors.textDim, fontSize: 20 }}>✕</Text>
          </Pressable>
        </View>
        {children}
      </View>
    </Modal>
  );
}

/** Device-owner-gated card details.
 *
 *  NO CARD DIGITS ARE CONSTRUCTED ON THE DEVICE. This modal used to render a
 *  hardcoded "4111 5522 8834 {last4}", expiry "09 / 29" and CVV "284" after
 *  authentication — a card number the phone assembled itself, never asked the
 *  server for, and showed under a "Demo" banner a user could miss or ignore.
 *  Real details come only from the issuer's PCI vault in exchange for a
 *  server-minted grant (lib/cards/lifecycle.ts `mintRevealGrant`). That vault
 *  exchange does not exist yet, so after authentication the modal shows what
 *  is genuinely known — the masked number and network — and says why the rest
 *  is unavailable. The device-owner gate stays so the flow is ready the day
 *  the vault is.
 *
 *  Deliberately NOT routed through confirmWithBiometrics: revealing PAN/CVV is
 *  sensitive-data ACCESS, not an action approval, so it stays gated even when
 *  the user turns "Biometric approvals" off (the same norm as Google Wallet). */
function DetailsModal({ card, onClose }: { card: PaymentCard; onClose: () => void }) {
  return (
    <SheetModal title="Card details" visible onClose={onClose}>
      <View style={{ paddingVertical: spacing.sm }}>
        <CardDetailsReveal card={card} />
      </View>
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
          accessibilityRole="button"
          accessibilityLabel="Decrease"
          style={styles.stepBtn}
        >
          <Text style={styles.stepText}>−</Text>
        </Pressable>
        <View style={[styles.meter, { flex: 1 }]}>
          <View style={[styles.meterFill, { width: `${Math.min(100, (value / max) * 100)}%` }]} />
        </View>
        <Pressable
          onPress={() => onChange(Math.min(max, value + step))}
          style={styles.stepBtn}
          accessibilityRole="button"
          accessibilityLabel="Increase"
        >
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
  const [addMoneyOpen, setAddMoneyOpen] = useState(false);
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
      {/* Funding leads, and is the only PRIMARY button here.

          A card in this app has no balance of its own — PaymentCard carries
          `settlementCurrency`, not an amount — so topping up a card is
          funding the account it settles from. That is exactly what the home
          screen's "Add money" does, so this opens the SAME shared sheet
          (components/AddMoneySheet) rather than a card-specific flow. A
          second funding surface would be a second place to add a rail to,
          and the one we forgot would be found by a user first.

          It is deliberately NOT disabled while offline. Every other control
          on this screen mutates server state and is correctly disabled, but
          this one only opens a sheet showing a deposit address and bank
          details — useful precisely when the connection is poor, and the
          sheet reports its own loading and error states. */}
      <Button
        title="Add money"
        onPress={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          setAddMoneyOpen(true);
        }}
        style={{ paddingVertical: 12 }}
      />
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
      <AddMoneySheet open={addMoneyOpen} onClose={() => setAddMoneyOpen(false)} />
    </Surface>
  );
}

const PAGE_W = Dimensions.get("window").width;
const CARD_W = PAGE_W - spacing.md * 2;

export default function Cards() {
  const router = useRouter();
  const { data: result, isLoading, refetch, isRefetching, error } = useCards();
  const cards = result?.data ?? [];
  const [active, setActive] = useState(0);
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
              subtitle={
                error
                  ? "Your cards are unchanged — this device just couldn't reach the server."
                  : "A virtual card is issued instantly and free. A physical one ships in 7–14 days."
              }
            />
            {!isLoading && !error ? (
              <Button title="Order a card" onPress={() => router.push("/cards/order")} />
            ) : null}
            {error ? <Button title="Try again" variant="secondary" onPress={() => void refetch()} /> : null}
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
            {/* Everything beyond the day-to-day controls — activation, PIN,
                design, device wallets, loss, replacement — lives on the card's
                own screen. Keeping it off the carousel means the tab stays the
                place you freeze a card in three seconds. */}
            {activeCard ? (
              <Button
                title="Manage this card"
                variant="secondary"
                onPress={() => router.push(`/cards/${activeCard.id}`)}
                icon={<Ionicons name="settings-outline" size={16} color={colors.text} />}
              />
            ) : null}
            <Button
              title="Order another card"
              variant="outline"
              onPress={() => router.push("/cards/order")}
            />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xl },
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
  // The moving highlight. Tall and narrow, rotated, and translated across the
  // face — a band of light rather than a glow, which is what reads as a
  // reflection on a physical card.
  specular: {
    position: "absolute",
    top: -80,
    bottom: -80,
    width: 70,
    left: "50%",
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  // Frozen: frosted rather than merely dimmed.
  //
  // expo-blur is NOT a dependency here, so a true backdrop blur is not
  // available without adding one. A white scrim at low alpha over the
  // gradient gives the same read — the colour desaturates and lifts toward
  // white, the way frosted glass behaves — where the old flat black scrim
  // just made the card look switched off.
  frozenOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(226,240,255,0.42)",
    alignItems: "center",
    justifyContent: "center",
  },
  frozenPill: {
    // Dark on the light frosted scrim — the old translucent white pill is
    // invisible against it.
    backgroundColor: "rgba(0,0,0,0.55)",
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
