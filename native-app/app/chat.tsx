import React, { useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { authorizeMoneyMove } from "@/lib/money/authorize";
import { resolveConfirmation, type Confirmation } from "@/lib/copilotActions";
import { colors, radius, spacing, type } from "@/lib/theme";
import { Button, Screen } from "@/components/ui";

// Mirrors CopilotResult in apps/web/src/lib/copilot/index.ts. The co-pilot
// never moves money itself — money movements come back as
// `requiresConfirmation` and are re-submitted to the guarded route only after
// the human confirms (with biometrics, on mobile).
//
// SECURITY: the confirmation is never executed as-received. It must resolve
// against the typed allowlist in lib/copilotActions.ts (exact action id,
// endpoint, method, body schema), and the confirmation card renders the
// structured fields that will actually be sent — the server's free-form
// summary text has no executable authority.

interface CopilotResult {
  intent: string;
  reply: string;
  suggestions: string[];
  requiresConfirmation?: Confirmation;
}

interface Bubble {
  id: string;
  role: "user" | "assistant";
  content: string;
  confirmation?: Confirmation;
}

const OPENERS = ["What's my balance?", "Show my spending this month", "Best yield right now?"];

export default function Chat() {
  const qc = useQueryClient();
  const listRef = useRef<FlatList<Bubble>>(null);
  const [messages, setMessages] = useState<Bubble[]>([
    {
      id: "hello",
      role: "assistant",
      content:
        "Hi — I'm your FurlPay co-pilot. Ask about balances, spending, yields, or tell me to prepare a payment. I never move money without your confirmation.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>(OPENERS);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || busy) return;
    setInput("");
    setSuggestions([]);
    const next: Bubble[] = [...messages, { id: crypto.randomUUID(), role: "user", content }];
    setMessages(next);
    setBusy(true);
    try {
      const history = next
        .filter((m) => m.id !== "hello")
        .map((m) => ({ role: m.role, content: m.content }));
      const res = await api<CopilotResult>("/chat", { method: "POST", body: { messages: history } });
      setMessages((cur) => [
        ...cur,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: res.reply,
          confirmation: res.requiresConfirmation,
        },
      ]);
      setSuggestions(res.suggestions?.slice(0, 3) ?? []);
    } catch (e) {
      setMessages((cur) => [
        ...cur,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: e instanceof ApiError ? `Sorry — ${e.message}` : "Sorry, I couldn't reach the server.",
        },
      ]);
    } finally {
      setBusy(false);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    }
  };

  const confirm = async (bubbleId: string, c: Confirmation) => {
    // Allowlist gate — anything the registry doesn't recognize is refused
    // before the biometric sheet ever appears.
    const resolved = resolveConfirmation(c);
    if (!resolved.ok) {
      setMessages((cur) =>
        cur.map((m) => (m.id === bubbleId ? { ...m, confirmation: undefined } : m)).concat({
          id: crypto.randomUUID(),
          role: "assistant",
          content: `I can't run that action: ${resolved.reason}`,
        })
      );
      return;
    }
    // The prompt shows the VERIFIED action + fields, not the AI's summary.
    const detailLine = resolved.details.map((d) => `${d.label}: ${d.value}`).join(" · ");

    // Authenticate through the CENTRAL policy, keyed by the registry's risk
    // classification — not through confirmWithBiometrics, which passes when
    // biometrics are disabled or unenrolled. This registry permits transfers up
    // to $25,000; a money action must not execute unauthenticated because the
    // user turned a convenience toggle off.
    // THE SAME BOUNDARY AS MANUAL SEND AND SWAP.
    //
    // An AI-proposed money movement gets no privileged path: it runs the same
    // deterministic risk rules and the same proof-of-presence, keyed off the
    // REGISTRY's classification and the VALIDATED amount — never off anything
    // the model wrote. A model that says "risk: allow" or understates the
    // amount changes nothing here.
    const auth = await authorizeMoneyMove({
      action: resolved.spec.risk,
      amountUsd: resolved.amountUsd,
      reason: `${resolved.spec.title} — ${detailLine}`.slice(0, 120),
    });
    if (!auth.ok) {
      setMessages((cur) =>
        cur.concat({
          id: crypto.randomUUID(),
          role: "assistant",
          content: auth.message,
        })
      );
      return;
    }
    try {
      await api(resolved.endpoint, { method: resolved.method, body: resolved.body });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setMessages((cur) =>
        cur.map((m) => (m.id === bubbleId ? { ...m, confirmation: undefined } : m)).concat({
          id: crypto.randomUUID(),
          role: "assistant",
          content: `Done — ${c.summary}`,
        })
      );
      void qc.invalidateQueries();
    } catch (e) {
      setMessages((cur) =>
        cur.concat({
          id: crypto.randomUUID(),
          role: "assistant",
          content: e instanceof ApiError ? `That didn't go through: ${e.message}` : "That didn't go through.",
        })
      );
    }
  };

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.lg }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          renderItem={({ item }) => (
            <View
              style={[
                styles.bubble,
                item.role === "user" ? styles.userBubble : styles.assistantBubble,
              ]}
            >
              <Text style={[type.body, item.role === "user" && { color: colors.onNeon }]}>
                {item.content}
              </Text>
              {item.confirmation ? (
                (() => {
                  const resolved = resolveConfirmation(item.confirmation);
                  if (!resolved.ok) {
                    // Unknown/mismatched action: no Confirm button at all.
                    return (
                      <View style={styles.confirmCard}>
                        <Text style={[type.dim, { color: colors.warning }]}>
                          This suggested action isn't recognized by the app and was blocked for your
                          safety.
                        </Text>
                      </View>
                    );
                  }
                  return (
                    <View style={styles.confirmCard}>
                      <Text style={[type.body, { fontWeight: "700" }]}>{resolved.spec.title}</Text>
                      {/* The verified fields that will actually be sent — the
                          AI summary above them carries no authority. */}
                      {resolved.details.map((d) => (
                        <View key={d.label} style={styles.detailRow}>
                          <Text style={type.dim}>{d.label}</Text>
                          <Text style={[type.body, { fontWeight: "600" }]}>{d.value}</Text>
                        </View>
                      ))}
                      <View style={{ flexDirection: "row", gap: spacing.sm }}>
                        <Button
                          title="Confirm"
                          onPress={() => void confirm(item.id, item.confirmation!)}
                          style={{ flex: 1, paddingVertical: 10 }}
                        />
                        <Button
                          title="Cancel"
                          variant="secondary"
                          onPress={() =>
                            setMessages((cur) =>
                              cur.map((m) => (m.id === item.id ? { ...m, confirmation: undefined } : m))
                            )
                          }
                          style={{ flex: 1, paddingVertical: 10 }}
                        />
                      </View>
                    </View>
                  );
                })()
              ) : null}
            </View>
          )}
        />

        {suggestions.length > 0 ? (
          <View style={styles.suggestions}>
            {suggestions.map((s) => (
              <Pressable key={s} onPress={() => void send(s)} style={styles.suggestionChip}>
                <Text style={{ color: colors.neon, fontSize: 13 }}>{s}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <View style={styles.composer}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder={busy ? "Thinking…" : "Ask your co-pilot…"}
            placeholderTextColor={colors.textFaint}
            style={styles.input}
            editable={!busy}
            onSubmitEditing={() => void send(input)}
            returnKeyType="send"
          />
          <Pressable
            onPress={() => void send(input)}
            disabled={busy || !input.trim()}
            style={[styles.sendBtn, (busy || !input.trim()) && { opacity: 0.4 }]}
          >
            <Text style={{ color: colors.onNeon, fontWeight: "800" }}>↑</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  bubble: { maxWidth: "85%", borderRadius: radius.md, padding: 12, gap: 8 },
  userBubble: { alignSelf: "flex-end", backgroundColor: colors.neon },
  assistantBubble: {
    alignSelf: "flex-start",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
  },
  confirmCard: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.sm,
    padding: 10,
    gap: 8,
  },
  detailRow: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm },
  suggestions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  suggestionChip: {
    borderColor: colors.neonDeep,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  composer: {
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.pill,
    color: colors.text,
    paddingHorizontal: 16,
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
