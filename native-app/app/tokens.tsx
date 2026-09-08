import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  FurlButton,
  FurlCard,
  FurlEmptyState,
  FurlInput,
  FurlScreen,
  FurlSectionHeader,
  FurlSegmented,
} from "@/components/furl";
import { useTheme } from "@/lib/design";
import { useI18n } from "@/lib/i18n";
import { useSecureScreen } from "@/lib/secureScreen";
import { useFlag } from "@/lib/flags";
import { getKnownAddress } from "@/lib/wallet";
import { CHAINS, type ChainId } from "@/lib/swap/assets";
import {
  addCustomToken,
  listCustomTokens,
  removeCustomToken,
  type CustomToken,
} from "@/lib/tokens/customTokens";
import { cachedAssets, discoverAssets, type DiscoveredAsset, type DiscoveryResult } from "@/lib/tokens/discovery";

// ---------------------------------------------------------------------------
// Tokens.
//
// TWO LISTS THAT MUST NEVER LOOK THE SAME, and the separation is the whole
// point of the screen:
//
//   ADDED BY YOU     contracts the user pasted. Anyone can deploy a token
//                    called "USDC" with a matching name and a convincing icon,
//                    so every row here carries an explicit "not verified by
//                    FurlPay" marker. It is not a warning badge tucked in a
//                    corner — it is the subtitle, on every row.
//
//   FOUND ON-CHAIN   balances read from the chain. These are facts about what
//                    the address holds, not claims about what a token is.
//
// A PARTIAL SCAN SAYS SO. `failures` from the discovery sweep is rendered, not
// swallowed: "3 of 4 networks checked" is honest, and silently showing three is
// how a user concludes their funds are gone when a chain's RPC was simply down.
// ---------------------------------------------------------------------------

const ADDABLE_CHAINS = ["ethereum", "arbitrum", "base", "polygon"] as const satisfies readonly ChainId[];

/** Short chain names for the picker. Built from the shared catalogue so the
 *  segmented control can never disagree with what the rest of the app calls a
 *  network. */
const CHAIN_LABELS: Partial<Record<ChainId, string>> = Object.fromEntries(
  ADDABLE_CHAINS.map((c) => [c, CHAINS[c].short]),
);

export default function TokensScreen() {
  // Balances and the full contract list.
  useSecureScreen("tokens");

  const t = useTheme();
  const { t: tr } = useI18n();
  const customTokensEnabled = useFlag("custom_tokens");
  const discoveryEnabled = useFlag("asset_discovery");

  const [tokens, setTokens] = useState<CustomToken[]>(() => safeList());
  const [discovered, setDiscovered] = useState<DiscoveredAsset[]>(() => safeCached());
  const [scan, setScan] = useState<DiscoveryResult | null>(null);
  const [scanning, setScanning] = useState(false);

  const [chain, setChain] = useState<ChainId>("arbitrum");
  const [address, setAddress] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // NOT derived from the built-in catalogue: lib/swap/assets.ts carries no
  // contract addresses at all. That is deliberate — chain configuration lives
  // server-side (see the header of lib/evm/rpc.ts), so the client has symbols
  // and glyphs but no addresses to compare against.
  //
  // The duplicate-of-a-built-in check therefore cannot be done here, and an
  // empty set is the honest input rather than a partial list that would let
  // some duplicates through while claiming to catch them. `addCustomToken`
  // still catches a duplicate of a token the user already added, which is the
  // case that actually occurs.
  const builtInAddresses = useMemo(() => new Set<string>(), []);

  const runScan = useCallback(async () => {
    setScanning(true);
    setError(null);
    try {
      const wallet = await getKnownAddress();
      if (!wallet) {
        setError(tr("state.errorTitle"));
        return;
      }
      const result = await discoverAssets(wallet);
      setScan(result);
      setDiscovered(safeCached());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setScanning(false);
    }
  }, [tr]);

  // One sweep on mount when discovery is on. The cached rows render first, so
  // this refreshes rather than blocking the screen.
  useEffect(() => {
    if (discoveryEnabled) void runScan();
  }, [discoveryEnabled, runScan]);

  const submit = useCallback(async () => {
    setAdding(true);
    setError(null);
    setNotice(null);
    try {
      const result = await addCustomToken(chain, address, builtInAddresses);
      if (result.ok) {
        setTokens(safeList());
        setAddress("");
        setNotice(tr("tokens.added", { symbol: result.token.symbol }));
      } else {
        // The service's message is shown verbatim: it distinguishes "no
        // contract there", "no decimals", "already added" and "already
        // supported", and each sends the user somewhere different.
        setError(result.error.message);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAdding(false);
    }
  }, [address, builtInAddresses, chain, tr]);

  const confirmRemove = useCallback(
    (token: CustomToken) => {
      Alert.alert(token.symbol, tr("tokens.removeConfirm", { symbol: token.symbol }), [
        { text: tr("common.cancel"), style: "cancel" },
        {
          text: tr("tokens.remove"),
          style: "destructive",
          onPress: () => {
            removeCustomToken(token.id);
            setTokens(safeList());
            setDiscovered(safeCached());
          },
        },
      ]);
    },
    [tr],
  );

  return (
    <FurlScreen>
      <ScrollView
        contentContainerStyle={{ padding: t.spacing.lg, gap: t.spacing.md }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          discoveryEnabled ? (
            <RefreshControl refreshing={scanning} onRefresh={() => void runScan()} tintColor={t.colors.primary} />
          ) : undefined
        }
      >
        <Text style={[t.type("dim"), { color: t.colors.textDim }]}>{tr("tokens.subtitle")}</Text>

        {customTokensEnabled ? (
          <>
            <FurlSectionHeader title={tr("tokens.addTitle")} />
            <FurlCard>
              <View style={{ gap: t.spacing.sm }}>
                <Text style={[t.type("caption"), { color: t.colors.textDim }]}>{tr("tokens.addPrompt")}</Text>
                <FurlSegmented
                  value={chain}
                  onChange={setChain}
                  options={ADDABLE_CHAINS}
                  labels={CHAIN_LABELS}
                />
                <FurlInput
                  label={tr("tokens.contractAddress")}
                  value={address}
                  onChangeText={setAddress}
                  placeholder="0x…"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <FurlButton
                  title={adding ? tr("tokens.adding") : tr("tokens.add")}
                  loading={adding}
                  disabled={adding || address.trim().length === 0}
                  onPress={() => void submit()}
                />
              </View>
            </FurlCard>
          </>
        ) : null}

        {error ? (
          <FurlCard style={{ borderColor: t.colors.danger }}>
            <Text style={[t.type("body"), { color: t.colors.danger }]}>{error}</Text>
          </FurlCard>
        ) : null}
        {notice ? (
          <Text style={[t.type("caption"), { color: t.colors.success }]}>{notice}</Text>
        ) : null}

        <FurlSectionHeader title={tr("tokens.title")} />
        {tokens.length === 0 ? (
          <FurlEmptyState icon="pricetag-outline" title={tr("tokens.empty")} body={tr("tokens.emptyBody")} />
        ) : (
          tokens.map((token) => (
            <FurlCard key={token.id}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: t.spacing.sm }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={t.type("body")}>{token.symbol}</Text>
                  <Text style={[t.type("caption"), { color: t.colors.textDim }]} numberOfLines={1}>
                    {token.name} · {CHAINS[token.chain]?.name ?? token.chain}
                  </Text>
                  {/* On every row, in the subtitle position — not a badge in a
                      corner. A user-added token must never be able to pass for
                      one FurlPay vouches for. */}
                  {!token.verified ? (
                    <Text style={[t.type("caption"), { color: t.colors.warning }]}>
                      {tr("tokens.unverified")}
                    </Text>
                  ) : null}
                </View>
                <Pressable
                  onPress={() => confirmRemove(token)}
                  hitSlop={12}
                  accessibilityRole="button"
                  accessibilityLabel={tr("tokens.remove")}
                >
                  <Ionicons name="trash-outline" size={t.component.icon.md} color={t.colors.textDim} />
                </Pressable>
              </View>
            </FurlCard>
          ))
        )}

        {discoveryEnabled ? (
          <>
            <FurlSectionHeader title={tr("tokens.scan")} />
            {scan ? (
              <Text style={[t.type("caption"), { color: scan.failures.length ? t.colors.warning : t.colors.textDim }]}>
                {scan.failures.length > 0
                  ? tr("tokens.partialScan", { failed: scan.failures.length, chains: scan.scannedChains })
                  : tr("tokens.scanned", { chains: scan.scannedChains })}
              </Text>
            ) : (
              <Text style={[t.type("caption"), { color: t.colors.textDim }]}>{tr("tokens.neverScanned")}</Text>
            )}

            {discovered.length === 0 && !scanning ? (
              <FurlEmptyState
                icon="search-outline"
                title={tr("tokens.noBalances")}
                body={tr("tokens.noBalancesBody")}
              />
            ) : (
              discovered.map((asset) => (
                <FurlCard key={asset.id}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", gap: t.spacing.sm }}>
                    <View style={{ gap: 2, flex: 1 }}>
                      <Text style={t.type("body")}>{asset.symbol}</Text>
                      <Text style={[t.type("caption"), { color: t.colors.textDim }]}>
                        {CHAINS[asset.chain]?.name ?? asset.chain}
                      </Text>
                    </View>
                    <Text style={t.type("body")}>{formatUnits(asset.rawBalance, asset.decimals)}</Text>
                  </View>
                </FurlCard>
              ))
            )}

            {/* Which reads failed, named. "3 of 4 networks checked" without
                saying WHICH one is an admission with no remedy attached. */}
            {scan && scan.failures.length > 0 ? (
              <FurlCard style={{ borderColor: t.colors.warning }}>
                <View style={{ gap: 2 }}>
                  {scan.failures.map((f, i) => (
                    <Text key={`${f.chain}-${f.symbol}-${i}`} style={[t.type("caption"), { color: t.colors.textDim }]}>
                      {CHAINS[f.chain]?.name ?? f.chain} · {f.symbol} — {f.reason}
                    </Text>
                  ))}
                </View>
              </FurlCard>
            ) : null}

            <FurlButton
              title={scanning ? tr("tokens.scanning") : tr("tokens.scan")}
              loading={scanning}
              onPress={() => void runScan()}
            />
          </>
        ) : null}
      </ScrollView>
    </FurlScreen>
  );
}

/**
 * Fixed-point rendering, exact.
 *
 * bigint division and a string tail — never `Number(raw) / 10 ** decimals`,
 * which loses precision above 2^53 and would misreport exactly the large
 * balances a user most wants to see correctly. Trailing zeros are trimmed, and
 * the fraction is capped at six places because a token with 18 decimals renders
 * an unreadable wall otherwise.
 */
export function formatUnits(raw: bigint, decimals: number, maxFractionDigits = 6): string {
  if (decimals <= 0) return raw.toString();
  const base = 10n ** BigInt(decimals);
  const whole = raw / base;
  const fraction = (raw % base).toString().padStart(decimals, "0").slice(0, maxFractionDigits).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

/** SQLite reads must not take the screen down — an empty list is recoverable. */
function safeList(): CustomToken[] {
  try {
    return listCustomTokens();
  } catch {
    return [];
  }
}

function safeCached(): DiscoveredAsset[] {
  try {
    return cachedAssets();
  } catch {
    return [];
  }
}
