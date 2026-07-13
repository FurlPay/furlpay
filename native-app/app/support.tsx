import React, { useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import * as Haptics from "expo-haptics";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, API_BASE, ApiError } from "@/lib/api";
import { colors, radius, spacing, type } from "@/lib/theme";
import { Button, EmptyState, ErrorNote, Field, Screen, SectionHeader, Sheet, Surface } from "@/components/ui";

// Support — native counterpart of furlpay.com/support. Tickets ride the same
// authenticated /api/support/tickets registry (server-side PII redaction and
// compliance routing included); help articles open the web help center in the
// in-app browser rather than duplicating 15 pages of content natively.

const WEB_ORIGIN = API_BASE.replace(/\/api$/, "");

const CATEGORIES = [
  { value: "stablecoins", label: "Stablecoins" },
  { value: "cards", label: "Cards" },
  { value: "kyc", label: "KYC" },
  { value: "travel", label: "Travel" },
  { value: "developers", label: "Developers" },
  { value: "other", label: "Other" },
] as const;

const HELP_LINKS: { icon: keyof typeof Ionicons.glyphMap; label: string; path: string }[] = [
  { icon: "compass-outline", label: "All help articles", path: "/docs/help" },
  { icon: "cash-outline", label: "Deposits & withdrawals", path: "/docs/help/deposits-withdrawals" },
  { icon: "card-outline", label: "Card declines & freezing", path: "/docs/help/declined-transactions" },
  { icon: "finger-print-outline", label: "Passkeys & biometrics", path: "/docs/help/passkeys-biometrics" },
  { icon: "airplane-outline", label: "Travel refunds", path: "/docs/help/travel-refunds" },
];

interface Ticket {
  id: string;
  category: string;
  subject: string;
  status: "open" | "resolved";
  createdAt: string;
}

export default function Support() {
  const qc = useQueryClient();
  const { data, isLoading, refetch, isRefetching, error } = useQuery({
    queryKey: ["support-tickets"],
    queryFn: () => api<{ tickets: Ticket[] }>("/support/tickets"),
  });
  const tickets = data?.tickets ?? [];

  const [formOpen, setFormOpen] = useState(false);
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]["value"]>("stablecoins");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async () => {
    setFormError(null);
    setBusy(true);
    try {
      const res = await api<{ ticket: Ticket; redactions: number }>("/support/tickets", {
        method: "POST",
        body: { category, subject: subject.trim(), body: body.trim() },
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setNotice(
        res.redactions > 0
          ? "Ticket created. A card number, recovery phrase, or API key in your message was removed for your safety."
          : "Ticket created — we reply to your account email."
      );
      setSubject("");
      setBody("");
      setFormOpen(false);
      await qc.invalidateQueries({ queryKey: ["support-tickets"] });
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={colors.neon} />
        }
      >
        <SectionHeader title="Help articles" />
        <Surface style={{ paddingVertical: 4 }}>
          {HELP_LINKS.map((l) => (
            <Pressable
              key={l.path}
              onPress={() => void WebBrowser.openBrowserAsync(`${WEB_ORIGIN}${l.path}`)}
              style={({ pressed }) => [styles.linkRow, pressed && { opacity: 0.7 }]}
            >
              <Ionicons name={l.icon} size={18} color={colors.neon} />
              <Text style={[type.body, { flex: 1 }]}>{l.label}</Text>
              <Ionicons name="open-outline" size={15} color={colors.textFaint} />
            </Pressable>
          ))}
        </Surface>

        <SectionHeader title="Your tickets" />
        {notice ? <Text style={{ color: colors.neon }}>{notice}</Text> : null}
        {tickets.length === 0 ? (
          <EmptyState
            title={isLoading ? "Loading…" : error ? "Couldn't load tickets" : "No tickets yet"}
            subtitle={
              error
                ? (error as Error).message
                : "Open one below — replies go to your account email, and it stays tracked here."
            }
          />
        ) : (
          tickets.map((t) => (
            <Surface key={t.id} style={styles.ticketRow}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[type.body, { fontWeight: "600" }]} numberOfLines={1}>
                  {t.subject}
                </Text>
                <Text style={type.dim}>
                  {t.id} · {t.category} · {new Date(t.createdAt).toLocaleDateString()}
                </Text>
              </View>
              <View
                style={[
                  styles.statusPill,
                  { backgroundColor: t.status === "open" ? "#2A230A" : colors.neonSoft },
                ]}
              >
                <Text
                  style={{
                    color: t.status === "open" ? colors.warning : colors.neon,
                    fontSize: 11,
                    fontWeight: "700",
                  }}
                >
                  {t.status}
                </Text>
              </View>
            </Surface>
          ))
        )}

        <Button title="Open a ticket" onPress={() => setFormOpen(true)} />
        <Text style={[type.dim, { fontSize: 12 }]}>
          Never include your full card number, recovery phrase, or API keys — support will never
          need them, and they are stripped automatically if pasted.
        </Text>
      </ScrollView>

      <Sheet open={formOpen} title="Open a ticket" onClose={() => setFormOpen(false)}>
        <View style={{ gap: spacing.sm }}>
          <Text style={type.dim}>Category</Text>
          <View style={styles.chips}>
            {CATEGORIES.map((c) => {
              const active = c.value === category;
              return (
                <Pressable
                  key={c.value}
                  onPress={() => setCategory(c.value)}
                  style={[styles.chip, active && { backgroundColor: colors.neon }]}
                >
                  <Text style={{ color: active ? colors.onNeon : colors.text, fontWeight: "600", fontSize: 13 }}>
                    {c.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Field
            label="Subject"
            value={subject}
            onChangeText={setSubject}
            placeholder="Deposit not credited after 30 minutes"
            maxLength={120}
          />
          <Field
            label="What happened?"
            value={body}
            onChangeText={setBody}
            placeholder="Include tx hashes or request ids where relevant."
            multiline
            numberOfLines={5}
            maxLength={5000}
          />
          <Button
            title="Submit ticket"
            loading={busy}
            disabled={subject.trim().length < 4 || body.trim().length < 10}
            onPress={() => void submit()}
          />
          <ErrorNote message={formError} />
        </View>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  linkRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 },
  ticketRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  statusPill: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
});
