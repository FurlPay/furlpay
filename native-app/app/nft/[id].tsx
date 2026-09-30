import React, { useCallback, useMemo, useState } from "react";
import { Image, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FurlButton,
  FurlCard,
  FurlEmptyState,
  FurlInput,
  FurlScreen,
  FurlSecondaryButton,
} from "@/components/furl";
import { useTheme } from "@/lib/design";
import { useI18n } from "@/lib/i18n";
import { useSecureScreen } from "@/lib/secureScreen";
import { authorizeMoneyMove } from "@/lib/money/authorize";
import { track } from "@/lib/analytics";
import { getKnownAddress } from "@/lib/wallet";
import { defaultSigner } from "@/lib/signing/registry";
import { getFeeCaps, getTransactionCount, sendRawTransaction, estimateGas } from "@/lib/evm/rpc";
import { CHAINS, type ChainId } from "@/lib/swap/assets";
import { chainSlugFor } from "@/lib/tokens/customTokens";
import { encodeNftTransfer, NftError, verifyOwnership } from "@/lib/nft/onchain";
import { fetchOwnedNfts } from "@/lib/nft/api";
import type { NftItem } from "@/lib/nft/types";

// ---------------------------------------------------------------------------
// One collectible, and the flow that sends it.
//
// OWNERSHIP IS RE-VERIFIED ON THIS SCREEN, ON CHAIN, EVERY TIME. The gallery
// renders what an indexer said, and an indexer is a cache: it can be minutes
// behind a sale, and it can be wrong. Signing a transfer of something the
// wallet no longer owns produces a transaction that burns gas and reverts,
// after the user was shown a screen saying it was theirs.
//
// AN UNVERIFIABLE ANSWER IS NOT A "NO". verifyOwnership throws on a transport
// failure and returns `owned: false` only when the chain actually said so. The
// send button is disabled for a definite no and for an unknown alike, but the
// COPY differs — "this wallet does not own this" versus "ownership could not be
// checked" — because one of those is fixed by retrying and the other is not.
//
// THE TRANSFER IS REAL. Real calldata (safeTransferFrom), real gas estimation,
// real signing with the device key, real broadcast, real hash. There is no path
// through this screen that reports a send that did not happen.
// ---------------------------------------------------------------------------

export default function NftDetailScreen() {
  useSecureScreen("nft-detail");

  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const { t: tr } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();

  // `${chain}:${contract}:${tokenId}` — the id the gallery minted.
  const parsed = useMemo(() => parseNftId(id), [id]);

  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("1");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const owner = useQuery({
    queryKey: ["wallet", "address"],
    queryFn: () => getKnownAddress(),
    staleTime: 5 * 60_000,
  });

  // The gallery's cached page is reused for presentation only — image, name,
  // collection. Nothing here trusts it for ownership.
  const gallery = useQuery({
    queryKey: ["nft", parsed?.chain, owner.data],
    queryFn: () => fetchOwnedNfts({ chain: parsed!.chain, owner: owner.data! }),
    enabled: Boolean(parsed && owner.data),
    staleTime: 5 * 60_000,
  });

  const item: NftItem | undefined = gallery.data?.items.find((i) => i.id === id);

  const ownership = useQuery({
    queryKey: ["nft", "ownership", id, owner.data],
    queryFn: async () => {
      const slug = chainSlugFor(parsed!.chain);
      if (!slug) throw new NftError("unsupported", "Unsupported network.");
      return verifyOwnership({
        chain: slug,
        contract: parsed!.contract,
        tokenId: parsed!.tokenId,
        owner: owner.data!,
        standard: item?.standard ?? "erc721",
      });
    },
    enabled: Boolean(parsed && owner.data),
    // Ownership is the gate on an irreversible action, so it is never served
    // stale: a cached "you own this" from ten minutes ago is exactly the claim
    // that produces a reverted transfer.
    staleTime: 0,
    retry: 1,
  });

  const send = useCallback(async () => {
    if (!parsed || !owner.data) return;
    setError(null);

    if (!/^0x[0-9a-fA-F]{40}$/.test(recipient.trim())) {
      setError(tr("nft.invalidRecipient"));
      return;
    }
    // Defence in depth: the button is already disabled, but a transfer of
    // something unowned must be unreachable rather than merely discouraged.
    if (!ownership.data?.owned) {
      setError(tr("nft.cannotSendNotOwned"));
      return;
    }

    const decision = await authorizeMoneyMove({
      action: "send_funds",
      // A collectible has no reliable USD price and inventing one would feed a
      // fabricated figure into the risk engine's thresholds. Zero keeps the
      // step-up rules driven by the action, not by a guess.
      amountUsd: 0,
      reason: tr("nft.sendTitle"),
    });
    if (!decision.ok) {
      if (decision.kind !== "declined") setError(decision.message);
      return;
    }

    const slug = chainSlugFor(parsed.chain);
    if (!slug) {
      setError(tr("nft.sendFailed"));
      return;
    }

    setSending(true);
    try {
      const standard = item?.standard ?? "erc721";
      const data = encodeNftTransfer({
        standard,
        from: owner.data,
        to: recipient.trim(),
        tokenId: parsed.tokenId,
        amount: standard === "erc1155" ? amount : undefined,
      });

      const [nonce, fees] = await Promise.all([
        getTransactionCount(slug, owner.data),
        getFeeCaps(slug),
      ]);

      // Estimated, not guessed. An NFT transfer's cost varies widely with the
      // contract (royalty hooks, enumerable bookkeeping), and a fixed limit
      // either wastes gas or runs out mid-transfer.
      const gasLimit = await estimateGas(slug, {
        from: owner.data,
        to: parsed.contract,
        data,
        // Hex quantity, per JSON-RPC. An NFT transfer never carries value.
        value: "0x0",
      });

      track("nft_transfer_submitted", { chain: parsed.chain, standard });

      const signed = await defaultSigner().signTransaction({
        chainId: chainIdOf(parsed.chain),
        nonce,
        maxFeePerGas: fees.maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
        // Used as returned: lib/evm/rpc.ts's estimateGas already adds 25%
        // headroom over the node's figure. Multiplying again would inflate the
        // ceiling for every transfer without making any of them more likely to
        // land — an estimate is a bound, not a charge, but a wildly inflated
        // one distorts the fee preview the user is shown.
        gasLimit,
        to: parsed.contract,
        value: 0n,
        data,
      });

      const hash = await sendRawTransaction(slug, signed.raw);
      setTxHash(hash);
      track("nft_transfer_settled", { chain: parsed.chain, outcome: "success" });

      // The item has left the wallet; both the gallery and the ownership proof
      // are now wrong.
      void qc.invalidateQueries({ queryKey: ["nft"] });
    } catch (e) {
      track("nft_transfer_settled", { chain: parsed.chain, outcome: "failure" });
      setError(e instanceof NftError ? e.message : (e as Error).message);
    } finally {
      setSending(false);
    }
  }, [amount, item?.standard, owner.data, ownership.data?.owned, parsed, qc, recipient, tr]);

  if (!parsed) {
    return (
      <FurlScreen>
        <FurlEmptyState icon="image-outline" title={tr("nft.loadError")} />
      </FurlScreen>
    );
  }

  if (txHash) {
    return (
      <FurlScreen>
        <View style={{ padding: t.spacing.lg, gap: t.spacing.md }}>
          <FurlEmptyState icon="checkmark-circle-outline" title={tr("nft.sent")} body={txHash} />
          <FurlSecondaryButton title={tr("common.done")} onPress={() => router.back()} />
        </View>
      </FurlScreen>
    );
  }

  const media = item?.media.url ?? item?.media.thumbnailUrl ?? null;
  const owned = ownership.data?.owned === true;

  return (
    <FurlScreen>
      <ScrollView
        contentContainerStyle={{ padding: t.spacing.lg, gap: t.spacing.md }}
        keyboardShouldPersistTaps="handled"
      >
        <View
          style={{
            aspectRatio: 1,
            borderRadius: t.radius.lg,
            backgroundColor: t.colors.surface,
            overflow: "hidden",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {media ? (
            <Image source={{ uri: media }} style={{ width: "100%", height: "100%" }} resizeMode="contain" />
          ) : (
            <Text style={[t.type("dim"), { color: t.colors.textDim }]}>{tr("nft.noImage")}</Text>
          )}
        </View>

        <Text style={t.type("h1")}>{item?.name ?? `#${parsed.tokenId}`}</Text>

        {item?.spamReason ? (
          <FurlCard style={{ borderColor: t.colors.danger }}>
            <Text style={[t.type("body"), { color: t.colors.danger }]}>{item.spamReason}</Text>
          </FurlCard>
        ) : null}

        <FurlCard>
          <View style={{ gap: t.spacing.xs }}>
            <Row label={tr("nft.collection")} value={item?.collection.name ?? parsed.contract} />
            <Row label={tr("nft.tokenId")} value={parsed.tokenId} />
            <Row label={tr("nft.standard")} value={(item?.standard ?? "erc721").toUpperCase()} />
            <Row label={tr("nft.network")} value={CHAINS[parsed.chain]?.name ?? parsed.chain} />
          </View>
        </FurlCard>

        {/* The chain's answer, not the indexer's. */}
        <FurlCard style={owned ? undefined : { borderColor: t.colors.warning }}>
          <Text
            style={[
              t.type("body"),
              { color: owned ? t.colors.success : ownership.isError ? t.colors.warning : t.colors.textDim },
            ]}
          >
            {ownership.isLoading
              ? tr("nft.checkingOwnership")
              : ownership.isError
                ? tr("nft.ownershipUnknown")
                : owned
                  ? tr("nft.owned")
                  : tr("nft.notOwned")}
          </Text>
          {ownership.isError ? (
            <FurlSecondaryButton
              title={tr("nft.verifyAgain")}
              size="sm"
              onPress={() => void ownership.refetch()}
            />
          ) : null}
        </FurlCard>

        {owned ? (
          <>
            <FurlCard style={{ borderColor: t.colors.warning }}>
              <Text style={[t.type("caption"), { color: t.colors.warning }]}>{tr("nft.sendWarning")}</Text>
            </FurlCard>

            <FurlInput
              label={tr("nft.recipient")}
              value={recipient}
              onChangeText={setRecipient}
              placeholder="0x…"
              autoCapitalize="none"
              autoCorrect={false}
            />

            {item?.standard === "erc1155" ? (
              <FurlInput
                label={tr("nft.amount")}
                value={amount}
                onChangeText={setAmount}
                keyboardType="number-pad"
              />
            ) : null}

            {error ? (
              <FurlCard style={{ borderColor: t.colors.danger }}>
                <Text style={[t.type("body"), { color: t.colors.danger }]}>{error}</Text>
              </FurlCard>
            ) : null}

            <FurlButton
              title={sending ? tr("nft.sending") : tr("nft.confirmSend")}
              loading={sending}
              disabled={sending || recipient.trim().length === 0}
              onPress={() => void send()}
            />
          </>
        ) : null}
      </ScrollView>
    </FurlScreen>
  );
}

/**
 * Split `${chain}:${contract}:${tokenId}`.
 *
 * A token id may itself contain no colon (it is decimal), so a plain split is
 * safe — but the chain is validated against the catalogue rather than trusted,
 * because this value arrives from a route param a deep link can set.
 */
export function parseNftId(raw: string | undefined): { chain: ChainId; contract: string; tokenId: string } | null {
  if (!raw) return null;
  const parts = decodeURIComponent(raw).split(":");
  if (parts.length !== 3) return null;
  const [chain, contract, tokenId] = parts;
  if (!(chain in CHAINS)) return null;
  if (!/^0x[0-9a-fA-F]{40}$/.test(contract)) return null;
  if (!/^\d+$/.test(tokenId)) return null;
  return { chain: chain as ChainId, contract: contract.toLowerCase(), tokenId };
}

/** FurlPay chain slug -> EIP-155 chain id, for the transaction envelope. */
function chainIdOf(chain: ChainId): number {
  switch (chain) {
    case "ethereum":
      return 1;
    case "polygon":
      return 137;
    case "base":
      return 8453;
    case "arbitrum":
      return 42161;
    default:
      throw new NftError("unsupported", `No EIP-155 chain id for ${chain}.`);
  }
}

function Row({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
      <Text style={[t.type("caption"), { color: t.colors.textDim }]}>{label}</Text>
      <Text style={[t.type("body"), { flexShrink: 1, textAlign: "right" }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}
