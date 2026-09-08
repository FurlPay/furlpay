import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import * as Clipboard from "expo-clipboard";
import {
  FurlButton,
  FurlCard,
  FurlErrorState,
  FurlScreen,
  FurlSectionHeader,
  FurlSecondaryButton,
  FurlSkeletonList,
  FurlStatusBadge,
  type MoneyStatus,
} from "@/components/furl";
import { useTheme } from "@/lib/design";
import { useI18n } from "@/lib/i18n";
import { useSecureScreen } from "@/lib/secureScreen";
import { authorizeMoneyMove } from "@/lib/money/authorize";
import { cancelOrder, markPaid, newOrderIntentKey, openAppeal, releaseOrder } from "@/lib/p2p/api";
import { useInvalidateP2P, useOrder } from "@/lib/p2p/useP2P";
import { timeRemainingMs, whoseTurn, type P2POrder } from "@/lib/p2p/types";

// ---------------------------------------------------------------------------
// A live trade.
//
// THE SCREEN'S JOB IS TO ANSWER "WHAT DO I DO NOW". A P2P order is a
// conversation with a stranger, conducted through two apps, on a clock, with
// someone's money in escrow. The failure mode is not a crash — it is a user who
// cannot tell whether they are waiting on the app, on a person, or on
// themselves. `whoseTurn` answers that as data so the answer is identical in
// the header, the button and the accessibility label.
//
// THE TWO IRREVERSIBLE ACTIONS ARE GUARDED DIFFERENTLY FROM EACH OTHER:
//
//   MARK PAID   is a claim about the physical world that the app cannot check.
//               Its confirmation says so, and says what happens to an account
//               that lies — because the only real control on it is the appeal
//               process and the user's own account standing.
//
//   RELEASE     hands over the crypto and cannot be undone. It carries the
//               money-move authorisation AND an idempotency key, because a
//               timeout on the response must not be able to release twice or
//               leave the user unsure whether it released at all.
//
// ACCOUNT DETAILS ARE COPYABLE, NEVER RE-TYPED. A mistyped account number sends
// money to a stranger and the escrow will not come back for it.
// ---------------------------------------------------------------------------

export default function P2POrderScreen() {
  // Bank account numbers, holder name, amounts.
  useSecureScreen("p2p-order");

  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const { t: tr } = useI18n();
  const invalidate = useInvalidateP2P();
  const order = useOrder(id);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // One key per release INTENT, held across retries — same rule as order
  // creation. See lib/p2p/api.ts.
  const releaseKey = useRef<string | null>(null);

  const run = useCallback(
    async (action: () => Promise<P2POrder>) => {
      setBusy(true);
      setError(null);
      try {
        await action();
        invalidate(id);
        await order.refetch();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [id, invalidate, order],
  );

  const copy = useCallback(async (label: string, value: string) => {
    await Clipboard.setStringAsync(value);
    setCopied(label);
  }, []);

  const confirmMarkPaid = useCallback(() => {
    Alert.alert(tr("p2p.markPaid"), tr("p2p.markPaidConfirm"), [
      { text: tr("common.cancel"), style: "cancel" },
      { text: tr("p2p.markPaid"), onPress: () => void run(() => markPaid(id!)) },
    ]);
  }, [id, run, tr]);

  const confirmRelease = useCallback(() => {
    Alert.alert(tr("p2p.release"), tr("p2p.releaseConfirm"), [
      { text: tr("common.cancel"), style: "cancel" },
      {
        text: tr("p2p.release"),
        style: "destructive",
        onPress: () => {
          void (async () => {
            const decision = await authorizeMoneyMove({
              action: "send_funds",
              amountUsd: order.data?.fiatAmount ?? 0,
              reason: tr("p2p.release"),
            });
            if (!decision.ok) {
              if (decision.kind !== "declined") setError(decision.message);
              return;
            }
            releaseKey.current ??= newOrderIntentKey();
            await run(() => releaseOrder(id!, releaseKey.current!));
            releaseKey.current = null;
          })();
        },
      },
    ]);
  }, [id, order.data?.fiatAmount, run, tr]);

  if (order.isLoading) {
    return (
      <FurlScreen>
        <View style={{ padding: t.spacing.lg }}>
          <FurlSkeletonList rows={4} />
        </View>
      </FurlScreen>
    );
  }
  if (order.error || !order.data) {
    return (
      <FurlScreen>
        <FurlErrorState error={order.error} onAction={() => void order.refetch()} actionLabel={tr("state.retry")} />
      </FurlScreen>
    );
  }

  const o = order.data;
  const turn = whoseTurn(o);
  const remaining = timeRemainingMs(o);
  const isBuyer = o.role === "buyer";

  return (
    <FurlScreen>
      <ScrollView contentContainerStyle={{ padding: t.spacing.lg, gap: t.spacing.md }}>
        <View style={{ gap: t.spacing.xs }}>
          <Text style={t.type("h1")}>{tr("p2p.orderRef", { sn: o.sn })}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: t.spacing.xs }}>
            <FurlStatusBadge status={statusToBadge(o.status)} />
            {/* The P2P-specific wording beside the shared badge. The badge
                carries the tone and the generic state; this says what that
                state means in a trade ("waiting for release", not
                "processing"). */}
            <Text style={[t.type("caption"), { color: t.colors.textDim }]}>{statusLabel(o.status, tr)}</Text>
          </View>
          <Text style={[t.type("body"), { color: turn === "you" ? t.colors.primaryText : t.colors.textDim }]}>
            {turn === "you" ? tr("p2p.yourTurn") : turn === "them" ? tr("p2p.theirTurn") : tr("p2p.underReview")}
          </Text>
        </View>

        <FurlCard>
          <View style={{ gap: t.spacing.xs }}>
            <Row label={tr("p2p.youPay")} value={isBuyer ? `${o.fiatAmount} ${o.fiat}` : `${o.amount} ${o.asset}`} />
            <Row label={tr("p2p.youGet")} value={isBuyer ? `${o.amount} ${o.asset}` : `${o.fiatAmount} ${o.fiat}`} />
            <Row label={tr("p2p.price")} value={`${o.price} ${o.fiat}`} />
          </View>
        </FurlCard>

        {o.status === "pending_payment" ? (
          <Text style={[t.type("caption"), { color: remaining > 0 ? t.colors.textDim : t.colors.warning }]}>
            {remaining > 0 ? tr("p2p.payWindow", { time: formatDuration(remaining) }) : tr("p2p.expired")}
          </Text>
        ) : null}

        {/* Only the party who must pay receives these fields from the server —
            see P2PFullPaymentMethod. The buyer sees them; the seller never
            needs them and so is never sent them. */}
        {o.paymentMethod && isBuyer && o.status === "pending_payment" ? (
          <>
            <FurlSectionHeader title={tr("p2p.payInto")} />
            <FurlCard>
              <View style={{ gap: t.spacing.sm }}>
                <CopyRow
                  label={tr("p2p.holderName")}
                  value={o.paymentMethod.holderName}
                  onCopy={() => void copy(tr("p2p.holderName"), o.paymentMethod!.holderName)}
                />
                <CopyRow
                  label={tr("p2p.accountNumber")}
                  value={o.paymentMethod.account}
                  onCopy={() => void copy(tr("p2p.accountNumber"), o.paymentMethod!.account)}
                />
                {o.paymentMethod.bankCode ? (
                  <CopyRow
                    label={tr("p2p.bankCode")}
                    value={o.paymentMethod.bankCode}
                    onCopy={() => void copy(tr("p2p.bankCode"), o.paymentMethod!.bankCode!)}
                  />
                ) : null}
                <CopyRow
                  label={tr("p2p.reference")}
                  value={o.sn}
                  onCopy={() => void copy(tr("p2p.reference"), o.sn)}
                />
                {copied ? (
                  <Text style={[t.type("caption"), { color: t.colors.success }]}>
                    {copied} · {tr("common.copied")}
                  </Text>
                ) : null}
              </View>
            </FurlCard>
          </>
        ) : null}

        {o.appeal && o.appeal.status === "open" ? (
          <FurlCard style={{ borderColor: t.colors.warning }}>
            <Text style={[t.type("body"), { color: t.colors.warning }]}>{tr("p2p.appealOpen")}</Text>
          </FurlCard>
        ) : null}

        {error ? (
          <FurlCard style={{ borderColor: t.colors.danger }}>
            <Text style={[t.type("body"), { color: t.colors.danger }]}>{error}</Text>
          </FurlCard>
        ) : null}

        <View style={{ gap: t.spacing.sm }}>
          {o.status === "pending_payment" && isBuyer ? (
            <FurlButton title={tr("p2p.markPaid")} loading={busy} disabled={busy} onPress={confirmMarkPaid} />
          ) : null}

          {o.status === "paid" && !isBuyer ? (
            <FurlButton
              title={busy ? tr("p2p.releasing") : tr("p2p.release")}
              loading={busy}
              disabled={busy}
              onPress={confirmRelease}
            />
          ) : null}

          {o.status === "pending_payment" ? (
            <FurlSecondaryButton
              title={tr("p2p.cancel")}
              disabled={busy}
              onPress={() =>
                Alert.alert(tr("p2p.cancel"), tr("p2p.cancelReason"), [
                  { text: tr("common.cancel"), style: "cancel" },
                  {
                    text: tr("p2p.cancel"),
                    style: "destructive",
                    onPress: () => void run(() => cancelOrder(id!, "changed_mind")),
                  },
                ])
              }
            />
          ) : null}

          {/* An appeal is available only once payment is claimed. Before that
              there is nothing in dispute — the escrow simply returns on
              cancellation, which is the cheaper path for everyone. */}
          {o.status === "paid" && !o.appeal ? (
            <FurlSecondaryButton
              title={tr("p2p.appeal")}
              disabled={busy}
              onPress={() =>
                Alert.alert(tr("p2p.appeal"), tr("p2p.appealReason"), [
                  { text: tr("common.cancel"), style: "cancel" },
                  {
                    text: tr("p2p.appeal"),
                    onPress: () =>
                      void run(() => openAppeal(id!, "payment_not_received", tr("p2p.appealDetail"))),
                  },
                ])
              }
            />
          ) : null}
        </View>
      </ScrollView>
    </FurlScreen>
  );
}

/**
 * P2P status to the shared money-status vocabulary.
 *
 * The design system already has `escrow` and `frozen`, which are exactly what a
 * P2P order is doing — mapping both onto a generic "pending" would throw away
 * the distinction between "your counterparty's crypto is locked, waiting for
 * you to pay" and "an operator is holding it while a dispute runs". Those look
 * different because they ARE different, and the badge tone follows.
 */
function statusToBadge(status: P2POrder["status"]): MoneyStatus {
  switch (status) {
    case "pending_payment":
      return "escrow";
    case "paid":
      return "processing";
    case "released":
      return "settled";
    case "cancelled":
      return "cancelled";
    case "appealed":
      return "frozen";
  }
}

function statusLabel(status: P2POrder["status"], tr: (k: never) => string): string {
  const key = (
    {
      pending_payment: "p2p.statusPendingPayment",
      paid: "p2p.statusPaid",
      released: "p2p.statusReleased",
      cancelled: "p2p.statusCancelled",
      appealed: "p2p.statusAppealed",
    } as const
  )[status];
  return tr(key as never);
}

/** "1h 12m" / "4m". Whole minutes: a payment window measured in seconds would
 *  re-render every tick for no decision the user can act on. */
function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function Row({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
      <Text style={[t.type("caption"), { color: t.colors.textDim }]}>{label}</Text>
      <Text style={[t.type("body"), { flexShrink: 1, textAlign: "right" }]}>{value}</Text>
    </View>
  );
}

/** A field the user must reproduce exactly in their banking app. Copy, never retype. */
function CopyRow({ label, value, onCopy }: { label: string; value: string; onCopy: () => void }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  return (
    <View style={{ gap: 2 }}>
      <Text style={[t.type("caption"), { color: t.colors.textDim }]}>{label}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: t.spacing.sm }}>
        <Text style={[t.type("body"), { flex: 1 }]} selectable>
          {value}
        </Text>
        <FurlSecondaryButton title={tr("common.copy")} size="sm" stretch={false} onPress={onCopy} />
      </View>
    </View>
  );
}
