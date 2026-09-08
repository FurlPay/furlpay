import React, { useState } from "react";
import { Text, View } from "react-native";
import { FurlBottomSheet, FurlButton, FurlCard, FurlSecondaryButton } from "@/components/furl";
import { useTheme } from "@/lib/design";
import { useI18n } from "@/lib/i18n";
import { hostOf } from "@/lib/walletconnect/engine";
import { chainNameFromCaip } from "@/lib/walletconnect/policy";
import { currentEngine } from "@/lib/walletconnect/runtime";
import type { PendingProposal } from "@/lib/walletconnect/engine";

// ---------------------------------------------------------------------------
// "This site wants to connect."
//
// THE SCREEN IS ABOUT WHAT IS BEING GRANTED, not about the site's branding. A
// dApp supplies its own name and icon, so a phishing clone supplies the real
// one's. Rendering that large and trusted at the top — which is what most
// wallets do — puts the attacker's chosen artwork in the position of highest
// credibility on the screen.
//
// So the host the RELAY OBSERVED is shown with equal weight to the name the
// site claims, and when the two disagree the mismatch outranks both. That is
// the one fact on this sheet an impersonator cannot control.
//
// AN UNAPPROVABLE PROPOSAL STILL RENDERS. It would be simpler to auto-reject a
// proposal asking for a chain we do not support, but the user is standing in
// front of a site that just showed them a QR code, and silence is the one
// outcome they cannot debug. The sheet says which network or method FurlPay
// cannot provide and offers only "reject".
// ---------------------------------------------------------------------------

export function SessionProposalSheet({ pending }: { pending: PendingProposal }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { proposal, decision } = pending;
  const host = hostOf(proposal.dapp.url);
  const verified = proposal.dapp.verified;
  const mismatched = Boolean(verified?.origin && verified.origin.toLowerCase() !== host);
  const flagged = verified?.isScam === true || verified?.validation === "INVALID";

  const decide = async (approve: boolean) => {
    const engine = currentEngine();
    if (!engine) return;
    setBusy(true);
    setError(null);
    try {
      if (approve) await engine.approveProposal(proposal.id);
      else await engine.rejectProposal(proposal.id, decision.approvable ? "user" : "unsupported");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <FurlBottomSheet open onClose={() => void decide(false)} title={tr("walletConnect.proposalTitle")}>
      <View style={{ gap: t.spacing.md }}>
        <Text style={t.type("body")}>
          {tr("walletConnect.proposalBody", { site: proposal.dapp.name || host })}
        </Text>
        <Text style={[t.type("caption"), { color: t.colors.textDim }]}>{host}</Text>

        {flagged ? (
          <FurlCard style={{ borderColor: t.colors.danger }}>
            <Text style={[t.type("body"), { color: t.colors.danger }]}>{tr("walletConnect.flaggedSite")}</Text>
          </FurlCard>
        ) : null}

        {mismatched ? (
          <FurlCard style={{ borderColor: t.colors.danger }}>
            <Text style={[t.type("body"), { color: t.colors.danger }]}>
              {tr("walletConnect.originMismatch", { claimed: host, actual: verified?.origin ?? "" })}
            </Text>
          </FurlCard>
        ) : null}

        {decision.approvable ? (
          <>
            <FurlCard>
              <View style={{ gap: t.spacing.xs }}>
                <Text style={[t.type("caption"), { color: t.colors.textDim }]}>
                  {tr("walletConnect.networks")}
                </Text>
                <Text style={t.type("body")}>{decision.chains.map(chainNameFromCaip).join(", ")}</Text>
              </View>
            </FurlCard>

            <FurlCard>
              <View style={{ gap: t.spacing.xs }}>
                <Text style={[t.type("caption"), { color: t.colors.textDim }]}>
                  {tr("walletConnect.permissions")}
                </Text>
                {/* The raw method names. A friendlier gloss would be nicer to
                    read and would also be the place a translation could quietly
                    understate what is granted — "sign in" for
                    eth_sendTransaction. The exact strings are what the session
                    actually carries. */}
                {decision.methods.map((m) => (
                  <Text key={m} style={t.type("body")}>
                    {m}
                  </Text>
                ))}
              </View>
            </FurlCard>

            {decision.droppedOptional.length > 0 ? (
              <Text style={[t.type("caption"), { color: t.colors.textDim }]}>
                {tr("walletConnect.alsoAsked", { details: decision.droppedOptional.join(", ") })}
              </Text>
            ) : null}
          </>
        ) : (
          <FurlCard style={{ borderColor: t.colors.warning }}>
            <View style={{ gap: t.spacing.xs }}>
              <Text style={t.type("body")}>{tr("walletConnect.cannotConnect")}</Text>
              <Text style={[t.type("caption"), { color: t.colors.textDim }]}>
                {tr("walletConnect.cannotConnectBody", {
                  details: decision.unsupportedRequired.join(", "),
                })}
              </Text>
            </View>
          </FurlCard>
        )}

        {error ? <Text style={[t.type("caption"), { color: t.colors.danger }]}>{error}</Text> : null}

        <View style={{ gap: t.spacing.sm }}>
          {decision.approvable ? (
            <FurlButton
              title={tr("walletConnect.approve")}
              loading={busy}
              // A flagged or impersonating site gets the destructive tone. The
              // action is still available — it is the user's wallet — but it
              // must not look like the ordinary, expected next tap.
              tone={flagged || mismatched ? "danger" : "primary"}
              onPress={() => void decide(true)}
            />
          ) : null}
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
