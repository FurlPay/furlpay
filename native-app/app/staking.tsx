import React, { useCallback, useState } from "react";
import { Linking, RefreshControl, ScrollView, Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FurlButton,
  FurlCard,
  FurlEmptyState,
  FurlErrorState,
  FurlInput,
  FurlScreen,
  FurlSectionHeader,
  FurlSecondaryButton,
  FurlSkeletonList,
} from "@/components/furl";
import { useTheme } from "@/lib/design";
import { useI18n } from "@/lib/i18n";
import { useFlag } from "@/lib/flags";
import { useSecureScreen } from "@/lib/secureScreen";
import { authorizeMoneyMove } from "@/lib/money/authorize";
import { track, bucketUsd } from "@/lib/analytics";
import { getKnownAddress } from "@/lib/wallet";
import { defaultSigner } from "@/lib/signing/registry";
import { estimateGas, getBalance, getFeeCaps, getTransactionCount, sendRawTransaction } from "@/lib/evm/rpc";
import { chainSlugFor } from "@/lib/tokens/customTokens";
import { formatUnits } from "@/app/tokens";
import { fetchStakingProtocols } from "@/lib/staking/api";
import { encodeStake, StakingError } from "@/lib/staking/onchain";
import { isStakable, type StakingProtocol } from "@/lib/staking/types";
import type { StakingInterface } from "@/lib/staking/onchain";

// ---------------------------------------------------------------------------
// Staking.
//
// THE SCREEN'S FIRST JOB IS TO NOT MISLEAD. Everything a user is about to do
// here involves handing assets to a protocol FurlPay does not operate, for a
// reward FurlPay does not pay, with an exit FurlPay does not control. So the
// copy says "liquid staking" and names the protocol, the risks are shown before
// the amount field rather than behind a disclosure link, and the difference
// from FurlPay Earn is stated in full rather than left for the user to work out
// from two similar-looking yield numbers.
//
// NOTHING IS INVENTED. The APR comes from the server or renders as "rate
// unavailable"; the balance is a chain read; the contract address is one a
// person verified against the protocol's own documentation. An unverified
// protocol cannot be staked into and says why.
// ---------------------------------------------------------------------------

/** Chain slug -> EIP-155 id. Mirrors the NFT screen's map. */
function chainIdOf(chain: string): number {
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
      throw new StakingError("unsupported_interface", `No chain id for ${chain}.`);
  }
}

type Protocol = StakingProtocol & { contractInterface: StakingInterface };

export default function StakingScreen() {
  useSecureScreen("staking");

  const t = useTheme();
  const { t: tr } = useI18n();
  const qc = useQueryClient();
  const enabled = useFlag("staking_ui");

  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [hashes, setHashes] = useState<Record<string, string>>({});

  const owner = useQuery({
    queryKey: ["wallet", "address"],
    queryFn: () => getKnownAddress(),
    staleTime: 5 * 60_000,
  });

  const catalogue = useQuery({
    queryKey: ["staking", "protocols"],
    queryFn: fetchStakingProtocols,
    enabled,
    staleTime: 60_000,
  });

  const stake = useCallback(
    async (protocol: Protocol) => {
      const key = protocol.id;
      setErrors((e) => ({ ...e, [key]: "" }));

      const gate = isStakable(protocol);
      if (!gate.ok) {
        setErrors((e) => ({ ...e, [key]: gate.reason }));
        return;
      }
      if (!owner.data) return;

      const raw = (amounts[key] ?? "").trim();
      const asNumber = Number(raw);
      if (!Number.isFinite(asNumber) || asNumber <= 0) {
        setErrors((e) => ({ ...e, [key]: tr("staking.invalidAmount") }));
        return;
      }

      // Parsed as a decimal string into wei, never via floating point — a
      // float multiplication by 1e18 loses precision and stakes an amount the
      // user did not type.
      let amountWei: bigint;
      try {
        amountWei = parseUnits(raw, 18);
      } catch {
        setErrors((e) => ({ ...e, [key]: tr("staking.invalidAmount") }));
        return;
      }

      const slug = chainSlugFor(protocol.chain);
      if (!slug) {
        setErrors((e) => ({ ...e, [key]: tr("staking.failed") }));
        return;
      }

      const decision = await authorizeMoneyMove({
        action: "send_funds",
        amountUsd: 0,
        reason: tr("staking.stake"),
      });
      if (!decision.ok) {
        if (decision.kind !== "declined") setErrors((e) => ({ ...e, [key]: decision.message }));
        return;
      }

      setBusy(key);
      try {
        const { data, value } = encodeStake({
          interface: protocol.contractInterface,
          amount: amountWei,
          receiver: owner.data,
        });

        // Checked against the CHAIN, not against a cached figure: staking more
        // than the balance reverts after the user has paid gas, and the balance
        // may have moved since the screen loaded.
        const balance = await getBalance(slug, owner.data);
        if (value > 0n && balance <= value) {
          setErrors((e) => ({
            ...e,
            [key]: tr("staking.insufficient", { asset: protocol.assetSymbol }),
          }));
          return;
        }

        const [nonce, fees] = await Promise.all([
          getTransactionCount(slug, owner.data),
          getFeeCaps(slug),
        ]);

        const gasLimit = await estimateGas(slug, {
          from: owner.data,
          to: protocol.contract!,
          data,
          value: value > 0n ? `0x${value.toString(16)}` : "0x0",
        });

        track("stake_submitted", { chain: protocol.chain, bucket: bucketUsd(asNumber) });

        const signed = await defaultSigner().signTransaction({
          chainId: chainIdOf(protocol.chain),
          nonce,
          maxFeePerGas: fees.maxFeePerGas,
          maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
          gasLimit,
          to: protocol.contract!,
          value,
          data,
        });

        const hash = await sendRawTransaction(slug, signed.raw);
        setHashes((h) => ({ ...h, [key]: hash }));
        setAmounts((a) => ({ ...a, [key]: "" }));
        track("stake_settled", { chain: protocol.chain, outcome: "success" });
        void qc.invalidateQueries({ queryKey: ["staking"] });
      } catch (e) {
        track("stake_settled", { chain: protocol.chain, outcome: "failure" });
        setErrors((err) => ({ ...err, [key]: (e as Error).message }));
      } finally {
        setBusy(null);
      }
    },
    [amounts, owner.data, qc, tr],
  );

  if (!enabled) {
    return (
      <FurlScreen>
        <FurlEmptyState icon="lock-closed-outline" title={tr("staking.unavailable")} body={tr("staking.unavailableBody")} />
      </FurlScreen>
    );
  }

  return (
    <FurlScreen>
      <ScrollView
        contentContainerStyle={{ padding: t.spacing.lg, gap: t.spacing.md }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={catalogue.isRefetching}
            onRefresh={() => void catalogue.refetch()}
            tintColor={t.colors.primary}
          />
        }
      >
        <Text style={[t.type("dim"), { color: t.colors.textDim }]}>{tr("staking.subtitle")}</Text>

        {/* Stated up front, not behind a disclosure link. The user is trusting a
            protocol, and which protocol is the most important fact here. */}
        <FurlCard style={{ borderColor: t.colors.warning }}>
          <View style={{ gap: t.spacing.xs }}>
            <Text style={[t.type("body"), { color: t.colors.warning }]}>{tr("staking.liquidNotice")}</Text>
            <Text style={[t.type("caption"), { color: t.colors.textDim }]}>{tr("staking.vsEarn")}</Text>
          </View>
        </FurlCard>

        {catalogue.isLoading ? (
          <FurlSkeletonList rows={3} />
        ) : catalogue.error ? (
          <FurlErrorState
            title={tr("staking.loadError")}
            error={catalogue.error}
            onAction={() => void catalogue.refetch()}
            actionLabel={tr("state.retry")}
          />
        ) : !catalogue.data?.configured ? (
          // Honest: the protocols exist, none has a verified address here.
          <FurlEmptyState
            icon="shield-outline"
            title={tr("staking.unavailable")}
            body={tr("staking.unavailableBody")}
          />
        ) : (
          catalogue.data.protocols.map((protocol) => {
            const gate = isStakable(protocol);
            const key = protocol.id;
            return (
              <View key={key} style={{ gap: t.spacing.sm }}>
                <FurlSectionHeader title={protocol.name} />
                <FurlCard>
                  <View style={{ gap: t.spacing.xs }}>
                    <Row
                      label={tr("staking.apr")}
                      value={
                        protocol.aprPercent === null
                          ? tr("staking.aprUnknown")
                          : `${protocol.aprPercent.toFixed(2)}%`
                      }
                    />
                    <Row
                      label={tr("staking.unbonding", { days: protocol.unbondingDays ?? 0 })}
                      value={
                        protocol.exit === "withdrawal_queue" ? tr("staking.exitQueue") : tr("staking.exitMarket")
                      }
                    />
                    {protocol.sourceUrl ? (
                      <FurlSecondaryButton
                        title={tr("staking.sourceLabel")}
                        size="sm"
                        stretch={false}
                        onPress={() => void Linking.openURL(protocol.sourceUrl!)}
                      />
                    ) : null}
                  </View>
                </FurlCard>

                {!gate.ok ? (
                  <FurlCard style={{ borderColor: t.colors.danger }}>
                    <View style={{ gap: 2 }}>
                      <Text style={[t.type("body"), { color: t.colors.danger }]}>{tr("staking.unverified")}</Text>
                      <Text style={[t.type("caption"), { color: t.colors.textDim }]}>{gate.reason}</Text>
                    </View>
                  </FurlCard>
                ) : (
                  <>
                    {protocol.risks.length > 0 ? (
                      <FurlCard>
                        <View style={{ gap: 4 }}>
                          <Text style={[t.type("caption"), { color: t.colors.textDim }]}>
                            {tr("staking.risks")}
                          </Text>
                          {protocol.risks.map((risk) => (
                            <Text key={risk} style={t.type("caption")}>
                              · {risk}
                            </Text>
                          ))}
                        </View>
                      </FurlCard>
                    ) : null}

                    <FurlInput
                      label={tr("staking.amount")}
                      value={amounts[key] ?? ""}
                      onChangeText={(v) => setAmounts((a) => ({ ...a, [key]: v }))}
                      keyboardType="decimal-pad"
                      placeholder="0.0"
                    />

                    {errors[key] ? (
                      <FurlCard style={{ borderColor: t.colors.danger }}>
                        <Text style={[t.type("body"), { color: t.colors.danger }]}>{errors[key]}</Text>
                      </FurlCard>
                    ) : null}
                    {hashes[key] ? (
                      <Text style={[t.type("caption"), { color: t.colors.success }]} selectable>
                        {tr("staking.staked")} · {hashes[key]}
                      </Text>
                    ) : null}

                    <FurlButton
                      title={busy === key ? tr("staking.staking") : tr("staking.stake")}
                      loading={busy === key}
                      disabled={busy !== null || !(amounts[key] ?? "").trim()}
                      onPress={() => void stake(protocol)}
                    />

                    {/* Named plainly rather than left for the user to discover
                        when they try to exit. */}
                    <Text style={[t.type("caption"), { color: t.colors.textDim }]}>
                      {protocol.contractInterface === "erc4626"
                        ? tr("staking.queueWarning")
                        : tr("staking.manualExit")}
                    </Text>
                  </>
                )}
              </View>
            );
          })
        )}
      </ScrollView>
    </FurlScreen>
  );
}

/**
 * Decimal string -> raw units, exactly.
 *
 * String arithmetic throughout. `Number(raw) * 1e18` loses precision above
 * 2^53, and on a staking screen that silently stakes an amount the user did not
 * type. Extra fractional digits are an error rather than being truncated —
 * quietly dropping a digit changes the amount.
 */
export function parseUnits(raw: string, decimals: number): bigint {
  const trimmed = raw.trim();
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === "" || trimmed === ".") {
    throw new Error("Not a number.");
  }
  const [whole, fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals) throw new Error("Too many decimal places.");
  const padded = fraction.padEnd(decimals, "0");
  return BigInt(`${whole || "0"}${padded}`);
}

function Row({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
      <Text style={[t.type("caption"), { color: t.colors.textDim, flexShrink: 1 }]}>{label}</Text>
      <Text style={[t.type("body"), { flexShrink: 1, textAlign: "right" }]}>{value}</Text>
    </View>
  );
}

export { formatUnits };
