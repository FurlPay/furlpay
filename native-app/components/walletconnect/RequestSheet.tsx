import React, { useState } from "react";
import { Text, View } from "react-native";
import { FurlBottomSheet, FurlButton, FurlCard, FurlSecondaryButton } from "@/components/furl";
import { useTheme } from "@/lib/design";
import { useI18n } from "@/lib/i18n";
import { hostOf } from "@/lib/walletconnect/engine";
import { chainNameFromCaip } from "@/lib/walletconnect/policy";
import { currentEngine } from "@/lib/walletconnect/runtime";
import { short } from "@/lib/txscan";
import { RiskFindings } from "./RiskFindings";
import type { PendingRequest } from "@/lib/walletconnect/engine";

// ---------------------------------------------------------------------------
// The confirmation sheet — the last thing between a dApp and the user's key.
//
// THE ONE RULE THIS FILE OBEYS: IT RENDERS THE DECODED INTENT AND NOTHING ELSE.
// Every field shown comes from `pending.intent`, which is the same object
// lib/walletconnect/runtime.ts signs. There is no branch here that could show
// one thing while the signer signs another — the classic wallet confirmation
// bug, and the reason the decode lives in requests.ts as a pure function rather
// than inline in this component.
//
// A DANGEROUS TRANSACTION NEEDS A SECOND, DIFFERENT ACTION. `danger` findings
// gate approval behind an explicit acknowledgement toggle, not behind a second
// tap on the same button. A second tap in the same place is muscle memory, not
// consent, and this is the transaction class where the difference is a drained
// wallet.
//
// NOTHING IS PRE-SELECTED. The approve button never has focus, the
// acknowledgement never starts checked, and there is no "remember this site".
// ---------------------------------------------------------------------------

export function RequestSheet({ pending }: { pending: PendingRequest }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const [busy, setBusy] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { request, intent, scan, session } = pending;
  const host = hostOf(session.dapp.url);
  const needsAcknowledgement = scan.level === "danger";

  const title =
    intent.kind === "transaction"
      ? tr("walletConnect.transactionRequest")
      : intent.kind === "switch_chain"
        ? tr("walletConnect.networkSwitch")
        : tr("walletConnect.signatureRequest");

  const decide = async (approve: boolean) => {
    const engine = currentEngine();
    if (!engine) return;
    setBusy(true);
    setError(null);
    try {
      if (approve) await engine.approveRequest(request.id);
      else await engine.rejectRequest(request.id);
    } catch (e) {
      // Shown, never swallowed. The engine has already told the dApp the
      // request failed; the user needs to know why their tap did nothing.
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <FurlBottomSheet open onClose={() => void decide(false)} title={title}>
      <View style={{ gap: t.spacing.md }}>
        <View style={{ gap: 2 }}>
          <Text style={[t.type("caption"), { color: t.colors.textDim }]}>{host}</Text>
          <Text style={[t.type("caption"), { color: t.colors.textDim }]}>
            {chainNameFromCaip(request.chainId)}
          </Text>
        </View>

        {intent.kind === "transaction" ? (
          <FurlCard>
            <View style={{ gap: t.spacing.xs }}>
              <Row label={tr("money.to")} value={short(intent.to)} />
              {intent.value > 0n ? <Row label={tr("money.amount")} value={formatWei(intent.value)} /> : null}
              {/* Calldata presence is stated rather than dumped. Four hundred
                  characters of hex is not information a user can act on, and
                  showing it implies they were given the chance to read it. What
                  the call DOES is the scanner's job, above. */}
              {intent.data !== "0x" ? (
                <Row label="Data" value={`${(intent.data.length - 2) / 2} bytes`} />
              ) : null}
            </View>
          </FurlCard>
        ) : null}

        {intent.kind === "personal_sign" ? (
          <FurlCard>
            <View style={{ gap: t.spacing.xs }}>
              <Text style={[t.type("caption"), { color: t.colors.textDim }]}>
                {tr("walletConnect.message")}
              </Text>
              {intent.messageText !== undefined ? (
                <Text style={t.type("body")}>{intent.messageText}</Text>
              ) : (
                // A message that is not clean printable UTF-8 is shown as an
                // explicit warning, never as a lossy best-effort string.
                // Rendering replacement characters would let a user read
                // something other than what they sign.
                <Text style={[t.type("body"), { color: t.colors.warning }]}>
                  {tr("walletConnect.binaryMessage")}
                </Text>
              )}
            </View>
          </FurlCard>
        ) : null}

        {intent.kind === "typed_data" ? (
          <FurlCard>
            <View style={{ gap: t.spacing.xs }}>
              <Row label="Type" value={intent.primaryType} />
              {typeof intent.domain.name === "string" ? (
                <Row label="Domain" value={intent.domain.name} />
              ) : null}
              {intent.isPermit ? (
                <Text style={[t.type("body"), { color: t.colors.warning }]}>
                  {tr("walletConnect.permitWarning")}
                </Text>
              ) : null}
            </View>
          </FurlCard>
        ) : null}

        {intent.kind === "switch_chain" ? (
          <FurlCard>
            <Row label={tr("walletConnect.networks")} value={chainNameFromCaip(`eip155:${intent.chainId}`)} />
          </FurlCard>
        ) : null}

        <RiskFindings scan={scan} />

        {error ? <Text style={[t.type("caption"), { color: t.colors.danger }]}>{error}</Text> : null}

        {needsAcknowledgement ? (
          <FurlCard onPress={() => setAcknowledged((v) => !v)} style={{ borderColor: t.colors.danger }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: t.spacing.sm }}>
              <View
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 6,
                  borderWidth: 2,
                  borderColor: t.colors.danger,
                  backgroundColor: acknowledged ? t.colors.danger : "transparent",
                }}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: acknowledged }}
              />
              <Text style={[t.type("body"), { flex: 1 }]}>{tr("walletConnect.acknowledge")}</Text>
            </View>
          </FurlCard>
        ) : null}

        <View style={{ gap: t.spacing.sm }}>
          <FurlButton
            title={busy ? tr("walletConnect.signing") : tr("walletConnect.approve")}
            loading={busy}
            // Gated on the acknowledgement, and coloured as destructive when
            // the scan says so — the approve button on a drain attempt must not
            // look like the approve button on a swap.
            disabled={busy || (needsAcknowledgement && !acknowledged)}
            tone={scan.level === "danger" ? "danger" : "primary"}
            onPress={() => void decide(true)}
          />
          <FurlSecondaryButton
            title={tr("walletConnect.reject")}
            disabled={busy}
            onPress={() => void decide(false)}
          />
        </View>
      </View>
    </FurlBottomSheet>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
      <Text style={[t.type("caption"), { color: t.colors.textDim }]}>{label}</Text>
      <Text style={[t.type("body"), { flexShrink: 1, textAlign: "right" }]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

/**
 * Wei as a decimal string, exactly.
 *
 * Integer arithmetic on bigint throughout — `Number(wei) / 1e18` loses
 * precision above 2^53 and would render an amount the user did not agree to.
 * Trailing zeros are trimmed so 1 ETH reads as "1", not "1.000000000000000000".
 */
function formatWei(wei: bigint): string {
  const whole = wei / 10n ** 18n;
  const frac = (wei % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}
