import React, { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { announce, makeStyles, useTheme } from "@/lib/design";
import { useI18n } from "@/lib/i18n";
import { haptic } from "@/lib/haptics";
import { requireAuthFor, type RiskAction } from "@/lib/security/riskPolicy";
import { FurlButton, FurlSecondaryButton } from "./Button";
import { FurlCard } from "./Surfaces";
import { FurlSummaryRow } from "./Money";

export interface ConfirmationLine {
  label: string;
  value: string;
  emphasis?: boolean;
  tone?: "default" | "warning" | "danger" | "success";
}

export interface FurlConfirmationViewProps {
  title: string;
  /** The headline amount, already formatted for the locale. */
  amount: string;
  /** Fiat equivalent or token sub-line. */
  amountSecondary?: string;
  /** Ordered detail lines: destination, network, fee, rate, total, arrival. */
  lines: ConfirmationLine[];
  /** Shown in warning tone above the buttons. Each is a real risk, not filler. */
  warnings?: string[];
  /**
   * Wall-clock ms at which the quote stops being valid. When set, a countdown
   * is shown and Confirm is DISABLED once it passes — a stale rate must not be
   * submittable.
   */
  quoteExpiresAt?: number;
  onRequote?: () => void;
  /** Classified action; drives whether a step-up prompt is required. */
  action: RiskAction;
  /** Text shown in the OS auth prompt. Include the amount and destination. */
  authReason: string;
  /** Must be idempotent on the server; see the note on double submission. */
  onConfirm: () => Promise<void>;
  onCancel: () => void;
  confirmLabel?: string;
}

/**
 * The last screen before money moves.
 *
 * Three things this component exists to guarantee, none of which a screen
 * reliably did for itself:
 *
 * 1. NO DOUBLE SUBMISSION. `inFlight` is a ref, not state — a second tap
 *    arriving in the same frame as the first sees the ref already set, whereas
 *    a state update would not have re-rendered yet. That race is exactly how a
 *    fast double-tap becomes two transfers.
 *
 * 2. NO STALE QUOTE. Once `quoteExpiresAt` passes, Confirm is disabled and the
 *    user is offered a re-quote. Submitting against an expired rate either
 *    fails at the server or fills at a price the user never agreed to.
 *
 * 3. INTENT IS PROVEN. High-risk actions route through `requireAuthFor` before
 *    `onConfirm` is ever called, so authorization happens BEFORE the request,
 *    not alongside it.
 */
export function FurlConfirmationView({
  title,
  amount,
  amountSecondary,
  lines,
  warnings,
  quoteExpiresAt,
  onRequote,
  action,
  authReason,
  onConfirm,
  onCancel,
  confirmLabel,
}: FurlConfirmationViewProps) {
  const t = useTheme();
  const s = useStyles();
  const { t: tr } = useI18n();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  // The real guard. State lags a frame; this does not.
  const inFlight = useRef(false);

  // Quote countdown.
  useEffect(() => {
    if (!quoteExpiresAt) {
      setSecondsLeft(null);
      return;
    }
    const tick = () => {
      const left = Math.max(0, Math.ceil((quoteExpiresAt - Date.now()) / 1000));
      setSecondsLeft(left);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [quoteExpiresAt]);

  const expired = secondsLeft !== null && secondsLeft <= 0;

  useEffect(() => {
    // Tell a screen-reader user the quote died; they have no countdown to watch.
    if (expired) announce(tr("money.quoteExpired"));
  }, [expired, tr]);

  const handleConfirm = useCallback(async () => {
    if (inFlight.current || expired) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);

    try {
      const auth = await requireAuthFor(action, { reason: authReason });
      if (!auth.ok) {
        setError(
          auth.reason === "no_device_lock"
            ? "Set a screen lock on this device to authorize payments."
            : tr("security.unlockFailed")
        );
        haptic.error();
        return;
      }

      haptic.commit();
      await onConfirm();
      // Deliberately NOT clearing inFlight on success: the caller navigates
      // away, and re-enabling the button during that transition is another
      // window for a second submission.
      return;
    } catch (e) {
      setError(e instanceof Error ? e.message : tr("state.errorBody"));
      haptic.error();
      announce(tr("a11y.announceError", { message: e instanceof Error ? e.message : "" }));
      inFlight.current = false;
    } finally {
      setBusy(false);
    }
  }, [action, authReason, expired, onConfirm, tr]);

  return (
    <View style={s.root}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <Text style={t.type("h1")} accessibilityRole="header">
          {title}
        </Text>

        <View style={s.amountBlock} accessible accessibilityLabel={`${amount}${amountSecondary ? `, ${amountSecondary}` : ""}`}>
          <Text style={t.type("amount")} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
            {amount}
          </Text>
          {amountSecondary ? (
            <Text style={[t.type("dim"), { color: t.colors.textDim }]}>{amountSecondary}</Text>
          ) : null}
        </View>

        <FurlCard>
          {lines.map((l, i) => (
            <FurlSummaryRow
              key={`${l.label}-${i}`}
              label={l.label}
              value={l.value}
              emphasis={l.emphasis}
              tone={l.tone}
            />
          ))}
        </FurlCard>

        {secondsLeft !== null ? (
          <View
            style={[
              s.quote,
              { backgroundColor: expired ? t.colors.dangerSoft : t.colors.warningSoft },
            ]}
            accessibilityRole="alert"
          >
            <Ionicons
              name={expired ? "alert-circle-outline" : "time-outline"}
              size={14}
              color={expired ? t.colors.danger : t.colors.warning}
            />
            <Text
              style={[
                t.type("caption"),
                { color: expired ? t.colors.accentText : t.colors.warning, flex: 1 },
              ]}
            >
              {expired ? tr("money.quoteExpired") : tr("money.quoteExpires", { seconds: secondsLeft })}
            </Text>
          </View>
        ) : null}

        {warnings?.length
          ? warnings.map((w, i) => (
              <View key={i} style={[s.quote, { backgroundColor: t.colors.warningSoft }]} accessibilityRole="alert">
                <Ionicons name="warning-outline" size={14} color={t.colors.warning} />
                <Text style={[t.type("caption"), { color: t.colors.warning, flex: 1 }]}>{w}</Text>
              </View>
            ))
          : null}

        {error ? (
          <View style={[s.quote, { backgroundColor: t.colors.dangerSoft }]} accessibilityRole="alert">
            <Ionicons name="close-circle-outline" size={14} color={t.colors.danger} />
            <Text style={[t.type("caption"), { color: t.colors.accentText, flex: 1 }]}>{error}</Text>
          </View>
        ) : null}
      </ScrollView>

      {/* Pinned, so the action never scrolls out of reach at large font sizes. */}
      <View style={s.actions}>
        {expired && onRequote ? (
          <FurlButton title={tr("state.refresh")} onPress={onRequote} icon="refresh" />
        ) : (
          <FurlButton
            title={confirmLabel ?? tr("common.confirm")}
            onPress={() => void handleConfirm()}
            loading={busy}
            disabled={expired}
            feedback="none" /* handleConfirm fires `commit` at the right moment */
            accessibilityHint={authReason}
          />
        )}
        <FurlSecondaryButton title={tr("common.cancel")} onPress={onCancel} disabled={busy} />
      </View>
    </View>
  );
}

/**
 * A blocking "prove it's you" panel.
 *
 * Used where a step-up is needed to REVEAL something rather than to submit
 * something — card PAN, a seed phrase, agent audit history.
 */
export function FurlSecurityPrompt({
  title,
  body,
  action,
  authReason,
  onAuthenticated,
  onCancel,
}: {
  title?: string;
  body?: string;
  action: RiskAction;
  authReason: string;
  onAuthenticated: () => void;
  onCancel?: () => void;
}) {
  const t = useTheme();
  const s = useStyles();
  const { t: tr } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      // `force` — a reveal must not ride the grace window opened by an
      // unrelated action a minute ago.
      const res = await requireAuthFor(action, { reason: authReason, force: true });
      if (res.ok) {
        haptic.success();
        onAuthenticated();
      } else {
        haptic.error();
        setError(
          res.reason === "no_device_lock"
            ? "Set a screen lock on this device to see this."
            : tr("security.unlockFailed")
        );
      }
    } finally {
      setBusy(false);
    }
  }, [action, authReason, onAuthenticated, tr]);

  return (
    <View style={s.prompt} accessible accessibilityRole="alert">
      <View style={[s.promptBadge, { backgroundColor: t.colors.infoSoft }]}>
        <Ionicons name="lock-closed" size={t.component.icon.xl} color={t.colors.info} />
      </View>
      <Text style={[t.type("h2"), { textAlign: "center" }]} accessibilityRole="header">
        {title ?? tr("security.confirmHighRisk")}
      </Text>
      <Text style={[t.type("body"), { color: t.colors.textDim, textAlign: "center" }]}>
        {body ?? tr("security.confirmHighRiskBody")}
      </Text>
      {error ? (
        <Text style={[t.type("caption"), { color: t.colors.accentText }]} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <FurlButton
        title={tr("security.authenticate")}
        onPress={() => void run()}
        loading={busy}
        icon="finger-print"
      />
      {onCancel ? (
        <FurlSecondaryButton title={tr("common.cancel")} onPress={onCancel} disabled={busy} />
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.colors.bg },
  scroll: { padding: t.spacing.md, gap: t.spacing.md },
  amountBlock: { alignItems: "center", gap: 4, paddingVertical: t.spacing.md },
  quote: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xs,
    padding: t.spacing.sm,
    borderRadius: t.radius.md,
  },
  actions: {
    gap: t.spacing.sm,
    padding: t.spacing.md,
    borderTopWidth: 1,
    borderTopColor: t.colors.border,
    backgroundColor: t.colors.bg,
  },
  prompt: {
    alignItems: "center",
    justifyContent: "center",
    gap: t.spacing.md,
    padding: t.spacing.xl,
  },
  promptBadge: {
    width: 64,
    height: 64,
    borderRadius: t.radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
}));
