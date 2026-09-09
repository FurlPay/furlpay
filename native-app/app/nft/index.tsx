import React, { useCallback, useMemo, useState } from "react";
import { Image, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import {
  FurlCard,
  FurlEmptyState,
  FurlErrorState,
  FurlScreen,
  FurlSectionHeader,
  FurlSecondaryButton,
  FurlSegmented,
  FurlSkeletonList,
} from "@/components/furl";
import { useTheme } from "@/lib/design";
import { useI18n } from "@/lib/i18n";
import { useFlag } from "@/lib/flags";
import { useSecureScreen } from "@/lib/secureScreen";
import { getKnownAddress } from "@/lib/wallet";
import { CHAINS, type ChainId } from "@/lib/swap/assets";
import { fetchOwnedNfts } from "@/lib/nft/api";
import { groupByCollection, partitionSpam, type NftItem } from "@/lib/nft/types";

// ---------------------------------------------------------------------------
// The gallery.
//
// THREE EMPTY-LOOKING STATES THAT MEAN DIFFERENT THINGS, and the screen never
// conflates them:
//
//   unconfigured  this deployment has no NFT index. Nothing is wrong with the
//                 wallet and retrying will not help. Says so.
//   error         the index failed. Retry is offered.
//   empty         a real answer: this address holds nothing here.
//
// A single "no NFTs" for all three would tell a user with a full wallet that
// they own nothing, which is the worst thing this screen could say.
//
// SPAM IS SEPARATED, NEVER DELETED. Airdropped phishing NFTs are the main
// attack vector on every EVM chain. Hiding them entirely means a user cannot
// see what an attacker sent them; showing them inline means a scam sits next to
// their art. They go in a collapsed section that explains what it is.
// ---------------------------------------------------------------------------

const NFT_CHAINS = ["ethereum", "arbitrum", "base", "polygon"] as const satisfies readonly ChainId[];

const CHAIN_LABELS: Partial<Record<ChainId, string>> = Object.fromEntries(
  NFT_CHAINS.map((c) => [c, CHAINS[c].short]),
);

export default function NftGalleryScreen() {
  // The full holdings of the wallet.
  useSecureScreen("nft");

  const t = useTheme();
  const { t: tr } = useI18n();
  const router = useRouter();
  const enabled = useFlag("nft_gallery");

  const [chain, setChain] = useState<ChainId>("ethereum");
  const [showSpam, setShowSpam] = useState(false);

  const address = useQuery({
    queryKey: ["wallet", "address"],
    queryFn: () => getKnownAddress(),
    staleTime: 5 * 60_000,
  });

  const nfts = useQuery({
    queryKey: ["nft", chain, address.data],
    queryFn: () => fetchOwnedNfts({ chain, owner: address.data! }),
    enabled: Boolean(address.data) && enabled,
    // Art does not change often, and each refetch is a billed vendor call.
    staleTime: 5 * 60_000,
  });

  const { clean, spam } = useMemo(
    () => partitionSpam(nfts.data?.items ?? []),
    [nfts.data?.items],
  );
  const groups = useMemo(() => groupByCollection(clean), [clean]);

  const open = useCallback(
    (item: NftItem) => router.push(`/nft/${encodeURIComponent(item.id)}`),
    [router],
  );

  if (!enabled) {
    return (
      <FurlScreen>
        <FurlEmptyState icon="images-outline" title={tr("nft.unavailable")} body={tr("nft.unavailableBody")} />
      </FurlScreen>
    );
  }

  const status = nfts.data?.status;

  return (
    <FurlScreen>
      <ScrollView
        contentContainerStyle={{ padding: t.spacing.lg, gap: t.spacing.md }}
        refreshControl={
          <RefreshControl refreshing={nfts.isRefetching} onRefresh={() => void nfts.refetch()} tintColor={t.colors.primary} />
        }
      >
        <Text style={[t.type("dim"), { color: t.colors.textDim }]}>{tr("nft.subtitle")}</Text>

        <FurlSegmented value={chain} onChange={setChain} options={NFT_CHAINS} labels={CHAIN_LABELS} />

        {nfts.isLoading ? (
          <FurlSkeletonList rows={3} />
        ) : status?.kind === "unconfigured" ? (
          // Not an error and not "you own nothing" — a deployment that has no
          // index. Retrying is pointless, so no retry is offered.
          <FurlEmptyState icon="images-outline" title={tr("nft.unavailable")} body={tr("nft.unavailableBody")} />
        ) : status?.kind === "error" || nfts.error ? (
          <FurlErrorState
            title={tr("nft.loadError")}
            body={status?.kind === "error" ? status.message : undefined}
            error={nfts.error}
            onAction={() => void nfts.refetch()}
            actionLabel={tr("state.retry")}
          />
        ) : clean.length === 0 && spam.length === 0 ? (
          <FurlEmptyState icon="images-outline" title={tr("nft.empty")} body={tr("nft.emptyBody")} />
        ) : (
          groups.map((group) => (
            <View key={`${group.collection.contract}`} style={{ gap: t.spacing.sm }}>
              <FurlSectionHeader title={group.collection.name ?? tr("nft.collection")} />
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: t.spacing.sm }}>
                {group.items.map((item) => (
                  <NftTile key={item.id} item={item} onPress={() => open(item)} />
                ))}
              </View>
            </View>
          ))
        )}

        {spam.length > 0 ? (
          <View style={{ gap: t.spacing.sm }}>
            <FurlSectionHeader title={tr("nft.spamSection")} />
            <Text style={[t.type("caption"), { color: t.colors.textDim }]}>{tr("nft.spamExplain")}</Text>
            <FurlSecondaryButton
              title={showSpam ? tr("nft.hideSpam") : tr("nft.showSpam", { count: spam.length })}
              onPress={() => setShowSpam((v) => !v)}
            />
            {showSpam ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: t.spacing.sm }}>
                {spam.map((item) => (
                  <NftTile key={item.id} item={item} onPress={() => open(item)} dimmed />
                ))}
              </View>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </FurlScreen>
  );
}

const TILE = 104;

function NftTile({ item, onPress, dimmed }: { item: NftItem; onPress: () => void; dimmed?: boolean }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  // A URL that 404s and an absent one look identical to a user, so a load
  // failure falls back to the same placeholder rather than a broken-image icon.
  const [failed, setFailed] = useState(false);
  const source = item.media.thumbnailUrl ?? item.media.url;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={item.name ?? `${tr("nft.tokenId")} ${item.tokenId}`}
      style={({ pressed }) => [{ width: TILE, opacity: pressed ? 0.85 : dimmed ? 0.55 : 1 }]}
    >
      <View
        style={{
          width: TILE,
          height: TILE,
          borderRadius: t.radius.md,
          backgroundColor: t.colors.surface,
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        {source && !failed ? (
          <Image
            source={{ uri: source }}
            style={{ width: TILE, height: TILE }}
            resizeMode="cover"
            onError={() => setFailed(true)}
          />
        ) : (
          <Ionicons name="image-outline" size={t.component.icon.lg} color={t.colors.textDim} />
        )}
      </View>
      <Text style={[t.type("caption"), { marginTop: 4 }]} numberOfLines={1}>
        {item.name ?? `#${item.tokenId}`}
      </Text>
      {/* ERC-1155 can hold many of one id; showing the count is the difference
          between "an NFT" and "forty of them". */}
      {item.standard === "erc1155" && item.balance !== "1" ? (
        <Text style={[t.type("caption"), { color: t.colors.textDim }]} numberOfLines={1}>
          {tr("nft.quantity", { count: item.balance })}
        </Text>
      ) : null}
    </Pressable>
  );
}
