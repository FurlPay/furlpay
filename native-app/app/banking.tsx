import React, { useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { api, ApiError } from "@/lib/api";
import { FX_CURRENCIES, FxUnavailable, fxProvenance, useFxQuote } from "@/lib/fx";
import { usd } from "@/lib/format";
import { useSecureScreen } from "@/lib/secureScreen";
import { colors, radius, spacing, type } from "@/lib/theme";
import {
  Button,
  EmptyState,
  ErrorNote,
  Field,
  PreviewBanner,
  Screen,
  SectionHeader,
  Sheet,
  SummaryRow,
  Surface,
} from "@/components/ui";

// Banking — native counterpart of apps/web/src/app/banking/page.tsx: virtual
// local accounts, Send/Receive/Convert/Direct actions and Furlpay Direct.
// The Send/Convert/Direct flows are the same client-side simulations the web
// page ships today (no server mutation yet) — keep them in lockstep.

interface FiatAccount {
  currency: string;
  amount: number;
  usdValue: number;
  localDetails?: Record<string, string>;
}

const PROVISIONABLE = ["USD", "EUR", "GBP", "INR"] as const;

// No rate table here. Conversion prices through /api/offramp, which reads ECB
// reference rates — see lib/fx.ts for why a local table is the wrong shape for
// this and what the old one got wrong.
const SYMBOL: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", INR: "₹", JPY: "¥" };

// Local payment rails per currency (what a sender uses to pay you).
const RAILS: Record<string, string[]> = {
  EUR: ["SEPA Instant", "SEPA", "SWIFT"],
  USD: ["ACH", "Wire", "SWIFT"],
  GBP: ["Faster Payments", "SWIFT"],
  INR: ["UPI", "IMPS", "SWIFT"],
};

// Furlpay Direct — send straight into these apps/banks (RedotPay-style).
const DIRECT = ["PayPal", "Revolut", "Wise", "Cash App", "Monzo", "Chase", "Remitly", "Paysend"];

const DETAIL_LABEL: Record<string, string> = {
  iban: "IBAN",
  swift: "SWIFT/BIC",
  routingNumber: "Routing number",
  accountNumber: "Account number",
  sortCode: "Sort code",
  ifsc: "IFSC",
  bankAddress: "Bank",
};

function sym(c: string) {
  return SYMBOL[c] ?? c + " ";
}

function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <Pressable
      onPress={() =>
        void Clipboard.setStringAsync(value).then(() =>
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
        )
      }
      style={({ pressed }) => [styles.copyRow, pressed && { opacity: 0.6 }]}
    >
      <Text style={type.dim}>{label}</Text>
      <Text style={[type.mono, { color: colors.text, flexShrink: 1, textAlign: "right" }]}>{value}</Text>
    </Pressable>
  );
}

function QuickAction({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.action, pressed && { opacity: 0.7 }]}>
      <View style={styles.actionIcon}>
        <Ionicons name={icon} size={20} color={colors.neon} />
      </View>
      <Text style={type.dim}>{label}</Text>
    </Pressable>
  );
}

/** Currency (or option) picker rendered as pill chips. */
function ChipPicker({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={type.dim}>{label}</Text>
      <View style={styles.chips}>
        {options.map((o) => (
          <Pressable
            key={o}
            onPress={() => onChange(o)}
            style={[styles.chip, value === o && { backgroundColor: colors.neon }]}
          >
            <Text style={{ color: value === o ? colors.onNeon : colors.textDim, fontWeight: "700" }}>{o}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function SuccessNote({ text, preview }: { text: string; preview?: boolean }) {
  return (
    <Surface style={{ alignItems: "center", gap: 6 }}>
      {/* A preview flow must NOT wear the green "money moved" checkmark — that
          would tell the user a transfer happened when nothing did. */}
      <Ionicons
        name={preview ? "flask-outline" : "checkmark-circle"}
        size={32}
        color={preview ? colors.warning : colors.neon}
      />
      <Text style={[type.body, { fontWeight: "600", textAlign: "center" }]}>{text}</Text>
      {preview ? (
        <Text style={[type.dim, { fontSize: 12, textAlign: "center" }]}>
          No real money moved — this flow isn&apos;t live yet.
        </Text>
      ) : null}
    </Surface>
  );
}

type SheetKind = null | "send" | "receive" | "convert" | "direct";

function SendSheet({ accounts }: { accounts: FiatAccount[] }) {
  const [from, setFrom] = useState(accounts[0]?.currency ?? "USD");
  const [rail, setRail] = useState((RAILS[accounts[0]?.currency ?? "USD"] ?? ["SWIFT"])[0]);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("100");
  const [done, setDone] = useState(false);

  const rails = RAILS[from] ?? ["SWIFT"];
  const amt = Number(amount) || 0;
  const available = accounts.find((a) => a.currency === from)?.amount ?? 0;
  const overBalance = amt > available;
  const feePct = rail === "SWIFT" ? 0.012 : 0.004;
  const fee = Math.max(0.2, amt * feePct);
  const arrival =
    rail.includes("Instant") || rail === "UPI" || rail === "Faster Payments"
      ? "in seconds"
      : rail === "SWIFT"
        ? "1–2 business days"
        : "same day";

  if (done)
    return <SuccessNote preview text={`Previewed sending ${sym(from)}${amt.toLocaleString()} via ${rail}.`} />;
  return (
    <View style={{ gap: spacing.md }}>
      <PreviewBanner />
      <ChipPicker
        label="From"
        options={accounts.map((a) => a.currency)}
        value={from}
        onChange={(v) => {
          setFrom(v);
          setRail((RAILS[v] ?? ["SWIFT"])[0]);
        }}
      />
      <ChipPicker label="Rail" options={rails} value={rail} onChange={setRail} />
      <Field
        label="Recipient (IBAN / account / email)"
        value={to}
        onChangeText={setTo}
        placeholder="DE89 3704 0044 0532 0130 00"
        autoCapitalize="none"
      />
      <Field
        label={`Amount (${from})`}
        value={amount}
        onChangeText={(t) => setAmount(t.replace(/[^0-9.]/g, ""))}
        keyboardType="decimal-pad"
      />
      {overBalance ? (
        <Text style={{ color: colors.accent, fontSize: 12 }}>
          Exceeds your balance of {sym(from)}
          {available.toLocaleString("en-US", { maximumFractionDigits: 2 })}.
        </Text>
      ) : null}
      <Surface style={{ gap: 2 }}>
        <SummaryRow k="Fee" v={`${sym(from)}${fee.toFixed(2)}`} />
        <SummaryRow k="Arrives" v={arrival} />
        <SummaryRow k="Recipient gets" v={`${sym(from)}${Math.max(0, amt - fee).toFixed(2)}`} bold />
      </Surface>
      <Button
        title={`Send ${sym(from)}${amt.toLocaleString()}`}
        disabled={!to.trim() || amt <= 0 || overBalance}
        onPress={() => setDone(true)}
      />
    </View>
  );
}

function ReceiveSheet({ accounts }: { accounts: FiatAccount[] }) {
  const [cur, setCur] = useState(accounts[0]?.currency ?? "USD");
  const acct = accounts.find((a) => a.currency === cur);
  return (
    <View style={{ gap: spacing.md }}>
      <ChipPicker label="Currency" options={accounts.map((a) => a.currency)} value={cur} onChange={setCur} />
      <Text style={type.dim}>
        Share these details to get paid via {(RAILS[cur] ?? ["SWIFT"]).join(" / ")}. Tap to copy.
      </Text>
      {acct?.localDetails ? (
        <Surface>
          {Object.entries(acct.localDetails).map(([k, v]) => (
            <CopyRow key={k} label={DETAIL_LABEL[k] ?? k} value={v} />
          ))}
        </Surface>
      ) : (
        <EmptyState title="No account details yet" subtitle={`Open a ${cur} account first.`} />
      )}
    </View>
  );
}

function ConvertSheet({ accounts }: { accounts: FiatAccount[] }) {
  const [from, setFrom] = useState(accounts[0]?.currency ?? "USD");
  const [to, setTo] = useState(accounts[1]?.currency ?? "USD");
  const [amount, setAmount] = useState("100");
  const [done, setDone] = useState(false);
  const amt = Number(amount) || 0;
  const available = accounts.find((a) => a.currency === from)?.amount ?? 0;
  const overBalance = amt > available;

  // Priced by the server. There is no local fallback on purpose: if the rate
  // cannot be fetched the screen says so, because the alternative is showing an
  // invented number in the row the user reads to decide.
  const { data: quote, error, isFetching } = useFxQuote(from, to, amt);
  const fxError = error instanceof FxUnavailable ? error.message : error ? String(error) : null;

  if (done && quote)
    return (
      <SuccessNote
        preview
        text={`Previewed converting ${sym(from)}${amt.toLocaleString()} → ${sym(to)}${quote.amountTo.toFixed(2)}.`}
      />
    );
  return (
    <View style={{ gap: spacing.md }}>
      <PreviewBanner />
      <ChipPicker label="From" options={accounts.map((a) => a.currency)} value={from} onChange={setFrom} />
      <ChipPicker label="To" options={[...FX_CURRENCIES]} value={to} onChange={setTo} />
      <Field
        label={`Amount (${from})`}
        value={amount}
        onChangeText={(t) => setAmount(t.replace(/[^0-9.]/g, ""))}
        keyboardType="decimal-pad"
      />
      {overBalance ? (
        <Text style={{ color: colors.accent, fontSize: 12 }}>
          Exceeds your balance of {sym(from)}
          {available.toLocaleString("en-US", { maximumFractionDigits: 2 })}.
        </Text>
      ) : null}

      <Surface style={{ gap: 2 }}>
        {quote ? (
          <>
            <SummaryRow
              k="Indicative rate"
              v={`1 ${from} = ${quote.midMarketRate.toFixed(4)} ${to}`}
            />
            <SummaryRow k={`Fee (${quote.feePct}%)`} v={`${sym(from)}${quote.feeAmount.toFixed(2)}`} />
            <SummaryRow k="You get" v={`${sym(to)}${quote.amountTo.toFixed(2)}`} bold />
            <SummaryRow k="Rail" v={quote.rail} />
            {/* Provenance sits with the number, not in a tooltip. A rate the
                user cannot date is a rate they cannot judge. */}
            <Text style={[type.dim, { marginTop: 6, fontSize: 11 }]}>{fxProvenance(quote)}</Text>
          </>
        ) : fxError ? (
          <ErrorNote message={fxError} />
        ) : (
          <SummaryRow k="Indicative rate" v={isFetching ? "Getting rate…" : "—"} />
        )}
      </Surface>

      <Button
        title="Convert"
        // Gated on having a real quote. Without one there is nothing to preview
        // and no rate the user could have agreed to.
        disabled={from === to || amt <= 0 || overBalance || !quote || isFetching}
        onPress={() => setDone(true)}
      />
    </View>
  );
}

function DirectSheet({ initialApp }: { initialApp: string }) {
  const [app, setApp] = useState(initialApp);
  const [amount, setAmount] = useState("50");
  const [done, setDone] = useState(false);
  const amt = Number(amount) || 0;

  if (done) return <SuccessNote preview text={`Previewed sending $${amt.toLocaleString()} to ${app}.`} />;
  return (
    <View style={{ gap: spacing.md }}>
      <PreviewBanner />
      <Text style={type.dim}>Send from your balance straight into another app or bank.</Text>
      <ChipPicker label="Destination" options={DIRECT} value={app} onChange={setApp} />
      <Field
        label="Amount (USD)"
        value={amount}
        onChangeText={(t) => setAmount(t.replace(/[^0-9.]/g, ""))}
        keyboardType="decimal-pad"
      />
      <Surface style={{ gap: 2 }}>
        <SummaryRow k="Fee" v="$0.00" />
        <SummaryRow k="Arrives" v="in minutes" />
      </Surface>
      <Button title={`Send to ${app}`} disabled={amt <= 0} onPress={() => setDone(true)} />
    </View>
  );
}

export default function Banking() {
  // Local account details (IBAN, sort code, account number) render here — the
  // same class of material as the card PAN screen, so it gets the same
  // screenshot / screen-record / recents-thumbnail block.
  useSecureScreen("banking");
  const qc = useQueryClient();
  const { data, isLoading, refetch, isRefetching, error } = useQuery({
    queryKey: ["banking"],
    queryFn: () => api<{ accounts: FiatAccount[] }>("/banking"),
  });
  const [provisioning, setProvisioning] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [directApp, setDirectApp] = useState(DIRECT[0]);

  const accounts = data?.accounts ?? [];
  const provisioned = new Set(accounts.filter((a) => a.localDetails).map((a) => a.currency));
  const totalUsd = accounts.reduce((s, a) => s + a.usdValue, 0);

  const provision = async (currency: string) => {
    setActionError(null);
    setProvisioning(currency);
    try {
      await api("/banking", { method: "POST", body: { currency } });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await qc.invalidateQueries({ queryKey: ["banking"] });
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setProvisioning(null);
    }
  };

  const openDirect = (app: string) => {
    setDirectApp(app);
    setSheet("direct");
  };

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={colors.neon} />
        }
      >
        {/* Balance hero */}
        <View style={{ gap: 4 }}>
          <Text style={type.dim}>Total across accounts</Text>
          <Text style={styles.hero}>{accounts.length ? usd(totalUsd) : isLoading ? "· · ·" : "—"}</Text>
          <Text style={type.dim}>
            {accounts.length} local accounts · send to 140+ countries · 64% arrive in under 20s
          </Text>
        </View>

        {/* Quick actions */}
        <View style={styles.actions}>
          <QuickAction icon="arrow-up-outline" label="Send" onPress={() => setSheet("send")} />
          <QuickAction icon="arrow-down-outline" label="Receive" onPress={() => setSheet("receive")} />
          <QuickAction icon="repeat-outline" label="Convert" onPress={() => setSheet("convert")} />
          <QuickAction icon="trending-up-outline" label="Direct" onPress={() => openDirect(DIRECT[0])} />
        </View>

        {/* Accounts */}
        <SectionHeader title="Your accounts" />
        {accounts.length === 0 ? (
          <EmptyState
            title={isLoading ? "Loading…" : error ? "Couldn't load accounts" : "No accounts yet"}
            subtitle={error ? (error as Error).message : undefined}
          />
        ) : (
          accounts.map((a) => (
            <Surface key={a.currency} style={{ gap: 6 }}>
              <View style={styles.row}>
                <Text style={[type.body, { fontWeight: "700" }]}>{a.currency}</Text>
                <Text style={[type.h2, { color: colors.neon }]}>{usd(a.usdValue)}</Text>
              </View>
              <Text style={type.dim}>
                {a.amount.toLocaleString("en-US", { maximumFractionDigits: 2 })} {a.currency}
              </Text>
              <View style={styles.railChips}>
                {(RAILS[a.currency] ?? ["SWIFT"]).map((r) => (
                  <View key={r} style={styles.railChip}>
                    <Text style={{ color: colors.neon, fontSize: 10, fontWeight: "700" }}>{r}</Text>
                  </View>
                ))}
              </View>
              {a.localDetails ? (
                Object.entries(a.localDetails).map(([k, v]) => (
                  <CopyRow key={k} label={DETAIL_LABEL[k] ?? k} value={v} />
                ))
              ) : (
                <Button
                  title={`Get ${a.currency} account details`}
                  variant="secondary"
                  loading={provisioning === a.currency}
                  onPress={() => void provision(a.currency)}
                />
              )}
            </Surface>
          ))
        )}

        {/* Furlpay Direct */}
        <View>
          <SectionHeader title="Furlpay Direct" />
          <Text style={[type.dim, { marginTop: -spacing.sm, marginBottom: spacing.sm }]}>
            Send money straight into other apps &amp; banks.
          </Text>
          <View style={styles.directGrid}>
            {DIRECT.map((d) => (
              <Pressable
                key={d}
                onPress={() => openDirect(d)}
                style={({ pressed }) => [styles.directTile, pressed && { opacity: 0.7 }]}
              >
                <View style={styles.directBadge}>
                  <Text style={{ color: colors.text, fontWeight: "800" }}>{d[0]}</Text>
                </View>
                <Text style={[type.dim, { fontSize: 10 }]} numberOfLines={1}>
                  {d}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <SectionHeader title="Open a new account" />
        <View style={styles.chips}>
          {PROVISIONABLE.filter((c) => !provisioned.has(c)).map((c) => (
            <Pressable
              key={c}
              onPress={() => void provision(c)}
              style={({ pressed }) => [styles.chip, pressed && { opacity: 0.7 }]}
            >
              <Text style={{ color: colors.text, fontWeight: "600" }}>
                {provisioning === c ? "…" : `+ ${c}`}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={[type.dim, { fontSize: 11 }]}>
          Virtual IBAN / routing are sub-accounts under Furlpay&apos;s BaaS partner (Cross River / Wise),
          held in FDIC-insured or safeguarded omnibus accounts.
        </Text>
        <ErrorNote message={actionError} />
      </ScrollView>

      <Sheet open={sheet === "send"} title="Send money" onClose={() => setSheet(null)}>
        <SendSheet accounts={accounts} />
      </Sheet>
      <Sheet open={sheet === "receive"} title="Receive money" onClose={() => setSheet(null)}>
        <ReceiveSheet accounts={accounts} />
      </Sheet>
      <Sheet open={sheet === "convert"} title="Convert" onClose={() => setSheet(null)}>
        <ConvertSheet accounts={accounts} />
      </Sheet>
      <Sheet open={sheet === "direct"} title="Furlpay Direct" onClose={() => setSheet(null)}>
        <DirectSheet initialApp={directApp} />
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  hero: { fontSize: 36, fontWeight: "800", color: colors.text, letterSpacing: -1 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  actions: { flexDirection: "row", justifyContent: "space-between", marginVertical: spacing.xs },
  action: { alignItems: "center", gap: 6, flex: 1 },
  actionIcon: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: colors.neonSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  copyRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: 8,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  railChips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  railChip: {
    backgroundColor: colors.neonSoft,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  directGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  directTile: {
    width: "22%",
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    alignItems: "center",
    gap: 6,
    paddingVertical: 12,
  },
  directBadge: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.pill,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
});
