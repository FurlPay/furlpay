import React, { useCallback, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { Ionicons } from "@expo/vector-icons";
import { FurlButton, FurlCard, FurlEmptyState, FurlScreen, FurlSecondaryButton } from "@/components/furl";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/design";
import { useSecureScreen } from "@/lib/secureScreen";
import { hostOf } from "@/lib/walletconnect/engine";
import { chainNameFromCaip } from "@/lib/walletconnect/policy";
import { pairWithUri, useWalletConnect } from "@/lib/walletconnect/useWalletConnect";
import { SessionProposalSheet } from "@/components/walletconnect/SessionProposalSheet";
import { RequestSheet } from "@/components/walletconnect/RequestSheet";
import type { WalletConnectSession } from "@/lib/walletconnect/types";

// ---------------------------------------------------------------------------
// Connected sites.
//
// WHAT THIS SCREEN IS FOR. Not "a list of dApps" — a list of STANDING
// PERMISSIONS, and the place they can be taken away. Everything here serves
// that reading: each row says which networks and which request types the site
// holds, sorted by most recently used so the ones still in play are at the top,
// and disconnect is one tap from the row rather than buried in a detail screen.
//
// A user who cannot find where to revoke a connection has, in practice, not
// been given the ability to revoke it.
//
// THE PROPOSAL AND REQUEST SHEETS LIVE HERE because this is the screen that is
// open when a user scans a QR code. They are also mounted by the scanner
// (app/scan.tsx), so a request arriving while the user is elsewhere still lands
// somewhere — the engine holds the pending slot and whichever of the two
// mounts reads it.
// ---------------------------------------------------------------------------

export default function WalletConnectScreen() {
  // The list names every site holding a permission over this wallet, which is
  // exactly the screenshot a support-scam caller wants.
  useSecureScreen("walletconnect");

  const router = useRouter();
  const t = useTheme();
  const { t: tr } = useI18n();
  const { sessions, unavailable, startError, pendingProposal, pendingRequest, engine, refresh } =
    useWalletConnect();

  const [pairing, setPairing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pasteAndPair = useCallback(async () => {
    setError(null);
    const text = await Clipboard.getStringAsync();
    if (!text?.trim()) {
      setError(tr("walletConnect.pasteEmpty"));
      return;
    }
    setPairing(true);
    const outcome = await pairWithUri(text, "paste");
    setPairing(false);
    // The parser's message is shown verbatim: it distinguishes "expired",
    // "WalletConnect v1" and "not a link at all", and each sends the user
    // somewhere different. Collapsing them into one string would be the whole
    // point of the parser thrown away at the last step.
    if (!outcome.ok) setError(outcome.error.message);
  }, [tr]);

  const disconnect = useCallback(
    (session: WalletConnectSession) => {
      Alert.alert(session.dapp.name || hostOf(session.dapp.url), tr("walletConnect.disconnect"), [
        { text: tr("common.cancel"), style: "cancel" },
        {
          text: tr("walletConnect.disconnect"),
          style: "destructive",
          onPress: () => {
            void engine
              ?.disconnect(session.topic, "user")
              .catch((e: Error) => setError(e.message))
              .finally(refresh);
          },
        },
      ]);
    },
    [engine, refresh, tr],
  );

  const disconnectAll = useCallback(() => {
    Alert.alert(tr("walletConnect.disconnectAll"), tr("walletConnect.disconnectAllConfirm"), [
      { text: tr("common.cancel"), style: "cancel" },
      {
        text: tr("walletConnect.disconnectAll"),
        style: "destructive",
        onPress: () => {
          void engine?.disconnectAll().catch((e: Error) => setError(e.message)).finally(refresh);
        },
      },
    ]);
  }, [engine, refresh, tr]);

  // Unavailable is a real, explainable state — not an error and not a spinner.
  // Either the deployment has the feature off or this build has no SDK, and
  // both are true statements the user deserves instead of a screen that never
  // finishes loading.
  if (unavailable) {
    return (
      <FurlScreen>
        <FurlEmptyState
          icon="link-outline"
          title={tr("walletConnect.unavailable")}
          body={tr("walletConnect.unavailableBody")}
        />
      </FurlScreen>
    );
  }

  return (
    <FurlScreen>
      <ScrollView contentContainerStyle={[styles.content, { padding: t.spacing.lg, gap: t.spacing.md }]}>
        <Text style={[t.type("dim"), { color: t.colors.textDim }]}>{tr("walletConnect.subtitle")}</Text>

        <FurlCard>
          <View style={{ gap: t.spacing.sm }}>
            <Text style={t.type("body")}>{tr("walletConnect.scanPrompt")}</Text>
            <FurlButton
              title={tr("walletConnect.connect")}
              icon="qr-code-outline"
              onPress={() => router.push("/scan?mode=walletconnect")}
            />
            <FurlSecondaryButton
              title={pairing ? tr("walletConnect.connecting") : tr("walletConnect.paste")}
              icon="clipboard-outline"
              disabled={pairing}
              onPress={() => void pasteAndPair()}
            />
          </View>
        </FurlCard>

        {error || startError ? (
          <FurlCard style={{ borderColor: t.colors.danger }}>
            <Text style={[t.type("body"), { color: t.colors.danger }]}>{error ?? startError}</Text>
          </FurlCard>
        ) : null}

        {sessions.length === 0 ? (
          <FurlEmptyState
            icon="globe-outline"
            title={tr("walletConnect.noSessions")}
            body={tr("walletConnect.noSessionsBody")}
          />
        ) : (
          <View style={{ gap: t.spacing.sm }}>
            {sessions.map((session) => (
              <SessionRow
                key={session.topic}
                session={session}
                onPress={() => router.push(`/walletconnect/${session.topic}`)}
                onDisconnect={() => disconnect(session)}
              />
            ))}
            {/* FurlButton with the danger tone rather than
                FurlSecondaryButton, which is neutral by definition. Revoking
                every grant at once is destructive and should read that way. */}
            <FurlButton title={tr("walletConnect.disconnectAll")} tone="danger" onPress={disconnectAll} />
          </View>
        )}
      </ScrollView>

      {/* Both sheets read the engine's pending slot rather than receiving it
          through navigation params: a request that arrives while this screen is
          already open must not depend on a route change to be seen. */}
      {pendingProposal ? <SessionProposalSheet pending={pendingProposal} /> : null}
      {pendingRequest ? <RequestSheet pending={pendingRequest} /> : null}
    </FurlScreen>
  );
}

function SessionRow({
  session,
  onPress,
  onDisconnect,
}: {
  session: WalletConnectSession;
  onPress: () => void;
  onDisconnect: () => void;
}) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const host = hostOf(session.dapp.url);

  // The relay's observed origin versus the site's own claim. When they differ
  // the user is looking at an impersonation, and that must outrank the pretty
  // name the site chose for itself.
  const claimed = session.dapp.verified?.origin;
  const mismatched = Boolean(claimed && claimed.toLowerCase() !== host);

  return (
    <FurlCard onPress={onPress} accessibilityLabel={session.dapp.name || host}>
      <View style={styles.row}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={t.type("body")} numberOfLines={1}>
            {session.dapp.name || host}
          </Text>
          <Text style={[t.type("caption"), { color: t.colors.textDim }]} numberOfLines={1}>
            {host}
          </Text>
          <Text style={[t.type("caption"), { color: t.colors.textDim }]} numberOfLines={1}>
            {session.chains.map(chainNameFromCaip).join(" · ")}
          </Text>
          {mismatched ? (
            <Text style={[t.type("caption"), { color: t.colors.danger }]}>
              {tr("walletConnect.originMismatch", { claimed: host, actual: claimed ?? "" })}
            </Text>
          ) : null}
        </View>
        <Pressable
          onPress={onDisconnect}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={tr("walletConnect.disconnect")}
        >
          <Ionicons name="close-circle-outline" size={t.component.icon.lg} color={t.colors.textDim} />
        </Pressable>
      </View>
    </FurlCard>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
});
