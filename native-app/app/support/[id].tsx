import React, { useEffect, useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { api, ApiError, NetworkError } from "@/lib/api";
import { useIsOffline, OFFLINE_MUTATION_MESSAGE } from "@/lib/net";
import { timeAgo } from "@/lib/format";
import { colors, radius, spacing, type } from "@/lib/theme";
import { Button, EmptyState, ErrorNote, Screen } from "@/components/ui";
import { statusStyle, type TicketStatus } from "@/lib/supportModel";

// ---------------------------------------------------------------------------
// Ticket conversation — the in-app support chat. Server-authoritative:
// statuses and resolution come from /api/support/tickets/[id]; the client
// never declares an issue resolved from local state. Author labels are
// explicit — a human agent is "FurlPay Support", automated updates are
// "System" — and nothing here is AI pretending to be a person.
//
// Send reliability: each outgoing message carries an Idempotency-Key minted
// once per message (kept across retries), so a resend after an ambiguous
// timeout can never post twice. Failed sends stay visible with a Retry.
// ---------------------------------------------------------------------------

interface Message {
  id: string;
  author: "user" | "agent" | "system";
  body: string;
  createdAt: string;
}

interface TicketDetail {
  ticket: {
    id: string;
    subject: string;
    category: string;
    status: TicketStatus;
    refs?: Record<string, string>;
    createdAt: string;
    updatedAt: string;
  };
  messages: Message[];
}

interface PendingSend {
  localId: string;
  idempotencyKey: string;
  body: string;
  state: "sending" | "failed";
  error?: string;
}

export default function Ticket() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const offline = useIsOffline();
  const listRef = useRef<FlatList<Message | PendingSend>>(null);

  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ["support-ticket", id],
    queryFn: () => api<TicketDetail>(`/support/tickets/${id}`),
    refetchInterval: 15_000, // agent replies should appear without a manual refresh
    enabled: !!id,
  });

  const [input, setInput] = useState("");
  const [pending, setPending] = useState<PendingSend[]>([]);
  const [closing, setClosing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const ticket = data?.ticket;
  const messages = data?.messages ?? [];

  // Once the server thread contains a message we sent, drop its local echo.
  useEffect(() => {
    if (!messages.length) return;
    setPending((cur) => cur.filter((p) => !messages.some((m) => m.author === "user" && m.body === p.body)));
  }, [messages]);

  const deliver = async (p: PendingSend) => {
    try {
      await api(`/support/tickets/${id}/messages`, {
        method: "POST",
        body: { body: p.body },
        headers: { "Idempotency-Key": p.idempotencyKey },
      });
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setPending((cur) => cur.filter((x) => x.localId !== p.localId));
      await qc.invalidateQueries({ queryKey: ["support-ticket", id] });
      await qc.invalidateQueries({ queryKey: ["support-tickets"] });
    } catch (e) {
      const msg =
        e instanceof NetworkError
          ? "Not sent — you're offline."
          : e instanceof ApiError
            ? e.message
            : (e as Error).message;
      setPending((cur) =>
        cur.map((x) => (x.localId === p.localId ? { ...x, state: "failed", error: msg } : x))
      );
    }
  };

  const send = () => {
    const body = input.trim();
    if (!body) return;
    if (offline) {
      setActionError(OFFLINE_MUTATION_MESSAGE);
      return;
    }
    setActionError(null);
    setInput("");
    const p: PendingSend = {
      localId: crypto.randomUUID(),
      // Minted ONCE per message and reused on every retry — the server dedupes.
      idempotencyKey: crypto.randomUUID(),
      body,
      state: "sending",
    };
    setPending((cur) => [...cur, p]);
    void deliver(p);
  };

  const retry = (p: PendingSend) => {
    setPending((cur) => cur.map((x) => (x.localId === p.localId ? { ...x, state: "sending", error: undefined } : x)));
    void deliver(p);
  };

  const closeTicket = async () => {
    setClosing(true);
    setActionError(null);
    try {
      await api(`/support/tickets/${id}`, { method: "PATCH", body: { status: "closed" } });
      await qc.invalidateQueries({ queryKey: ["support-ticket", id] });
      await qc.invalidateQueries({ queryKey: ["support-tickets"] });
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setClosing(false);
    }
  };

  if (isLoading) return <Screen />;
  if (error || !ticket) {
    return (
      <Screen>
        <EmptyState
          title="Couldn't load this ticket"
          subtitle={error ? (error as Error).message : "It may have been removed."}
        />
      </Screen>
    );
  }

  const s = statusStyle(ticket.status);
  const thread: (Message | PendingSend)[] = [...messages, ...pending];
  const closed = ticket.status === "closed";

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={styles.header}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[type.body, { fontWeight: "700" }]} numberOfLines={2}>
              {ticket.subject}
            </Text>
            <Text style={type.dim}>
              {ticket.id} · {ticket.category} · opened {timeAgo(ticket.createdAt)}
            </Text>
            {ticket.refs && Object.keys(ticket.refs).length ? (
              <Text style={[type.dim, { fontSize: 11 }]} numberOfLines={1}>
                ref {Object.values(ticket.refs).join(" · ")}
              </Text>
            ) : null}
          </View>
          <View style={[styles.statusPill, { backgroundColor: s.bg }]}>
            <Text style={{ color: s.fg, fontSize: 11, fontWeight: "700" }}>{s.label}</Text>
          </View>
        </View>

        <FlatList
          ref={listRef}
          data={thread}
          keyExtractor={(m) => ("localId" in m ? m.localId : m.id)}
          contentContainerStyle={{ padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.lg }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={colors.neon} />
          }
          renderItem={({ item }) => {
            if ("localId" in item) {
              return (
                <View style={[styles.bubble, styles.userBubble, item.state === "failed" && styles.failedBubble]}>
                  <Text style={[type.body, { color: colors.onNeon }]}>{item.body}</Text>
                  {item.state === "sending" ? (
                    <Text style={[styles.meta, { color: colors.onNeon }]}>Sending…</Text>
                  ) : (
                    <Pressable onPress={() => retry(item)} hitSlop={8}>
                      <Text style={[styles.meta, { color: colors.onNeon, fontWeight: "700" }]}>
                        {item.error ?? "Failed"} — tap to retry
                      </Text>
                    </Pressable>
                  )}
                </View>
              );
            }
            if (item.author === "system") {
              return (
                <View style={styles.systemRow}>
                  <Text style={[type.dim, { fontSize: 12, textAlign: "center", fontStyle: "italic" }]}>
                    {item.body}
                  </Text>
                </View>
              );
            }
            const mine = item.author === "user";
            return (
              <View style={[styles.bubble, mine ? styles.userBubble : styles.agentBubble]}>
                {!mine ? (
                  <Text style={{ color: colors.neon, fontSize: 11, fontWeight: "700" }}>FurlPay Support</Text>
                ) : null}
                <Text style={[type.body, mine && { color: colors.onNeon }]}>{item.body}</Text>
                <Text style={[styles.meta, { color: mine ? colors.onNeon : colors.textFaint }]}>
                  {timeAgo(item.createdAt)}
                </Text>
              </View>
            );
          }}
        />

        <ErrorNote message={actionError} />

        {closed ? (
          <View style={styles.composer}>
            <Text style={[type.dim, { flex: 1, textAlign: "center" }]}>
              This ticket is closed. Open a new one if you need more help.
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.composer}>
              <TextInput
                value={input}
                onChangeText={setInput}
                placeholder={offline ? "You're offline" : "Reply to support…"}
                placeholderTextColor={colors.textFaint}
                style={styles.input}
                editable={!offline}
                multiline
              />
              <Pressable
                onPress={send}
                disabled={offline || !input.trim()}
                style={[styles.sendBtn, (offline || !input.trim()) && { opacity: 0.4 }]}
              >
                <Text style={{ color: colors.onNeon, fontWeight: "800" }}>↑</Text>
              </Pressable>
            </View>
            {ticket.status === "resolved" ? (
              <View style={{ paddingHorizontal: spacing.md, paddingBottom: spacing.md }}>
                <Button title="Close ticket" variant="secondary" loading={closing} onPress={() => void closeTicket()} />
              </View>
            ) : null}
          </>
        )}
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    padding: spacing.md,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  statusPill: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  bubble: { maxWidth: "85%", borderRadius: radius.md, padding: 12, gap: 4 },
  userBubble: { alignSelf: "flex-end", backgroundColor: colors.neon },
  failedBubble: { opacity: 0.75 },
  agentBubble: {
    alignSelf: "flex-start",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
  },
  systemRow: { alignSelf: "center", maxWidth: "90%", paddingVertical: 2 },
  meta: { fontSize: 10, opacity: 0.8 },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
    padding: spacing.md,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    color: colors.text,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: radius.pill,
    backgroundColor: colors.neon,
    alignItems: "center",
    justifyContent: "center",
  },
});
