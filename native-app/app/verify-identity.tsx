import React, { useCallback, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Linking from "expo-linking";
import * as Haptics from "expo-haptics";
import { ApiError } from "@/lib/api";
import {
  fetchKycStatus,
  runVerificationFlow,
  startVerification,
  type VerificationSession,
} from "@/lib/kyc";
import { colors, radius, spacing, type } from "@/lib/theme";
import { Button, ErrorNote, Screen, SectionHeader, Surface } from "@/components/ui";

// Identity verification screen.
//
// Before this existed the app showed `user.kycStatus` on the settings and
// security screens with no way to change it: a status the user could read and
// never act on. This is the missing half.
//
// The camera never opens in this process. Documents and selfies go to the
// provider's hosted flow in the system browser (see lib/kyc.ts for why), so
// this screen only ever handles a status string and a session id.
//
// It also never writes a status. Closing the browser proves the user reached
// the end of the flow, not that they passed it — the provider tells the SERVER
// over a signed webhook, and this screen re-reads the server's answer.

const STATUS_PRESENTATION: Record<
  string,
  { label: string; detail: string; icon: keyof typeof Ionicons.glyphMap; tone: string }
> = {
  approved: {
    label: "Verified",
    detail: "Your identity is confirmed. Full limits are unlocked.",
    icon: "shield-checkmark",
    tone: colors.neon,
  },
  pending: {
    label: "In review",
    detail: "We have your documents. Most checks finish in a few minutes.",
    icon: "hourglass",
    tone: colors.textFaint,
  },
  review: {
    label: "Manual review",
    detail: "A specialist is checking your submission. No action needed yet.",
    icon: "hourglass",
    tone: colors.textFaint,
  },
  rejected: {
    label: "Could not verify",
    detail: "We could not confirm your identity from what was submitted.",
    icon: "alert-circle",
    tone: colors.accent,
  },
  unverified: {
    label: "Not verified",
    detail: "Verify your identity to raise your limits.",
    icon: "shield-outline",
    tone: colors.textFaint,
  },
};

function presentationFor(status: string) {
  return STATUS_PRESENTATION[status?.toLowerCase()] ?? STATUS_PRESENTATION.unverified;
}

/** Human label for a machine requirement code, e.g. "government_id". */
function humanize(code: string): string {
  return code.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function VerifyIdentityScreen() {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<VerificationSession | null>(null);
  const [justSubmitted, setJustSubmitted] = useState(false);

  const statusQuery = useQuery({
    queryKey: ["kyc-status"],
    queryFn: fetchKycStatus,
  });

  const status = statusQuery.data?.kycStatus ?? "unverified";
  const view = presentationFor(status);
  const verified = status.toLowerCase() === "approved";

  const begin = useCallback(async () => {
    setBusy(true);
    setError(null);
    setJustSubmitted(false);
    try {
      // The region comes from the ACCOUNT, not from a picker. Letting the user
      // choose here would let them select a lighter regime than the one they
      // actually fall under; the server independently applies its country rules
      // and refuses blocked jurisdictions regardless of what we send.
      const region = statusQuery.data?.region;
      if (!region) {
        setError("We could not read your account region. Try again in a moment.");
        return;
      }
      const created = await startVerification(region);
      setSession(created);

      const outcome = await runVerificationFlow(created, Linking.createURL("/verify-identity"));

      if (outcome.status === "submitted") {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setJustSubmitted(true);
        // Re-read the SERVER's status. The webhook may not have landed yet, in
        // which case this still says pending — which is the truth.
        await queryClient.invalidateQueries({ queryKey: ["kyc-status"] });
      } else if (outcome.status === "unavailable") {
        setError(outcome.reason);
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        setError("Identity verification is not available in your region yet.");
      } else if (e instanceof ApiError) {
        setError(e.correlationId ? `${e.message} (ref ${e.correlationId.slice(0, 8)})` : e.message);
      } else {
        setError((e as Error).message);
      }
    } finally {
      setBusy(false);
    }
  }, [queryClient, statusQuery.data]);

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}>
        <SectionHeader title="Identity verification" />

        <Surface style={styles.statusCard}>
          <Ionicons name={view.icon} size={40} color={view.tone} />
          <Text style={[type.h2, { marginTop: spacing.sm }]}>{view.label}</Text>
          <Text style={[type.dim, styles.centered]}>{view.detail}</Text>
          {statusQuery.data?.tier ? (
            <View style={styles.tierPill}>
              <Text style={styles.tierText}>{statusQuery.data.tier} tier</Text>
            </View>
          ) : null}
        </Surface>

        {justSubmitted ? (
          <Surface style={styles.note}>
            <Text style={type.body}>Submitted.</Text>
            <Text style={type.dim}>
              The result arrives from our verification partner, usually within a few minutes. You
              can close this screen — we will update your account automatically.
            </Text>
          </Surface>
        ) : null}

        {session && !verified ? (
          <Surface style={{ gap: spacing.sm }}>
            <Text style={[type.body, { fontWeight: "600" }]}>What you will need</Text>
            {session.requiredDocs.map((d) => (
              <View key={d} style={styles.reqRow}>
                <Ionicons name="document-text-outline" size={16} color={colors.textFaint} />
                <Text style={type.dim}>{humanize(d)}</Text>
              </View>
            ))}
            {session.requiredChecks.map((c) => (
              <View key={c} style={styles.reqRow}>
                <Ionicons name="checkmark-circle-outline" size={16} color={colors.textFaint} />
                <Text style={type.dim}>{humanize(c)}</Text>
              </View>
            ))}
            {session.eddRequired ? (
              <Text style={type.dim}>
                Your region requires enhanced checks, so this takes a little longer.
              </Text>
            ) : null}
          </Surface>
        ) : null}

        <ErrorNote message={error} />

        {!verified ? (
          <>
            <Button
              title={status === "rejected" ? "Try again" : "Start verification"}
              onPress={begin}
              loading={busy}
              disabled={busy}
            />
            {/* Said plainly, because a request for a passport photo has to
                explain itself or it reads like a phishing screen. */}
            <Text style={[type.dim, styles.centered]}>
              Your ID and selfie go directly to our verification partner in a secure browser.
              FurlPay never receives or stores them.
            </Text>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  statusCard: { alignItems: "center", gap: spacing.xs, paddingVertical: spacing.xl },
  centered: { textAlign: "center" },
  tierPill: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
  },
  tierText: { color: colors.textFaint, fontSize: 12, fontWeight: "600" },
  note: { gap: spacing.xs },
  reqRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
});
