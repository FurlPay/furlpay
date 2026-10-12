import React, { useEffect, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { api } from "@/lib/api";
import { exclusive } from "@/lib/exclusive";
import {
  amountLabel,
  classifyDecideError,
  parseQueue,
  payeeLabel,
  queueUnavailable,
  secondsLeft,
  type Decision,
  type HeldPayment,
} from "@/lib/heldPayments";
import { useSecureScreen } from "@/lib/secureScreen";
import { colors, spacing, type } from "@/lib/theme";
import { Button, EmptyState, ErrorNote, Screen, Sheet, Surface, SummaryRow } from "@/components/ui";

// Agent payments the control plane held for a human (lib/heldPayments.ts).
//
// Nothing here releases money on its own. Opening this screen, a push, or a
// returning step-up never decides anything: a person reviews the full payment
// in the sheet and taps Approve or Deny, and the server then demands a fresh
// step-up on this session for that one decision.

const QUEUE_KEY = ["held-payments"] as const;

function Countdown({ deadline, onTimeout }: { deadline: string | null; onTimeout: HeldPayment["onTimeout"] }) {
  const [left, setLeft] = useState(() => secondsLeft(deadline));
  useEffect(() => {
    const t = setInterval(() => setLeft(secondsLeft(deadline)), 1000);
    return () => clearInterval(t);
  }, [deadline]);
  if (left === null) return null;
  const outcome = onTimeout === "DENY" ? "denied" : "kept on hold";
  const text =
    left > 0
      ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} left, then ${outcome}`
      : `Window closed. ${onTimeout === "DENY" ? "The payment will not be released." : "Still on hold."}`;
  return <Text style={{ color: left < 60 ? colors.accent : colors.warning, fontWeight: "700" }}>{text}</Text>;
}

export default function HeldPayments() {
  useSecureScreen("held-payments");
  const router = useRouter();
  const qc = useQueryClient();
  const { data, isLoading, refetch, isRefetching, error } = useQuery({
    queryKey: QUEUE_KEY,
    queryFn: async () => parseQueue(await api<unknown>("/control-plane/approvals")),
    refetchInterval: 15_000,
    // Approval state must come from the server every time this screen is
    // looked at; a cached "pending" is not a fact.
    staleTime: 0,
  });
  const held = data ?? [];
  const [reviewing, setReviewing] = useState<HeldPayment | null>(null);
  const [busy, setBusy] = useState<Decision | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // The sheet shows the copy from the latest fetch. If the payment left the
  // queue while it was open (decided elsewhere, timed out), close it rather
  // than offer buttons for something that is no longer waiting.
  useEffect(() => {
    if (reviewing && data && !data.some((h) => h.id === reviewing.id)) {
      setReviewing(null);
      setMessage("That payment is no longer waiting for approval.");
    }
  }, [data, reviewing]);

  const decide = (h: HeldPayment, decision: Decision) =>
    exclusive(`held:${h.id}`, async () => {
      setMessage(null);
      setBusy(decision);
      try {
        await api(`/control-plane/approvals/${encodeURIComponent(h.id)}`, {
          method: "POST",
          body: { decision },
        });
        await Haptics.notificationAsync(
          decision === "APPROVE" ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning
        );
        setReviewing(null);
        setMessage(decision === "APPROVE" ? "Approved. The agent can now execute it." : "Denied. The payment will not be released.");
      } catch (e) {
        const failure = classifyDecideError(e);
        if (failure.kind === "step_up") {
          setReviewing(null);
          router.push({ pathname: "/step-up", params: { returnTo: "/held-payments" } } as never);
          return;
        }
        setMessage(failure.message);
        if (failure.kind !== "failed") setReviewing(null);
      } finally {
        setBusy(null);
        // Whatever happened, show what the server now says.
        await qc.invalidateQueries({ queryKey: QUEUE_KEY });
      }
    });

  const unavailable = error ? queueUnavailable(error) : null;

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={colors.neon} />}
      >
        <Text style={type.dim}>
          Payments your agents started that a policy held for a person. Each decision needs a fresh passkey or
          one-time code.
        </Text>
        <ErrorNote message={message} />

        {held.length === 0 ? (
          <EmptyState
            title={isLoading ? "Loading…" : unavailable ? unavailable.title : "Nothing waiting"}
            subtitle={unavailable ? unavailable.subtitle : "When a policy holds a payment for approval it appears here."}
          />
        ) : (
          held.map((h) => (
            <Surface key={h.id} style={{ gap: spacing.sm }}>
              <Text style={[type.h2, { fontSize: 24 }]} accessibilityLabel={`Amount ${amountLabel(h.payment)}`}>
                {amountLabel(h.payment)}
              </Text>
              <Text style={type.body} numberOfLines={1} ellipsizeMode="middle">
                To {payeeLabel(h.payment)}
              </Text>
              {h.payment.reason ? <Text style={type.dim}>Held because: {h.payment.reason}</Text> : null}
              <Countdown deadline={h.deadline} onTimeout={h.onTimeout} />
              <Button title="Review" variant="secondary" onPress={() => setReviewing(h)} />
            </Surface>
          ))
        )}
      </ScrollView>

      <Sheet open={reviewing !== null} title="Review payment" onClose={() => (busy ? undefined : setReviewing(null))}>
        {reviewing ? (
          <>
            <Text style={[type.h2, { fontSize: 28 }]}>{amountLabel(reviewing.payment)}</Text>
            {/* The full destination, never ellipsized: an address that differs
                only in the middle is exactly what a poisoning attack relies on. */}
            <Text style={type.dim}>Recipient</Text>
            <Text style={[type.body, styles.mono]} selectable>
              {payeeLabel(reviewing.payment)}
            </Text>
            <SummaryRow k="Network" v={reviewing.payment.network ?? "Not stated"} />
            <SummaryRow k="Rail" v={reviewing.payment.rail ?? "Not stated"} />
            <SummaryRow k="Agent" v={reviewing.payment.agentId ?? "Not stated"} />
            <SummaryRow k="Mandate" v={reviewing.payment.mandateId ?? "None"} />
            <SummaryRow k="Approver role" v={reviewing.approverRole} />
            {reviewing.payment.reason ? <SummaryRow k="Held because" v={reviewing.payment.reason} /> : null}
            <Countdown deadline={reviewing.deadline} onTimeout={reviewing.onTimeout} />
            <View style={styles.actions}>
              <Button
                title="Approve"
                onPress={() => void decide(reviewing, "APPROVE")}
                loading={busy === "APPROVE"}
                disabled={busy !== null}
                style={{ flex: 1 }}
              />
              <Button
                title="Deny"
                variant="danger"
                onPress={() => void decide(reviewing, "DENY")}
                loading={busy === "DENY"}
                disabled={busy !== null}
                style={{ flex: 1 }}
              />
            </View>
          </>
        ) : null}
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  mono: { fontFamily: "monospace" },
});
