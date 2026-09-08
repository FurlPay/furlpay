import React, { useMemo, useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import {
  FurlCard,
  FurlEmptyState,
  FurlErrorState,
  FurlInput,
  FurlScreen,
  FurlSecondaryButton,
  FurlSegmented,
  FurlSkeletonList,
} from "@/components/furl";
import { useTheme } from "@/lib/design";
import { useI18n } from "@/lib/i18n";
import { useFlag } from "@/lib/flags";
import { useDebounced } from "@/lib/useDebounced";
import { useAds, useP2PConfig, useP2PHeartbeat } from "@/lib/p2p/useP2P";
import type { P2PAd, P2PSide } from "@/lib/p2p/types";

// ---------------------------------------------------------------------------
// The order book.
//
// SIDE IS FROM THE USER'S POINT OF VIEW, NOT THE AD'S. An ad whose owner
// SELLS crypto is what a user who wants to BUY needs to see. Getting this
// inversion wrong is the single most confusing bug a P2P screen can have —
// the user taps "Buy" and is shown people who want to buy — so the mapping
// happens once, here, and is named.
//
// EVERY MAKER FIGURE IS SERVER-SUPPLIED AND SHOWN AS-IS. Completed orders,
// rating and the certified badge come from the merchant record; none is
// inferred client-side. A rating of `null` renders as "no ratings yet" rather
// than as zero stars — a new maker is unrated, not badly rated, and rendering
// 0 would price them out of a market they have not been given a chance in.
// ---------------------------------------------------------------------------

/**
 * A user buying crypto needs ads whose owner is SELLING it, and vice versa.
 * The server filters on the ad's own side, so the intent is inverted here.
 */
function adSideFor(userIntent: P2PSide): P2PSide {
  return userIntent === "buy" ? "sell" : "buy";
}

export default function P2PScreen() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const router = useRouter();
  const enabled = useFlag("p2p_marketplace");

  const [intent, setIntent] = useState<P2PSide>("buy");
  const [asset, setAsset] = useState("USDT");
  const [fiat, setFiat] = useState("INR");
  const [amountText, setAmountText] = useState("");

  // Debounced so typing an amount does not fire a request per keystroke at the
  // book's rate limit (120/min).
  const debouncedAmount = useDebounced(amountText, 400);
  const fiatAmount = useMemo(() => {
    const n = Number(debouncedAmount);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }, [debouncedAmount]);

  const config = useP2PConfig();
  const ads = useAds({ side: adSideFor(intent), asset, fiat, fiatAmount });

  // Presence is reported while this screen is open, not while the app lives:
  // a backgrounded user is not available to service a trade.
  useP2PHeartbeat(enabled);

  if (!enabled) {
    return (
      <FurlScreen>
        <FurlEmptyState icon="people-outline" title={tr("p2p.unavailable")} body={tr("p2p.unavailableBody")} />
      </FurlScreen>
    );
  }

  const assets = config.data?.assets ?? [asset];
  const fiats = config.data?.fiats ?? [fiat];

  return (
    <FurlScreen>
      <ScrollView
        contentContainerStyle={{ padding: t.spacing.lg, gap: t.spacing.md }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={ads.isRefetching} onRefresh={() => void ads.refetch()} tintColor={t.colors.primary} />
        }
      >
        <Text style={[t.type("dim"), { color: t.colors.textDim }]}>{tr("p2p.subtitle")}</Text>

        <FurlSegmented
          value={intent}
          onChange={setIntent}
          options={["buy", "sell"] as const}
          labels={{ buy: tr("p2p.buy"), sell: tr("p2p.sell") }}
        />

        <View style={{ flexDirection: "row", gap: t.spacing.sm }}>
          <View style={{ flex: 1 }}>
            <FurlSegmented value={asset} onChange={setAsset} options={assets} />
          </View>
        </View>
        <FurlSegmented value={fiat} onChange={setFiat} options={fiats} />

        <FurlInput
          label={tr("p2p.amountToSpend")}
          value={amountText}
          onChangeText={setAmountText}
          keyboardType="decimal-pad"
          placeholder="0"
        />

        <FurlSecondaryButton
          title={tr("p2p.myOrders")}
          icon="receipt-outline"
          onPress={() => router.push("/p2p/orders")}
        />

        {ads.isLoading ? (
          <FurlSkeletonList rows={4} />
        ) : ads.error ? (
          <FurlErrorState error={ads.error} onAction={() => void ads.refetch()} actionLabel={tr("state.retry")} />
        ) : (ads.data ?? []).length === 0 ? (
          <FurlEmptyState icon="pricetags-outline" title={tr("p2p.noAds")} body={tr("p2p.noAdsBody")} />
        ) : (
          (ads.data ?? []).map((ad) => (
            <AdRow key={ad.id} ad={ad} onPress={() => router.push(`/p2p/ad/${ad.id}?intent=${intent}`)} />
          ))
        )}
      </ScrollView>
    </FurlScreen>
  );
}

function AdRow({ ad, onPress }: { ad: P2PAd; onPress: () => void }) {
  const t = useTheme();
  const { t: tr } = useI18n();

  return (
    <FurlCard onPress={onPress} accessibilityLabel={ad.maker.displayName}>
      <View style={{ gap: t.spacing.xs }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: t.spacing.xs }}>
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: ad.maker.online ? t.colors.success : t.colors.textDim,
            }}
          />
          <Text style={t.type("body")} numberOfLines={1}>
            {ad.maker.displayName}
          </Text>
          {ad.maker.certified ? (
            <Text style={[t.type("caption"), { color: t.colors.primaryText }]}>{tr("p2p.certified")}</Text>
          ) : null}
        </View>

        <Text style={[t.type("caption"), { color: t.colors.textDim }]}>
          {tr("p2p.orders", { count: ad.maker.completedOrders })}
          {" · "}
          {/* null is "unrated", NOT zero. A new maker rendered as 0 stars is
              priced out of a market they have not yet traded in. */}
          {ad.maker.rating === null
            ? tr("p2p.noRating")
            : `${ad.maker.rating.toFixed(1)} (${ad.maker.ratingCount})`}
        </Text>

        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" }}>
          <View style={{ gap: 2 }}>
            <Text style={[t.type("caption"), { color: t.colors.textDim }]}>{tr("p2p.limits")}</Text>
            <Text style={t.type("caption")}>
              {ad.minFiat} – {ad.maxFiat} {ad.fiat}
            </Text>
          </View>
          <View style={{ alignItems: "flex-end", gap: 2 }}>
            <Text style={[t.type("caption"), { color: t.colors.textDim }]}>{tr("p2p.price")}</Text>
            <Text style={t.type("h2")}>
              {ad.price} {ad.fiat}
            </Text>
          </View>
        </View>

        <Text style={[t.type("caption"), { color: t.colors.textDim }]} numberOfLines={1}>
          {tr("p2p.payVia")}: {ad.paymentMethods.map((m) => m.label).join(", ")}
        </Text>
      </View>
    </FurlCard>
  );
}
