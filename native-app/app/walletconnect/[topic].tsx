import React, { useCallback, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { FurlButton, FurlCard, FurlEmptyState, FurlScreen, FurlSectionHeader } from "@/components/furl";
import { useTheme } from "@/lib/design";
import { useI18n } from "@/lib/i18n";
import { useSecureScreen } from "@/lib/secureScreen";
import { hostOf } from "@/lib/walletconnect/engine";
import { chainNameFromCaip } from "@/lib/walletconnect/policy";
import { useWalletConnect } from "@/lib/walletconnect/useWalletConnect";

// ---------------------------------------------------------------------------
// One connected site.
//
// THE PAGE IS A PERMISSION RECEIPT. It answers, in order: who holds this grant,
// on which networks, to do what, since when, and until when — and then offers
// exactly one action, which is to take it away.
//
// EXPIRY IS SHOWN, not hidden. A WalletConnect session has a deadline and users
// consistently assume "connected" means "forever". Showing the date is what
// makes a site silently vanishing from the list next week explicable rather
// than alarming.
//
// A MISSING SESSION IS A NORMAL OUTCOME, not an error. The dApp may have
// disconnected while this screen was open, or the session may have expired
// between the list and the tap. Either way the honest answer is "this is gone",
// not a crash and not a stale render of a permission that no longer exists.
// ---------------------------------------------------------------------------

export default function WalletConnectSessionScreen() {
  useSecureScreen("walletconnect-session");

  const { topic } = useLocalSearchParams<{ topic: string }>();
  const router = useRouter();
  const t = useTheme();
  const { t: tr } = useI18n();
  const { sessions, engine } = useWalletConnect();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const session = sessions.find((s) => s.topic === topic);

  const disconnect = useCallback(async () => {
    if (!engine || !session) return;
    setBusy(true);
    setError(null);
    try {
      await engine.disconnect(session.topic, "user");
      router.back();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [engine, router, session]);

  if (!session) {
    return (
      <FurlScreen>
        <FurlEmptyState
          icon="link-outline"
          title={tr("walletConnect.disconnected")}
          body={tr("walletConnect.noSessionsBody")}
        />
      </FurlScreen>
    );
  }

  const host = hostOf(session.dapp.url);
  const claimedOrigin = session.dapp.verified?.origin;
  const mismatched = Boolean(claimedOrigin && claimedOrigin.toLowerCase() !== host);

  return (
    <FurlScreen>
      <ScrollView contentContainerStyle={{ padding: t.spacing.lg, gap: t.spacing.md }}>
        <View style={{ gap: 2 }}>
          <Text style={t.type("h1")}>{session.dapp.name || host}</Text>
          <Text style={[t.type("caption"), { color: t.colors.textDim }]}>{host}</Text>
        </View>

        {mismatched ? (
          <FurlCard style={{ borderColor: t.colors.danger }}>
            <Text style={[t.type("body"), { color: t.colors.danger }]}>
              {tr("walletConnect.originMismatch", { claimed: host, actual: claimedOrigin ?? "" })}
            </Text>
          </FurlCard>
        ) : null}

        <FurlSectionHeader title={tr("walletConnect.networks")} />
        <FurlCard>
          <Text style={t.type("body")}>{session.chains.map(chainNameFromCaip).join("\n")}</Text>
        </FurlCard>

        <FurlSectionHeader title={tr("walletConnect.permissions")} />
        <FurlCard>
          <View style={{ gap: 2 }}>
            {/* Exact method names, for the reason given in
                SessionProposalSheet: a friendly gloss is where a permission
                quietly gets understated. */}
            {session.methods.map((m) => (
              <Text key={m} style={t.type("body")}>
                {m}
              </Text>
            ))}
          </View>
        </FurlCard>

        <FurlCard>
          <View style={{ gap: t.spacing.xs }}>
            <Text style={[t.type("caption"), { color: t.colors.textDim }]}>
              {tr("walletConnect.connectedOn", { date: formatDate(session.connectedAt) })}
            </Text>
            <Text style={[t.type("caption"), { color: t.colors.textDim }]}>
              {tr("walletConnect.lastUsed", { date: formatDate(session.lastActivityAt) })}
            </Text>
            <Text style={[t.type("caption"), { color: t.colors.textDim }]}>
              {tr("walletConnect.expires", { date: formatDate(session.expiresAt) })}
            </Text>
          </View>
        </FurlCard>

        {error ? <Text style={[t.type("caption"), { color: t.colors.danger }]}>{error}</Text> : null}

        <FurlButton
          title={tr("walletConnect.disconnect")}
          tone="danger"
          loading={busy}
          onPress={() => void disconnect()}
        />
      </ScrollView>
    </FurlScreen>
  );
}

/**
 * A date, in the device's locale.
 *
 * Guarded: Hermes ships Intl on Android but its availability is not guaranteed
 * on every engine configuration (see lib/i18n/core.ts), and a permission
 * receipt must not fail to render because a date could not be formatted.
 */
function formatDate(ms: number): string {
  try {
    return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}
