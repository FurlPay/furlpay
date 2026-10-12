import React, { useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { CardFace, StatusChip } from "@/components/cards/CardFace";
import { CardDetailsReveal } from "@/components/cards/CardDetailsReveal";
import { EMPTY_SHIPPING, ShippingForm, isShippingComplete, shippingError, type ShippingDraft } from "@/components/cards/ShippingForm";
import { Button, EmptyState, ErrorNote, Field, Screen, Sheet } from "@/components/ui";
import { authenticateDeviceOwner } from "@/lib/biometrics";
import { authorizeMoneyMove } from "@/lib/money/authorize";
import {
  canManage,
  isTerminal,
  needsActivation,
  pinError,
  pinLockMinutesRemaining,
  statusPresentation,
  type CardLifecycle,
} from "@/lib/cards/lifecycle";
import {
  cardErrorMessage,
  useCardLifecycle,
  useCardLifecycleMutations,
  useCardProducts,
} from "@/lib/cards/useCardLifecycle";
import { useCards } from "@/lib/queries";
import { txDate } from "@/lib/format";
import { OFFLINE_MUTATION_MESSAGE, useIsOffline } from "@/lib/net";
import { useSecureScreen } from "@/lib/secureScreen";
import { colors, radius, spacing, type } from "@/lib/theme";

// ---------------------------------------------------------------------------
// One card, and everything that can be done to it.
//
// The tab shows the carousel and the day-to-day controls (freeze, limits,
// channels). This screen is the rest of the lifecycle, which had no client at
// all: activation, PIN, design, device wallets, loss, replacement, closure.
//
// THREE RULES THE UI ENFORCES BECAUSE THE SERVER DOES:
//
//  1. LOSS AND CLOSURE ARE TERMINAL. Neither can be undone. The confirmations
//     say so in those words, and once a card is in either state every control
//     that implies it could still transact is REMOVED rather than disabled — a
//     greyed-out "Freeze" on a card reported lost invites the reading that
//     unfreezing is somewhere nearby.
//
//  2. AN UNACTIVATED CARD IS FROZEN AND STAYS FROZEN. Activation is the only
//     thing offered on it, because it is the only thing that works.
//
//  3. THE PIN IS NEVER READ BACK. `hasPin` is the entire visible state. Setting
//     one is device-owner gated, and verifying reports attempts remaining so
//     nobody locks themselves out blind.
//
// FLAG_SECURE is on for the whole screen. It carries the shipping address, the
// PIN entry and the card artwork with its last four — enough to be worth
// keeping out of the recents thumbnail.
// ---------------------------------------------------------------------------

export default function CardDetail() {
  useSecureScreen("card-detail");
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const offline = useIsOffline();

  const { data: lifecycle, isLoading, error } = useCardLifecycle(id);
  const { data: cardsResult } = useCards();
  const { themes } = useCardProducts();
  const m = useCardLifecycleMutations(id);

  const card = cardsResult?.data.find((c) => c.id === id) ?? null;

  const [sheet, setSheet] = useState<"activate" | "pin" | "design" | "details" | "reissue" | "shipping" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  /** Run a mutation with the offline guard and consistent error surfacing.
   *  Card controls are never queued: a "success" into an outbox would show a
   *  card as frozen or closed while it is still live and spendable. */
  const run = async (work: () => Promise<unknown>): Promise<boolean> => {
    setActionError(null);
    if (offline) {
      setActionError(OFFLINE_MUTATION_MESSAGE);
      return false;
    }
    try {
      await work();
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return true;
    } catch (e) {
      setActionError(cardErrorMessage(e));
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return false;
    }
  };

  if (isLoading && !lifecycle) {
    return (
      <Screen>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.neon} />
        </View>
      </Screen>
    );
  }

  if (!lifecycle) {
    return (
      <Screen>
        <View style={styles.centered}>
          <EmptyState
            title={error ? "Couldn't load this card" : "Card not found"}
            subtitle={
              error
                ? "Nothing has been changed. Check your connection and try again."
                : "It may have been closed or replaced."
            }
          />
          <Button title="Back to cards" variant="secondary" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  const status = statusPresentation(lifecycle);
  const terminal = isTerminal(lifecycle.status);
  const manageable = canManage(lifecycle);
  const awaitingActivation = needsActivation(lifecycle);
  const pinLockMinutes = pinLockMinutesRemaining(lifecycle.pinLockedUntil);

  const reportLost = () => {
    Alert.alert(
      "Report this card lost?",
      // The irreversibility is the whole message. A user who reads this as
      // "freeze, but louder" will use it casually and then be stuck with a
      // reissue fee.
      "This is permanent. The card stops working immediately and CANNOT be unfrozen, reactivated or restored — the only way back is ordering a replacement.\n\nIf you have just misplaced it, freeze it instead: that is reversible.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Report lost",
          style: "destructive",
          onPress: () => void run(() => m.reportLost.mutateAsync()),
        },
      ]
    );
  };

  const closeCard = () => {
    Alert.alert(
      "Close this card?",
      "The card stops working immediately and cannot be reopened. Your transaction history is kept.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Close card",
          style: "destructive",
          onPress: () => {
            void run(() => m.close.mutateAsync()).then((ok) => {
              if (ok) router.back();
            });
          },
        },
      ]
    );
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {card ? (
          <CardFace
            label={card.label}
            last4={card.last4}
            network={card.network}
            kind={card.kind}
            gradient={lifecycle.theme.gradient}
            themeId={lifecycle.theme.id}
            settlementCurrency={card.settlementCurrency}
            frozen={card.frozen}
            status={lifecycle.status}
          />
        ) : null}

        {card && !terminal ? (
          <Button
            title="Card number, expiry and CVV"
            variant="secondary"
            onPress={() => setSheet("details")}
          />
        ) : null}

        <View style={styles.statusBlock}>
          <StatusChip label={status.label} tone={status.tone} />
          {status.detail ? <Text style={type.dim}>{status.detail}</Text> : null}
        </View>

        <ErrorNote message={actionError} />

        {/* ── activation ──────────────────────────────────────────────── */}
        {awaitingActivation ? (
          <Panel
            title="Activate your card"
            body={`Enter the 8-digit code printed on the carrier your card arrived in. ${lifecycle.activationAttemptsRemaining} ${
              lifecycle.activationAttemptsRemaining === 1 ? "attempt" : "attempts"
            } remaining.`}
          >
            <Button
              title="Enter activation code"
              onPress={() => setSheet("activate")}
              disabled={offline || lifecycle.activationAttemptsRemaining === 0}
            />
            {lifecycle.activationAttemptsRemaining === 0 ? (
              <Text style={styles.warn}>
                No attempts left. Contact support to have this card reissued.
              </Text>
            ) : null}
          </Panel>
        ) : null}

        {/* ── delivery ────────────────────────────────────────────────── */}
        {lifecycle.product.kind === "physical" && !terminal ? (
          <Panel title="Delivery">
            <Row k="Status" v={lifecycle.shippedAt ? "Shipped" : "Preparing"} />
            {lifecycle.shippedAt ? <Row k="Shipped" v={txDate(lifecycle.shippedAt)} /> : null}
            {lifecycle.trackingRef ? <Row k="Tracking" v={lifecycle.trackingRef} mono /> : null}
            {lifecycle.shipping ? (
              <View style={{ gap: 2, marginTop: 4 }}>
                <Text style={styles.rowKey}>Address</Text>
                <Text style={type.body}>{lifecycle.shipping.name}</Text>
                <Text style={type.dim}>
                  {[
                    lifecycle.shipping.line1,
                    lifecycle.shipping.line2,
                    lifecycle.shipping.city,
                    lifecycle.shipping.postcode,
                    lifecycle.shipping.country,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </Text>
              </View>
            ) : null}
            {/* Editable only before it ships — once it is in the post, changing
                the address here would be a lie about where it is going. */}
            {!lifecycle.shippedAt ? (
              <Button
                title="Change address"
                variant="secondary"
                onPress={() => setSheet("shipping")}
                disabled={offline}
              />
            ) : (
              <Text style={styles.note}>
                The address can&rsquo;t be changed once the card is in the post.
              </Text>
            )}
          </Panel>
        ) : null}

        {/* ── device wallets ──────────────────────────────────────────── */}
        {manageable ? (
          <Panel
            title="Device wallets"
            body="Add this card to pay with your phone or watch. Only an active card can be added."
          >
            <ToggleRow
              icon="logo-google"
              label="Google Pay"
              value={lifecycle.provisioning.googlePay}
              disabled={offline || m.busy}
              onChange={(enabled) =>
                void run(() => m.setProvisioning.mutateAsync({ wallet: "googlePay", enabled }))
              }
            />
            <ToggleRow
              icon="logo-apple"
              label="Apple Pay"
              value={lifecycle.provisioning.applePay}
              disabled={offline || m.busy}
              onChange={(enabled) =>
                void run(() => m.setProvisioning.mutateAsync({ wallet: "applePay", enabled }))
              }
            />
            {/* Stated rather than implied. This toggle records the intent; the
                push into the wallet does not happen, and pretending otherwise
                would leave someone waiting for a card that never appears.

                NOT A MISSING IMPLEMENTATION. The provisioning path is built and
                complete, end to end:

                  native-app/modules/apple-wallet-provisioning (PassKit, Swift)
                  native-app/modules/google-pay-provisioning   (TapAndPay, Kotlin)
                  native-app/lib/cards/provisioning.ts         (client helper)
                  apps/web/.../cards/lifecycle/[id]/provisioning (server route)

                What is absent is a CONTRACTED CARD ISSUER. Without one the server
                has no issuer-signed artefacts to return, so it answers
                `simulated: true` with placeholder OPC / certs / nonceSignature, and
                lib/cards/provisioning.ts branches on that flag and stops.

                THAT GUARD IS LOAD-BEARING — DO NOT REMOVE IT. An OPC and a
                nonceSignature are verified against the issuer's signature chain by
                the secure element. Handing the simulated values to
                PKAddPaymentPassViewController or TapAndPayClient.pushTokenize
                cannot succeed; it can only fail somewhere far less legible than
                this sentence.

                So there is nothing to wire here. This note becomes a real button
                when CARD_ISSUING_LIVE can report `on`, which needs an issuer
                contract, live credentials, and Rain's (currently non-public)
                webhook signature scheme — see apps/web/src/lib/flags.ts,
                CARD_ISSUING_LIVE.unimplemented. */}
            <Text style={styles.note}>
              This records your preference on your FurlPay account. Completing the
              hand-off to Google Pay or Apple Pay isn&rsquo;t available yet.
            </Text>
          </Panel>
        ) : null}

        {/* ── PIN ─────────────────────────────────────────────────────── */}
        {manageable && lifecycle.product.kind === "physical" ? (
          <Panel
            title="PIN"
            body={
              lifecycle.hasPin
                ? "Used at ATMs and chip-and-PIN terminals."
                : "Set a PIN before using this card at an ATM or a chip-and-PIN terminal."
            }
          >
            {pinLockMinutes > 0 ? (
              <Text style={styles.warn}>
                Too many wrong attempts. Try again in {pinLockMinutes}{" "}
                {pinLockMinutes === 1 ? "minute" : "minutes"}.
              </Text>
            ) : null}
            <Button
              title={lifecycle.hasPin ? "Change PIN" : "Set a PIN"}
              variant={lifecycle.hasPin ? "secondary" : "primary"}
              onPress={() => setSheet("pin")}
              disabled={offline || pinLockMinutes > 0}
            />
          </Panel>
        ) : null}

        {/* ── design ──────────────────────────────────────────────────── */}
        {manageable ? (
          <Panel title="Design" body={lifecycle.theme.name}>
            <Button
              title="Change design"
              variant="secondary"
              onPress={() => setSheet("design")}
              disabled={offline}
            />
          </Panel>
        ) : null}

        {/* ── history ─────────────────────────────────────────────────── */}
        <Panel title="History">
          <Row k="Ordered" v={txDate(lifecycle.orderedAt)} />
          {lifecycle.shippedAt ? <Row k="Shipped" v={txDate(lifecycle.shippedAt)} /> : null}
          {lifecycle.activatedAt ? <Row k="Activated" v={txDate(lifecycle.activatedAt)} /> : null}
          {lifecycle.closedAt ? <Row k="Ended" v={txDate(lifecycle.closedAt)} /> : null}
          <Row k="Product" v={lifecycle.product.name} />
          {lifecycle.replacesCardId ? (
            <Pressable onPress={() => router.push(`/cards/${lifecycle.replacesCardId}`)}>
              <Row k="Replaces" v="View the card this replaced" link />
            </Pressable>
          ) : null}
          {lifecycle.replacedByCardId ? (
            <Pressable onPress={() => router.push(`/cards/${lifecycle.replacedByCardId}`)}>
              <Row k="Replaced by" v="View the replacement" link />
            </Pressable>
          ) : null}
        </Panel>

        {/* ── danger zone ─────────────────────────────────────────────── */}
        {lifecycle.status === "lost" && !lifecycle.replacedByCardId ? (
          <Panel
            title="Replace this card"
            body="A replacement gets a new number and no PIN. Your old details stop working — which is the point."
          >
            <Button title="Order a replacement" onPress={() => setSheet("reissue")} disabled={offline} />
          </Panel>
        ) : null}

        {!terminal ? (
          <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
            <Button
              title="Report lost or stolen"
              variant="danger"
              onPress={reportLost}
              disabled={offline || m.busy}
            />
            <Button
              title="Close this card"
              variant="outline"
              onPress={closeCard}
              disabled={offline || m.busy}
            />
            <Text style={styles.note}>
              Reporting a card lost is permanent. To pause it temporarily, freeze it from the
              Cards tab instead.
            </Text>
          </View>
        ) : null}
      </ScrollView>

      <ActivateSheet
        open={sheet === "activate"}
        lifecycle={lifecycle}
        busy={m.activate.isPending}
        onClose={() => setSheet(null)}
        onSubmit={async (code) => {
          const ok = await run(() => m.activate.mutateAsync(code));
          if (ok) setSheet(null);
          return ok;
        }}
      />

      <PinSheet
        open={sheet === "pin"}
        hasPin={lifecycle.hasPin}
        busy={m.setPin.isPending}
        onClose={() => setSheet(null)}
        onSubmit={async (pin) => {
          const ok = await run(() => m.setPin.mutateAsync(pin));
          if (ok) setSheet(null);
          return ok;
        }}
      />

      <Sheet open={sheet === "details"} title="Card details" onClose={() => setSheet(null)}>
        {card && sheet === "details" ? (
          <CardDetailsReveal
            card={{
              label: card.label,
              last4: card.last4,
              network: card.network,
              kind: card.kind,
              gradient: lifecycle.theme.gradient,
              themeId: lifecycle.theme.id,
              settlementCurrency: card.settlementCurrency,
              frozen: card.frozen,
              status: lifecycle.status,
            }}
          />
        ) : null}
      </Sheet>

      <Sheet open={sheet === "design"} title="Card design" onClose={() => setSheet(null)}>
        <View style={{ gap: spacing.sm }}>
          {themes.map((t) => (
            <Pressable
              key={t.id}
              onPress={() => {
                if (t.locked) return;
                void run(() => m.setTheme.mutateAsync(t.id)).then((ok) => {
                  if (ok) setSheet(null);
                });
              }}
              disabled={!!t.locked || m.busy}
              style={({ pressed }) => [
                styles.themeRow,
                t.id === lifecycle.theme.id && { borderColor: colors.neon },
                pressed && !t.locked && { borderColor: colors.neon },
                t.locked && { opacity: 0.45 },
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: t.id === lifecycle.theme.id, disabled: !!t.locked }}
              accessibilityLabel={`${t.name}${t.locked ? ", requires Pro" : ""}`}
            >
              <View style={[styles.themeSwatch, { backgroundColor: t.gradient[0] }]}>
                <View style={[styles.themeSwatchHalf, { backgroundColor: t.gradient[1] }]} />
              </View>
              <Text style={[type.body, { flex: 1, fontWeight: "600" }]}>{t.name}</Text>
              {t.locked ? (
                <Text style={styles.lockNote}>Pro</Text>
              ) : t.id === lifecycle.theme.id ? (
                <Ionicons name="checkmark-circle" size={18} color={colors.neon} />
              ) : null}
            </Pressable>
          ))}
        </View>
      </Sheet>

      <ShippingSheet
        open={sheet === "shipping"}
        initial={lifecycle.shipping}
        busy={m.setShipping.isPending}
        onClose={() => setSheet(null)}
        onSubmit={async (address) => {
          const ok = await run(() => m.setShipping.mutateAsync(address));
          if (ok) setSheet(null);
          return ok;
        }}
      />

      <ReissueSheet
        open={sheet === "reissue"}
        physical={lifecycle.product.kind === "physical"}
        initialShipping={lifecycle.shipping}
        busy={m.reissue.isPending}
        onClose={() => setSheet(null)}
        onSubmit={async (input) => {
          setActionError(null);
          if (offline) {
            setActionError(OFFLINE_MUTATION_MESSAGE);
            return false;
          }
          // Reissuing mints a card and can charge a fee — same boundary as
          // ordering one. `create_card` is classified high risk.
          const decision = await authorizeMoneyMove({
            action: "create_card",
            amountUsd: 0,
            reason: "Order a replacement card",
          });
          if (!decision.ok) {
            if (decision.kind !== "declined") setActionError(decision.message);
            return false;
          }
          try {
            const result = await m.reissue.mutateAsync(input);
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            setSheet(null);
            router.replace(`/cards/${result.lifecycle.cardId}`);
            return true;
          } catch (e) {
            setActionError(cardErrorMessage(e));
            return false;
          }
        }}
      />
    </Screen>
  );
}

// ── sheets ────────────────────────────────────────────────────────────────

function ActivateSheet({
  open,
  lifecycle,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  lifecycle: CardLifecycle;
  busy: boolean;
  onClose: () => void;
  onSubmit: (code: string) => Promise<boolean>;
}) {
  const [code, setCode] = useState("");
  const valid = /^\d{8}$/.test(code);
  return (
    <Sheet open={open} title="Activate card" onClose={onClose}>
      <View style={{ gap: spacing.md }}>
        <Text style={type.dim}>
          The 8-digit code is printed on the carrier your card arrived attached to. It proves the
          card is in your hands — which is what stops one intercepted in the post from working.
        </Text>
        <Field
          value={code}
          onChangeText={(v) => setCode(v.replace(/\D/g, "").slice(0, 8))}
          placeholder="00000000"
          keyboardType="number-pad"
          maxLength={8}
          autoFocus
          style={styles.codeInput}
          accessibilityLabel="Activation code, 8 digits"
        />
        <Text style={styles.note}>
          {lifecycle.activationAttemptsRemaining}{" "}
          {lifecycle.activationAttemptsRemaining === 1 ? "attempt" : "attempts"} remaining.
        </Text>
        <Button
          title="Activate"
          disabled={!valid || busy}
          loading={busy}
          onPress={() => {
            void onSubmit(code).then((ok) => {
              if (ok) setCode("");
            });
          }}
        />
      </View>
    </Sheet>
  );
}

function PinSheet({
  open,
  hasPin,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  hasPin: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (pin: string) => Promise<boolean>;
}) {
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [touched, setTouched] = useState(false);
  const [gateError, setGateError] = useState<string | null>(null);

  const problem = useMemo(() => {
    if (!pin) return null;
    const shape = pinError(pin);
    if (shape) return shape;
    if (confirm && confirm !== pin) return "The two PINs don't match.";
    return null;
  }, [pin, confirm]);

  const ready = /^\d{4}$/.test(pin) && pin === confirm && !problem;

  const submit = async () => {
    setTouched(true);
    setGateError(null);
    if (!ready) return;
    // Setting a card PIN is sensitive-data WRITE, not an ordinary approval, so
    // it goes through device-owner proof rather than the approvals preference —
    // the same standard as revealing card details.
    const gate = await authenticateDeviceOwner("Confirm it's you to set the card PIN");
    if (!gate.ok) {
      setGateError(
        gate.reason === "no_device_lock"
          ? "Set a screen lock (PIN, pattern or biometrics) on this device before setting a card PIN."
          : "Confirmation was cancelled. The PIN was not changed."
      );
      return;
    }
    const ok = await onSubmit(pin);
    if (ok) {
      setPin("");
      setConfirm("");
      setTouched(false);
    }
  };

  return (
    <Sheet open={open} title={hasPin ? "Change PIN" : "Set a PIN"} onClose={onClose}>
      <View style={{ gap: spacing.md }}>
        <Text style={type.dim}>
          Four digits, used at ATMs and chip-and-PIN terminals. FurlPay never shows you an
          existing PIN — if you&rsquo;ve forgotten it, set a new one here.
        </Text>
        <Field
          label="New PIN"
          value={pin}
          onChangeText={(v) => setPin(v.replace(/\D/g, "").slice(0, 4))}
          placeholder="••••"
          keyboardType="number-pad"
          secureTextEntry
          maxLength={4}
          autoFocus
          accessibilityLabel="New PIN"
        />
        <Field
          label="Confirm PIN"
          value={confirm}
          onChangeText={(v) => setConfirm(v.replace(/\D/g, "").slice(0, 4))}
          placeholder="••••"
          keyboardType="number-pad"
          secureTextEntry
          maxLength={4}
          accessibilityLabel="Confirm PIN"
        />
        {touched || pin ? <ErrorNote message={problem} /> : null}
        <ErrorNote message={gateError} />
        <Button
          title={hasPin ? "Change PIN" : "Set PIN"}
          disabled={!ready || busy}
          loading={busy}
          onPress={() => void submit()}
        />
      </View>
    </Sheet>
  );
}

function ShippingSheet({
  open,
  initial,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  initial: CardLifecycle["shipping"];
  busy: boolean;
  onClose: () => void;
  onSubmit: (address: ShippingDraft) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<ShippingDraft>(
    initial
      ? {
          name: initial.name,
          line1: initial.line1,
          line2: initial.line2 ?? "",
          city: initial.city,
          postcode: initial.postcode,
          country: initial.country,
        }
      : EMPTY_SHIPPING
  );
  const problem = isShippingComplete(draft) ? null : shippingError(draft);
  return (
    <Sheet open={open} title="Delivery address" onClose={onClose}>
      <View style={{ gap: spacing.md }}>
        <ShippingForm value={draft} onChange={setDraft} disabled={busy} />
        <Button
          title="Save address"
          disabled={!!problem || busy}
          loading={busy}
          onPress={() => void onSubmit(draft)}
        />
        {problem ? <Text style={styles.note}>{problem}</Text> : null}
      </View>
    </Sheet>
  );
}

function ReissueSheet({
  open,
  physical,
  initialShipping,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  physical: boolean;
  initialShipping: CardLifecycle["shipping"];
  busy: boolean;
  onClose: () => void;
  onSubmit: (input: {
    label: string;
    shipping?: ShippingDraft;
    idempotencyKey: string;
  }) => Promise<boolean>;
}) {
  const [label, setLabel] = useState("");
  const [draft, setDraft] = useState<ShippingDraft>(
    initialShipping
      ? {
          name: initialShipping.name,
          line1: initialShipping.line1,
          line2: initialShipping.line2 ?? "",
          city: initialShipping.city,
          postcode: initialShipping.postcode,
          country: initialShipping.country,
        }
      : EMPTY_SHIPPING
  );

  // Same discipline as the order screen: a reissue charges a fee and mints a
  // card, so a retry must replay rather than produce two replacements.
  const idem = useRef<{ fingerprint: string; key: string } | null>(null);
  const keyFor = (fingerprint: string) => {
    if (idem.current?.fingerprint !== fingerprint) {
      idem.current = { fingerprint, key: crypto.randomUUID() };
    }
    return idem.current.key;
  };

  const shippingOk = !physical || isShippingComplete(draft);
  const ready = label.trim().length > 0 && label.trim().length <= 24 && shippingOk;

  return (
    <Sheet open={open} title="Order a replacement" onClose={onClose}>
      <View style={{ gap: spacing.md }}>
        <Text style={type.dim}>
          The replacement gets a new number and no PIN — the old details stop working, which is
          the whole point of replacing it.
        </Text>
        <Field
          label="Name"
          value={label}
          onChangeText={setLabel}
          placeholder="Everyday, Travel…"
          maxLength={24}
          accessibilityLabel="Replacement card name"
        />
        {physical ? <ShippingForm value={draft} onChange={setDraft} disabled={busy} /> : null}
        <Button
          title="Order replacement"
          disabled={!ready || busy}
          loading={busy}
          onPress={() => {
            const fingerprint = `${label.trim()}|${physical ? JSON.stringify(draft) : ""}`;
            void onSubmit({
              label: label.trim(),
              ...(physical ? { shipping: draft } : {}),
              idempotencyKey: keyFor(fingerprint),
            });
          }}
        />
      </View>
    </Sheet>
  );
}

// ── small pieces ──────────────────────────────────────────────────────────

function Panel({
  title,
  body,
  children,
}: {
  title: string;
  body?: string;
  children?: React.ReactNode;
}) {
  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>{title}</Text>
      {body ? <Text style={type.dim}>{body}</Text> : null}
      {children}
    </View>
  );
}

function Row({ k, v, mono, link }: { k: string; v: string; mono?: boolean; link?: boolean }) {
  return (
    <View style={styles.row} accessible accessibilityLabel={`${k}: ${v}`}>
      <Text style={styles.rowKey}>{k}</Text>
      <Text
        style={[
          styles.rowValue,
          mono && { fontFamily: "monospace", fontSize: 12 },
          link && { color: colors.neon },
        ]}
        numberOfLines={1}
      >
        {v}
      </Text>
    </View>
  );
}

function ToggleRow({
  icon,
  label,
  value,
  disabled,
  onChange,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  value: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <Ionicons name={icon} size={18} color={colors.textDim} />
      <Text style={[type.body, { flex: 1 }]}>{label}</Text>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ true: colors.neonDeep, false: colors.surfaceRaised }}
        thumbColor={value ? colors.neon : colors.textDim}
        accessibilityLabel={label}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  centered: { flex: 1, justifyContent: "center", padding: spacing.md, gap: spacing.md },
  statusBlock: { gap: spacing.sm },
  panel: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  panelTitle: { color: colors.text, fontSize: 15, fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "baseline", gap: spacing.md, paddingVertical: 2 },
  rowKey: { color: colors.textFaint, fontSize: 13, flex: 1 },
  rowValue: { color: colors.text, fontSize: 13, fontWeight: "600", flexShrink: 1, textAlign: "right" },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  note: { color: colors.textFaint, fontSize: 12, lineHeight: 17 },
  warn: { color: colors.warning, fontSize: 12, lineHeight: 17 },
  codeInput: { fontFamily: "monospace", fontSize: 22, letterSpacing: 6, textAlign: "center" },
  themeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.sm + 2,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  themeSwatch: { width: 46, height: 30, borderRadius: radius.sm, overflow: "hidden", justifyContent: "flex-end" },
  themeSwatchHalf: { height: 14, opacity: 0.9 },
  lockNote: { color: colors.warning, fontSize: 11, fontWeight: "800", letterSpacing: 0.4 },
});
