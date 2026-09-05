import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { CardFacePreview, StatusChip } from "@/components/cards/CardFace";
import { ShippingForm, isShippingComplete, type ShippingDraft } from "@/components/cards/ShippingForm";
import { Button, EmptyState, ErrorNote, Field, Screen } from "@/components/ui";
import { authorizeMoneyMove } from "@/lib/money/authorize";
import { cardErrorMessage, useCardProducts, useOrderCard } from "@/lib/cards/useCardLifecycle";
import { blockReasonText, type CardProduct, type CardTheme } from "@/lib/cards/lifecycle";
import { usd } from "@/lib/format";
import { OFFLINE_MUTATION_MESSAGE, useIsOffline } from "@/lib/net";
import { useSecureScreen } from "@/lib/secureScreen";
import { colors, radius, spacing, type } from "@/lib/theme";

// ---------------------------------------------------------------------------
// Order a card.
//
// REPLACES a modal that POSTed { cardType, kycToken: "session-kyc-attested" }
// to the legacy /api/cards. That path mints a card with a hardcoded label, no
// product, no theme, no shipping address and no lifecycle record — and it sent
// no Idempotency-Key, so a retry after a timeout issued a second card. The
// route it now uses, /api/cards/order, does all of that properly.
//
// WHY THE REFUSAL REASONS ARE ON THE PRODUCT ROWS. GET /cards/products returns
// `available` and `reasons` per product precisely so the UI can say
// "Metal — available on the Pro plan" in the list. Letting someone select a
// product and then rejecting them at submit is the same information delivered
// after wasting their time, and it reads as a bug rather than a rule.
//
// THE FEE IS STATED BEFORE THE CONFIRM, ALWAYS. Two of the three products cost
// money. An order screen that reveals a charge only in the receipt is the
// pattern financial apps get complained about for, and the biometric prompt
// itself names the amount so the thing being approved is unambiguous.
// ---------------------------------------------------------------------------

const DEFAULT_THEME = "midnight";

export default function OrderCard() {
  // Carries a home delivery address.
  useSecureScreen("card-order");
  const router = useRouter();
  const offline = useIsOffline();
  const { products, themes, isLoading, loaded, error, refetch } = useCardProducts();
  const order = useOrderCard();

  const [productId, setProductId] = useState<string | null>(null);
  const [themeId, setThemeId] = useState<string>(DEFAULT_THEME);
  const [label, setLabel] = useState("");
  const [shipping, setShipping] = useState<ShippingDraft>({
    name: "",
    line1: "",
    line2: "",
    city: "",
    postcode: "",
    country: "",
  });
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<{ cardId: string; physical: boolean; feeUsd: number } | null>(
    null
  );

  // Pre-select the first orderable product so the screen is never a list of
  // things with nothing chosen — but never an unavailable one, which would
  // start the user on a dead end.
  useEffect(() => {
    if (productId || products.length === 0) return;
    const first = products.find((p) => p.available);
    if (first) setProductId(first.id);
  }, [products, productId]);

  const product = products.find((p) => p.id === productId) ?? null;
  const theme = themes.find((t) => t.id === themeId) ?? themes[0];

  // A premium design on a Standard plan is rejected at order time, so the
  // selection is corrected as soon as the catalogue says it is locked rather
  // than at submit.
  useEffect(() => {
    if (theme?.locked) setThemeId(DEFAULT_THEME);
  }, [theme?.locked]);

  /**
   * Idempotency key, stable for a given order.
   *
   * Ordering charges a fee and mints a card. A retry after a timeout MUST
   * replay rather than issue a second card, so the key is tied to the payload —
   * changing the product, design or name is a different order and earns a new
   * one.
   */
  const idem = useRef<{ fingerprint: string; key: string } | null>(null);
  const idempotencyKeyFor = (fingerprint: string): string => {
    if (idem.current?.fingerprint !== fingerprint) {
      idem.current = { fingerprint, key: crypto.randomUUID() };
    }
    return idem.current.key;
  };

  const needsShipping = product?.shipsPhysically === true;
  const shippingReady = !needsShipping || isShippingComplete(shipping);
  const labelReady = label.trim().length > 0 && label.trim().length <= 24;

  const blockedReason = useMemo(() => {
    if (offline) return OFFLINE_MUTATION_MESSAGE;
    if (!product) return "Choose a card to order.";
    if (!product.available) {
      return product.reasons.map((r) => blockReasonText(r, product.minTier)).join(" ");
    }
    if (!labelReady) return "Give the card a name, up to 24 characters.";
    if (!shippingReady) return "Add a delivery address.";
    return null;
  }, [offline, product, labelReady, shippingReady]);

  const submit = async () => {
    if (!product || blockedReason) return;
    setSubmitError(null);

    const fee = product.feeUsd;
    const decision = await authorizeMoneyMove({
      action: "create_card",
      amountUsd: fee,
      reason:
        fee > 0
          ? `Order the ${product.name} card for ${usd(fee)}`
          : `Order the ${product.name} card`,
    });
    if (!decision.ok) {
      if (decision.kind !== "declined") setSubmitError(decision.message);
      return;
    }

    const fingerprint = `${product.id}|${themeId}|${label.trim()}|${
      needsShipping ? JSON.stringify(shipping) : ""
    }`;

    try {
      const result = await order.mutateAsync({
        productId: product.id,
        label: label.trim(),
        themeId,
        ...(needsShipping
          ? {
              shipping: {
                name: shipping.name.trim(),
                line1: shipping.line1.trim(),
                ...(shipping.line2.trim() ? { line2: shipping.line2.trim() } : {}),
                city: shipping.city.trim(),
                postcode: shipping.postcode.trim(),
                country: shipping.country.trim().toUpperCase(),
              },
            }
          : {}),
        idempotencyKey: idempotencyKeyFor(fingerprint),
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // This order is finished — a subsequent order is a new one even with
      // identical details.
      idem.current = null;
      setPlaced({
        cardId: result.lifecycle.cardId,
        physical: result.lifecycle.product.kind === "physical",
        feeUsd: result.feeUsd,
      });
    } catch (e) {
      setSubmitError(cardErrorMessage(e));
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  // ── receipt ──────────────────────────────────────────────────────────────
  if (placed) {
    return (
      <Screen>
        <ScrollView contentContainerStyle={styles.receipt}>
          <View style={styles.tick}>
            <Ionicons name="checkmark" size={38} color={colors.onNeon} />
          </View>
          <Text style={type.h2}>{placed.physical ? "Card ordered" : "Card issued"}</Text>
          {/* What happens NEXT, not merely that something happened. The two
              product kinds have genuinely different next steps and saying so
              here is what stops a support ticket a week later. */}
          <Text style={[type.dim, { textAlign: "center" }]}>
            {placed.physical
              ? "We'll let you know when it ships. It arrives frozen — enter the 8-digit code on the carrier to start spending."
              : "It's ready to use now. Add it to Google Pay from the card screen, or reveal the details for online payments."}
          </Text>
          {placed.feeUsd > 0 ? (
            <Text style={type.dim}>Issuance fee {usd(placed.feeUsd)}</Text>
          ) : null}
          <Button
            title="Open the card"
            onPress={() => router.replace(`/cards/${placed.cardId}`)}
            style={{ alignSelf: "stretch" }}
          />
          <Button title="Done" variant="secondary" onPress={() => router.back()} style={{ alignSelf: "stretch" }} />
        </ScrollView>
      </Screen>
    );
  }

  // ── catalogue could not load ─────────────────────────────────────────────
  if (error && !loaded) {
    return (
      <Screen>
        <View style={styles.centered}>
          <EmptyState
            title="Couldn't load the card options"
            subtitle="Nothing has been ordered or charged. Check your connection and try again."
          />
          <Button title="Try again" variant="secondary" onPress={() => void refetch()} />
        </View>
      </Screen>
    );
  }

  if (isLoading && !loaded) {
    return (
      <Screen>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.neon} />
        </View>
      </Screen>
    );
  }

  // ── composer ─────────────────────────────────────────────────────────────
  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.preview}>
          <CardFacePreview
            label={label}
            network={product?.network ?? "Visa"}
            kind={product?.kind ?? "virtual"}
            gradient={theme?.gradient ?? ["#0B1220", "#1E293B"]}
          />
        </View>

        <Section title="Card">
          {products.map((p) => (
            <ProductRow
              key={p.id}
              product={p}
              selected={p.id === productId}
              onPress={() => {
                void Haptics.selectionAsync();
                setProductId(p.id);
              }}
            />
          ))}
        </Section>

        <Section title="Design">
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.themes}
            keyboardShouldPersistTaps="handled"
          >
            {themes.map((t) => (
              <ThemeSwatch
                key={t.id}
                theme={t}
                selected={t.id === themeId}
                onPress={() => {
                  if (t.locked) return;
                  void Haptics.selectionAsync();
                  setThemeId(t.id);
                }}
              />
            ))}
          </ScrollView>
          {theme?.locked ? (
            <Text style={styles.note}>That design is available on Pro and above.</Text>
          ) : null}
        </Section>

        <Section title="Name">
          <Field
            value={label}
            onChangeText={setLabel}
            placeholder="Everyday, Travel, Subscriptions…"
            maxLength={24}
            accessibilityLabel="Card name"
          />
          <Text style={styles.note}>
            Only you see this. It&rsquo;s how you&rsquo;ll tell your cards apart.
          </Text>
        </Section>

        {needsShipping ? (
          <Section title="Delivery">
            <ShippingForm value={shipping} onChange={setShipping} />
          </Section>
        ) : null}

        {/* The charge, stated plainly and before the control that incurs it. */}
        <View style={styles.feeCard}>
          <View style={styles.feeRow}>
            <Text style={type.body}>Issuance fee</Text>
            <Text style={styles.feeValue}>
              {product ? (product.feeUsd > 0 ? usd(product.feeUsd) : "Free") : "—"}
            </Text>
          </View>
          {product?.shipsPhysically ? (
            <Text style={styles.note}>Delivery takes 7–14 days. Nothing ships until you confirm.</Text>
          ) : null}
        </View>

        <ErrorNote message={submitError} />

        <Button
          title={
            product && product.feeUsd > 0
              ? `Order for ${usd(product.feeUsd)}`
              : "Order card"
          }
          onPress={() => void submit()}
          disabled={!!blockedReason}
          loading={order.isPending}
        />
        {blockedReason ? (
          <Text style={styles.blocked} accessibilityLiveRegion="polite">
            {blockedReason}
          </Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={styles.sectionLabel}>{title.toUpperCase()}</Text>
      {children}
    </View>
  );
}

function ProductRow({
  product,
  selected,
  onPress,
}: {
  product: CardProduct;
  selected: boolean;
  onPress: () => void;
}) {
  const blocked = !product.available;
  return (
    <Pressable
      onPress={blocked ? undefined : onPress}
      disabled={blocked}
      style={({ pressed }) => [
        styles.product,
        selected && !blocked && { borderColor: colors.neon },
        pressed && !blocked && { borderColor: colors.neon },
        blocked && { opacity: 0.55 },
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled: blocked }}
      accessibilityLabel={`${product.name} card, ${
        product.feeUsd > 0 ? usd(product.feeUsd) : "free"
      }${blocked ? ". Not available: " + product.reasons.map((r) => blockReasonText(r, product.minTier)).join(" ") : ""}`}
    >
      <View style={styles.productHead}>
        <Text style={styles.productName}>{product.name}</Text>
        <Text style={styles.productFee}>{product.feeUsd > 0 ? usd(product.feeUsd) : "Free"}</Text>
      </View>
      <Text style={type.dim}>{product.description}</Text>
      {blocked ? (
        <View style={{ gap: 4, marginTop: 2 }}>
          {product.reasons.map((r) => (
            <View key={r} style={styles.reasonRow}>
              <Ionicons name="lock-closed-outline" size={13} color={colors.warning} />
              <Text style={styles.reason}>{blockReasonText(r, product.minTier)}</Text>
            </View>
          ))}
        </View>
      ) : selected ? (
        <StatusChip label="Selected" tone="good" />
      ) : null}
    </Pressable>
  );
}

function ThemeSwatch({
  theme,
  selected,
  onPress,
}: {
  theme: CardTheme;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={theme.locked}
      style={({ pressed }) => [
        styles.swatchWrap,
        (selected || pressed) && !theme.locked && { borderColor: colors.neon },
        theme.locked && { opacity: 0.45 },
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled: !!theme.locked }}
      accessibilityLabel={`${theme.name}${theme.locked ? ", requires Pro" : ""}`}
    >
      <View style={[styles.swatch, { backgroundColor: theme.gradient[0] }]}>
        <View style={[styles.swatchHalf, { backgroundColor: theme.gradient[1] }]} />
        {theme.locked ? (
          <View style={styles.swatchLock}>
            <Ionicons name="lock-closed" size={12} color="#FFFFFF" />
          </View>
        ) : null}
      </View>
      <Text style={styles.swatchName} numberOfLines={1}>
        {theme.name}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xl },
  centered: { flex: 1, justifyContent: "center", padding: spacing.md, gap: spacing.md },
  preview: { paddingVertical: spacing.sm },
  receipt: {
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.lg,
    flexGrow: 1,
  },
  tick: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: colors.neon,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionLabel: {
    color: colors.textFaint,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
  },
  product: {
    gap: 6,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  productHead: { flexDirection: "row", alignItems: "baseline", gap: spacing.sm },
  productName: { color: colors.text, fontSize: 16, fontWeight: "700", flex: 1 },
  productFee: { color: colors.text, fontSize: 15, fontWeight: "700" },
  reasonRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  reason: { color: colors.warning, fontSize: 12, flex: 1 },
  themes: { gap: spacing.sm, paddingRight: spacing.md },
  swatchWrap: {
    alignItems: "center",
    gap: 6,
    padding: 6,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "transparent",
    width: 78,
  },
  swatch: {
    width: 62,
    height: 42,
    borderRadius: radius.sm,
    overflow: "hidden",
    justifyContent: "flex-end",
  },
  swatchHalf: { height: 20, opacity: 0.9 },
  swatchLock: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  swatchName: { color: colors.textDim, fontSize: 11, fontWeight: "600" },
  feeCard: {
    gap: 6,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  feeRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  feeValue: { color: colors.text, fontSize: 17, fontWeight: "800" },
  note: { color: colors.textFaint, fontSize: 12 },
  blocked: { color: colors.textFaint, fontSize: 12, textAlign: "center" },
});
