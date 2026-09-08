import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  FurlButton,
  FurlCard,
  FurlErrorState,
  FurlInput,
  FurlScreen,
  FurlSectionHeader,
  FurlSkeletonList,
} from "@/components/furl";
import { useTheme } from "@/lib/design";
import { useI18n } from "@/lib/i18n";
import { useSecureScreen } from "@/lib/secureScreen";
import { useDebounced } from "@/lib/useDebounced";
import { authorizeMoneyMove } from "@/lib/money/authorize";
import { createOrder, newOrderIntentKey, quote } from "@/lib/p2p/api";
import { useAd, useInvalidateP2P } from "@/lib/p2p/useP2P";
import type { P2PQuote } from "@/lib/p2p/types";

// ---------------------------------------------------------------------------
// One offer, and the step that turns it into an order.
//
// THE ORDER BUTTON LOCKS SOMEONE ELSE'S CRYPTO INTO ESCROW. That is what makes
// this screen a money screen rather than a browse screen, and it drives three
// decisions:
//
//   1. It goes through `authorizeMoneyMove` like every other money action in
//      the app, so the same step-up rules apply.
//   2. The idempotency key is minted ONCE per user intent and held in a ref
//      across retries. A key regenerated per attempt would make the header
//      decorative and let a timeout lock the escrow twice.
//   3. The quote is re-fetched as the amount changes but is NEVER the thing
//      that is submitted — the server re-prices at order time. A client-side
//      quote is a preview, and treating it as a commitment is how a user is
//      shown one price and charged another.
// ---------------------------------------------------------------------------

export default function P2PAdScreen() {
  // Shows a maker's terms and, once ordered, leads to bank details.
  useSecureScreen("p2p-ad");

  const { id, intent } = useLocalSearchParams<{ id: string; intent?: string }>();
  const router = useRouter();
  const t = useTheme();
  const { t: tr } = useI18n();
  const invalidate = useInvalidateP2P();

  const ad = useAd(id);
  const [fiatText, setFiatText] = useState("");
  const [priced, setPriced] = useState<P2PQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One key per INTENT. Minted lazily on the first submit and reused for every
  // retry of that same tap — see the header.
  const intentKey = useRef<string | null>(null);

  const debouncedFiat = useDebounced(fiatText, 400);
  const fiatAmount = useMemo(() => {
    const n = Number(debouncedFiat);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }, [debouncedFiat]);

  useEffect(() => {
    if (!id || fiatAmount === undefined) {
      setPriced(null);
      return;
    }
    let cancelled = false;
    setQuoting(true);
    setError(null);
    quote(id, { fiatAmount })
      .then((q) => {
        // A late response for an amount the user has already changed must not
        // overwrite the current one — that is how a stale price lands under a
        // freshly typed figure.
        if (!cancelled) setPriced(q);
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setPriced(null);
          setError(e.message);
        }
      })
      .finally(() => {
        if (!cancelled) setQuoting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fiatAmount, id]);

  const submit = useCallback(async () => {
    if (!id || fiatAmount === undefined) return;

    const decision = await authorizeMoneyMove({
      action: "send_funds",
      // The fiat leg is the figure the user typed; the escrow moves the
      // counterparty's crypto, not theirs, but this is still a commitment
      // that binds them to pay.
      amountUsd: fiatAmount,
      reason: tr("p2p.openOrder"),
    });
    if (!decision.ok) {
      if (decision.kind !== "declined") setError(decision.message);
      return;
    }

    intentKey.current ??= newOrderIntentKey();
    setBusy(true);
    setError(null);
    try {
      const order = await createOrder({
        adId: id,
        fiatAmount,
        idempotencyKey: intentKey.current,
        approxUsd: fiatAmount,
      });
      invalidate();
      // The key belongs to a completed intent now. Clearing it means the next
      // order from this screen is genuinely new rather than replaying this one.
      intentKey.current = null;
      router.replace(`/p2p/order/${order.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [fiatAmount, id, invalidate, router, tr]);

  if (ad.isLoading) {
    return (
      <FurlScreen>
        <View style={{ padding: t.spacing.lg }}>
          <FurlSkeletonList rows={4} />
        </View>
      </FurlScreen>
    );
  }
  if (ad.error || !ad.data) {
    return (
      <FurlScreen>
        <FurlErrorState error={ad.error} onAction={() => void ad.refetch()} actionLabel={tr("state.retry")} />
      </FurlScreen>
    );
  }

  const offer = ad.data;
  const userBuys = intent !== "sell";
  const belowMin = fiatAmount !== undefined && fiatAmount < offer.minFiat;
  const aboveMax = fiatAmount !== undefined && fiatAmount > offer.maxFiat;

  return (
    <FurlScreen>
      <ScrollView contentContainerStyle={{ padding: t.spacing.lg, gap: t.spacing.md }} keyboardShouldPersistTaps="handled">
        <FurlCard>
          <View style={{ gap: t.spacing.xs }}>
            <Text style={t.type("h2")}>{offer.maker.displayName}</Text>
            <Text style={[t.type("caption"), { color: t.colors.textDim }]}>
              {tr("p2p.orders", { count: offer.maker.completedOrders })}
              {" · "}
              {offer.maker.rating === null ? tr("p2p.noRating") : offer.maker.rating.toFixed(1)}
            </Text>
            <Row label={tr("p2p.price")} value={`${offer.price} ${offer.fiat}`} />
            <Row label={tr("p2p.available")} value={`${offer.availableAmount} ${offer.asset}`} />
            <Row label={tr("p2p.limits")} value={`${offer.minFiat} – ${offer.maxFiat} ${offer.fiat}`} />
            <Row label={tr("p2p.payVia")} value={offer.paymentMethods.map((m) => m.label).join(", ")} />
          </View>
        </FurlCard>

        {offer.terms ? (
          <>
            <FurlSectionHeader title={tr("p2p.terms")} />
            <FurlCard>
              <Text style={t.type("body")}>{offer.terms}</Text>
            </FurlCard>
          </>
        ) : null}

        <FurlInput
          label={userBuys ? tr("p2p.amountToSpend") : tr("p2p.amountToReceive")}
          value={fiatText}
          onChangeText={setFiatText}
          keyboardType="decimal-pad"
          placeholder="0"
          // The limits are the maker's, and stating them at the input is what
          // stops a user discovering them from a server rejection.
          error={
            belowMin
              ? `${tr("p2p.limits")}: ${offer.minFiat} ${offer.fiat}`
              : aboveMax
                ? `${tr("p2p.limits")}: ${offer.maxFiat} ${offer.fiat}`
                : undefined
          }
        />

        {priced ? (
          <FurlCard>
            <View style={{ gap: t.spacing.xs }}>
              <Row label={tr("p2p.youPay")} value={`${priced.fiatAmount} ${priced.fiat}`} />
              <Row label={tr("p2p.youGet")} value={`${priced.amount} ${priced.asset}`} />
              <Row label={tr("p2p.price")} value={`${priced.price} ${priced.fiat}`} />
            </View>
          </FurlCard>
        ) : null}

        <Text style={[t.type("caption"), { color: t.colors.textDim }]}>{tr("p2p.escrowNote")}</Text>

        {error ? (
          <FurlCard style={{ borderColor: t.colors.danger }}>
            <Text style={[t.type("body"), { color: t.colors.danger }]}>{error}</Text>
          </FurlCard>
        ) : null}

        <FurlButton
          title={busy ? tr("p2p.opening") : tr("p2p.openOrder")}
          loading={busy}
          disabled={busy || quoting || !priced || belowMin || aboveMax}
          onPress={() => void submit()}
        />
      </ScrollView>
    </FurlScreen>
  );
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
