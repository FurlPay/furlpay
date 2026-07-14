import React, { useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import * as Haptics from "expo-haptics";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, API_BASE, ApiError } from "@/lib/api";
import { useTransactions } from "@/lib/queries";
import { statusStyle, type TicketStatus } from "@/lib/supportModel";
import { timeAgo, usd } from "@/lib/format";
import { colors, radius, spacing, type } from "@/lib/theme";
import { Button, EmptyState, ErrorNote, Field, Screen, SectionHeader, Sheet, Surface } from "@/components/ui";

// Support home — native counterpart of furlpay.com/support. Tickets ride the
// authenticated /api/support/tickets registry (server-side PII redaction and
// compliance routing included); every ticket is a conversation thread
// (support/[id]) that works like chat, with server-authoritative status. Help
// articles open the web help center in the in-app browser rather than
// duplicating 15 pages of content natively.

const WEB_ORIGIN = API_BASE.replace(/\/api$/, "");

// Server categories with user-facing labels + icons. Only categories the
// backend actually accepts (apps/web/src/lib/support.ts TICKET_CATEGORIES).
const CATEGORIES = [
  { value: "stablecoins", label: "Wallet & USDC", icon: "wallet-outline" },
  { value: "cards", label: "Cards & 3DS", icon: "card-outline" },
  { value: "kyc", label: "Account & KYC", icon: "person-circle-outline" },
  { value: "travel", label: "Travel bookings", icon: "airplane-outline" },
  { value: "developers", label: "Developer / API", icon: "code-slash-outline" },
  { value: "other", label: "Something else", icon: "help-circle-outline" },
] as const;
type Category = (typeof CATEGORIES)[number]["value"];

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
  status: TicketStatus;
  createdAt: string;
  updatedAt?: string;
}

export default function Support() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data, isLoading, refetch, isRefetching, error } = useQuery({
    queryKey: ["support-tickets"],
    queryFn: () => api<{ tickets: Ticket[] }>("/support/tickets"),
  });
  const tickets = data?.tickets ?? [];

  const [formOpen, setFormOpen] = useState(false);
  const [category, setCategory] = useState<Category>("stablecoins");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [attachedTxId, setAttachedTxId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // One idempotency key per form-filling session: a double-tap or a retry
  // after a timeout files ONE ticket. Re-minted when the sheet reopens.
  const idemKey = useRef(crypto.randomUUID());

  const openForm = (cat?: Category) => {
    if (cat) setCategory(cat);
    idemKey.current = crypto.randomUUID();
    setFormOpen(true);
  };

  const { data: txResult } = useTransactions();
  const recentTx = (txResult?.data ?? []).slice(0, 5);

  const submit = async () => {
    setFormError(null);
    setBusy(true);
    try {
      const res = await api<{ ticket: Ticket; redactions: number }>("/support/tickets", {
        method: "POST",
        headers: { "Idempotency-Key": idemKey.current },
        body: {
          category,
          subject: subject.trim(),
          body: body.trim(),
          // The app attaches the technical reference itself — the user should
          // never have to copy transaction ids by hand.
          ...(attachedTxId ? { refs: { transactionId: attachedTxId } } : {}),
        },
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setNotice(
        res.redactions > 0
          ? "Ticket created. A card number, recovery phrase, or API key in your message was removed for your safety."
          : "Ticket created — replies appear here and go to your account email."
      );
      setSubject("");
      setBody("");
      setAttachedTxId(null);
      setFormOpen(false);
      await qc.invalidateQueries({ queryKey: ["support-tickets"] });
      router.push(`/support/${res.ticket.id}` as never);
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
        <SectionHeader title="Report an issue" />
        <View style={styles.grid}>
          {CATEGORIES.map((c) => (
            <Pressable key={c.value} onPress={() => openForm(c.value)} style={styles.gridItem}>
              <Ionicons name={c.icon as keyof typeof Ionicons.glyphMap} size={20} color={colors.neon} />
              <Text style={[type.body, { fontSize: 13, fontWeight: "600" }]}>{c.label}</Text>
            </Pressable>
          ))}
        </View>

        <SectionHeader title="Your conversations" />
        {notice ? <Text style={{ color: colors.neon }}>{notice}</Text> : null}
        {tickets.length === 0 ? (
          <EmptyState
            title={isLoading ? "Loading…" : error ? "Couldn't load tickets" : "No conversations yet"}
            subtitle={
              error
                ? (error as Error).message
                : "Report an issue above — every ticket is a chat with support, tracked here and by email."
            }
          />
        ) : (
          tickets.map((t) => {
            const s = statusStyle(t.status);
            return (
              <Pressable key={t.id} onPress={() => router.push(`/support/${t.id}` as never)}>
                {({ pressed }) => (
                  <Surface style={[styles.ticketRow, pressed && { opacity: 0.7 }]}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={[type.body, { fontWeight: "600" }]} numberOfLines={1}>
                        {t.subject}
                      </Text>
                      <Text style={type.dim}>
                        {t.id} · {t.category} · {timeAgo(t.updatedAt ?? t.createdAt)}
                      </Text>
                    </View>
                    <View style={[styles.statusPill, { backgroundColor: s.bg }]}>
                      <Text style={{ color: s.fg, fontSize: 11, fontWeight: "700" }}>{s.label}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
                  </Surface>
                )}
              </Pressable>
            );
          })
        )}

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

        <Text style={[type.dim, { fontSize: 12 }]}>
          FurlPay Support will never ask for your recovery phrase, private key, or full card number —
          and they're stripped automatically if pasted.
        </Text>
      </ScrollView>

      <Sheet open={formOpen} title="Report an issue" onClose={() => setFormOpen(false)}>
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
            placeholder="Describe the problem — you can attach a transaction below."
            multiline
            numberOfLines={5}
            maxLength={5000}
          />
          {recentTx.length > 0 ? (
            <>
              <Text style={type.dim}>Attach a recent transaction (optional)</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {recentTx.map((t) => {
                  const active = attachedTxId === t.id;
                  return (
                    <Pressable
                      key={t.id}
                      onPress={() => setAttachedTxId(active ? null : t.id)}
                      style={[styles.chip, active && { backgroundColor: colors.neon }]}
                    >
                      <Text
                        style={{ color: active ? colors.onNeon : colors.text, fontSize: 12, fontWeight: "600" }}
                        numberOfLines={1}
                      >
                        {t.title} · {usd(t.amountUsd)}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </>
          ) : null}
          <Button
            title="Start the conversation"
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
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  gridItem: {
    width: "48%",
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: 12,
    gap: 6,
  },
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
