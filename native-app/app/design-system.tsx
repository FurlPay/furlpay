import React, { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { makeStyles, useTheme, type ThemeMode } from "@/lib/design";
import { useI18n } from "@/lib/i18n";
import {
  FurlAmountInput,
  FurlAssetRow,
  FurlBalance,
  FurlBottomSheet,
  FurlButton,
  FurlCard,
  FurlChart,
  FurlDialog,
  FurlEmptyState,
  FurlErrorState,
  FurlIconButton,
  FurlInput,
  FurlOfflineState,
  FurlSearchBar,
  FurlSecondaryButton,
  FurlSectionHeader,
  FurlSegmented,
  FurlSkeleton,
  FurlSkeletonList,
  FurlStatusBadge,
  FurlSuccessState,
  FurlSummaryRow,
  FurlTabBar,
  FurlTopBar,
  FurlTransactionRow,
  OptionRow,
  type MoneyStatus,
} from "@/components/furl";

// ---------------------------------------------------------------------------
// Component gallery.
//
// The React Native answer to Compose's @Preview: one route that renders every
// component in the library, in whatever theme, language and font scale the
// device is currently set to. Its job is to make a regression VISIBLE —
// switch the theme at the top and any component with a hardcoded colour stops
// matching its neighbours immediately.
//
// It is a normal route, not a dev-only one, because it must be reachable on a
// release build on a real device — that is where theming and font-scaling bugs
// actually show up, and a __DEV__ gate would hide it exactly there. It is not
// linked from anywhere in the product; you reach it from Settings → Appearance
// or by deep link.
// ---------------------------------------------------------------------------

const ALL_STATUSES: MoneyStatus[] = [
  "pending",
  "processing",
  "queued",
  "completed",
  "settled",
  "confirmed",
  "failed",
  "declined",
  "cancelled",
  "expired",
  "reversed",
  "escrow",
  "frozen",
  "active",
];

/** Rising, then a dip — enough shape to show the endpoint dot and the fill. */
const SERIES = [12, 14, 13, 17, 16, 21, 24, 22, 27, 31, 29, 34];

export default function DesignSystemScreen() {
  const t = useTheme();
  const s = useStyles();
  const i18n = useI18n();

  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  const [amount, setAmount] = useState("12.5");
  const [seg, setSeg] = useState<"day" | "week" | "month">("week");
  const [tab, setTab] = useState("home");
  const [sheet, setSheet] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [hidden, setHidden] = useState(false);

  return (
    <View style={s.root}>
      <ScrollView contentContainerStyle={s.scroll}>
        {/* --- live theme readout ------------------------------------------ */}
        <FurlCard>
          <Text style={t.type("overline")}>ACTIVE THEME</Text>
          <FurlSummaryRow label="Mode" value={t.mode} />
          <FurlSummaryRow label="Resolved scheme" value={t.scheme} emphasis />
          <FurlSummaryRow label="Locale" value={i18n.locale} />
          <FurlSummaryRow label="Font scale" value={t.fontScale.toFixed(2)} />
          <FurlSummaryRow label="Size class" value={t.sizeClass} />
          <FurlSummaryRow
            label="Reduce motion"
            value={t.reduceMotion ? "on" : "off"}
            tone={t.reduceMotion ? "warning" : "default"}
          />
          <View style={s.rowWrap}>
            {(["system", "light", "dark"] as ThemeMode[]).map((m) => (
              <FurlButton
                key={m}
                title={m}
                size="sm"
                stretch={false}
                tone={t.mode === m ? "primary" : "neutral"}
                onPress={() => t.setMode(m)}
              />
            ))}
          </View>
        </FurlCard>

        {/* --- palette ----------------------------------------------------- */}
        <FurlSectionHeader title="Palette" />
        <FurlCard>
          <View style={s.swatches}>
            {(
              [
                ["bg", t.colors.bg],
                ["surface", t.colors.surface],
                ["raised", t.colors.surfaceRaised],
                ["border", t.colors.border],
                ["text", t.colors.text],
                ["textDim", t.colors.textDim],
                ["primary", t.colors.primary],
                ["accent", t.colors.accent],
                ["success", t.colors.success],
                ["warning", t.colors.warning],
                ["danger", t.colors.danger],
                ["info", t.colors.info],
              ] as const
            ).map(([name, value]) => (
              <View key={name} style={s.swatch}>
                <View style={[s.swatchChip, { backgroundColor: value }]} />
                <Text style={[t.type("caption"), { color: t.colors.textDim }]}>{name}</Text>
              </View>
            ))}
          </View>
        </FurlCard>

        {/* --- type scale -------------------------------------------------- */}
        <FurlSectionHeader title="Type scale" />
        <FurlCard>
          {(
            ["display", "title", "h1", "h2", "h3", "body", "callout", "dim", "caption", "overline", "mono"] as const
          ).map((role) => (
            <Text key={role} style={t.type(role)} numberOfLines={1}>
              {role} — 1,234.56
            </Text>
          ))}
        </FurlCard>

        {/* --- buttons ----------------------------------------------------- */}
        <FurlSectionHeader title="Buttons" />
        <FurlCard>
          <FurlButton title="Primary" onPress={() => {}} />
          <FurlSecondaryButton title="Secondary" onPress={() => {}} />
          <FurlButton title="Danger" tone="danger" onPress={() => {}} />
          <FurlButton title="Ghost" tone="ghost" onPress={() => {}} />
          <FurlButton title="With icon" icon="send" onPress={() => {}} />
          <FurlButton title="Loading" loading onPress={() => {}} />
          <FurlButton title="Disabled" disabled onPress={() => {}} />
          <View style={s.rowWrap}>
            <FurlButton title="sm" size="sm" stretch={false} onPress={() => {}} />
            <FurlButton title="md" size="md" stretch={false} onPress={() => {}} />
            <FurlButton title="lg" size="lg" stretch={false} onPress={() => {}} />
          </View>
          <View style={s.rowWrap}>
            <FurlIconButton icon="add" accessibilityLabel="Add" onPress={() => {}} />
            <FurlIconButton icon="qr-code" accessibilityLabel="Scan" tone="primary" onPress={() => {}} />
            <FurlIconButton icon="trash" accessibilityLabel="Delete" tone="danger" onPress={() => {}} />
            <FurlIconButton icon="close" accessibilityLabel="Close" size="sm" onPress={() => {}} />
          </View>
        </FurlCard>

        {/* --- inputs ------------------------------------------------------ */}
        <FurlSectionHeader title="Inputs" />
        <FurlCard>
          <FurlInput label="Label" placeholder="Placeholder" value={text} onChangeText={setText} clearable />
          <FurlInput label="With hint" placeholder="0x…" hint="Paste an address or scan a QR code." value="" onChangeText={() => {}} />
          <FurlInput label="With error" value="not-an-address" onChangeText={() => {}} error="That is not a valid address." />
          <FurlSearchBar value={search} onChangeText={setSearch} onVoice={() => {}} />
          <FurlAmountInput
            label={i18n.t("money.amount")}
            value={amount}
            onChangeValue={setAmount}
            symbol="USDC"
            onMax={() => setAmount("250")}
            secondary={`≈ ${i18n.formatCurrency(Number(amount) || 0)}`}
            hint={`Decimal separator for ${i18n.locale}: "${(1.1).toLocaleString(i18n.locale).replace(/\d/g, "")}"`}
          />
        </FurlCard>

        {/* --- money ------------------------------------------------------- */}
        <FurlSectionHeader title="Money" />
        <FurlCard>
          <FurlBalance
            label={i18n.t("money.balance")}
            amount={12345.67}
            hidden={hidden}
            onToggleHidden={() => setHidden((h) => !h)}
            secondary="Across 4 accounts"
          />
          <FurlBalance amount={0.4821} tokenSymbol="ETH" size="compact" label="Token balance" />
          <FurlSummaryRow label={i18n.t("money.fee")} value={i18n.formatCurrency(0.02)} />
          <FurlSummaryRow label={i18n.t("money.rate")} value="1 ETH = 3,214.55 USDC" />
          <FurlSummaryRow label={i18n.t("money.total")} value={i18n.formatCurrency(102.02)} emphasis />
          <FurlSummaryRow label="Risk" value="New recipient" tone="warning" />
        </FurlCard>

        <FurlCard padded={false} style={s.listCard}>
          <FurlTransactionRow
            title="Coffee — Blue Bottle"
            subtitle="Visa •••• 4242"
            amount={-4.5}
            status="completed"
            icon="cafe-outline"
            timestamp={Date.now() - 3600_000}
            onPress={() => {}}
          />
          <FurlTransactionRow
            title="Refund — Duffel"
            subtitle="Flight cancelled"
            amount={218.4}
            status="reversed"
            icon="airplane-outline"
            timestamp={Date.now() - 86_400_000}
          />
          <FurlTransactionRow
            title="Swap ETH → USDC"
            subtitle="Arbitrum"
            amount={-500}
            status="pending"
            icon="swap-horizontal-outline"
            timestamp={Date.now() - 120_000}
          />
          <FurlAssetRow symbol="ETH" name="Ethereum" balance={0.4821} fiatValue={1549.2} change={0.0234} onPress={() => {}} />
          <FurlAssetRow symbol="USDC" name="USD Coin" balance={1250} fiatValue={1250} change={-0.0012} />
        </FurlCard>

        {/* --- status ------------------------------------------------------ */}
        <FurlSectionHeader title="Status" />
        <FurlCard>
          <View style={s.rowWrap}>
            {ALL_STATUSES.map((st) => (
              <FurlStatusBadge key={st} status={st} />
            ))}
          </View>
        </FurlCard>

        {/* --- chart ------------------------------------------------------- */}
        <FurlSectionHeader title="Chart" />
        <FurlCard>
          <FurlChart data={SERIES} height={140} />
          <FurlChart data={[...SERIES].reverse()} height={80} />
          <FurlChart data={[5, 5, 5, 5]} height={60} />
          <FurlChart data={[]} height={60} />
        </FurlCard>

        {/* --- selection --------------------------------------------------- */}
        <FurlSectionHeader title="Selection" />
        <FurlCard>
          <FurlSegmented
            options={["day", "week", "month"] as const}
            value={seg}
            onChange={setSeg}
            labels={{ day: "Day", week: "Week", month: "Month" }}
          />
        </FurlCard>
        <FurlCard padded={false}>
          <OptionRow label="Selected option" selected onPress={() => {}} divider icon="checkmark-circle-outline" />
          <OptionRow label="Unselected option" sublabel="With a sub-label" selected={false} onPress={() => {}} divider />
          <OptionRow label="Disabled option" selected={false} onPress={() => {}} disabled />
        </FurlCard>

        {/* --- overlays ---------------------------------------------------- */}
        <FurlSectionHeader title="Overlays" />
        <FurlCard>
          <FurlButton title="Open bottom sheet" onPress={() => setSheet(true)} />
          <FurlSecondaryButton title="Open dialog" onPress={() => setDialog(true)} />
        </FurlCard>

        {/* --- navigation -------------------------------------------------- */}
        <FurlSectionHeader title="Navigation" />
        <FurlCard padded={false}>
          <FurlTopBar title="Screen title" subtitle="Optional subtitle" onBack={() => {}} />
        </FurlCard>

        {/* --- states ------------------------------------------------------ */}
        <FurlSectionHeader title="States" />
        <FurlCard padded={false}>
          <FurlSkeletonList rows={3} />
        </FurlCard>
        <FurlCard>
          <View style={{ gap: t.spacing.sm }}>
            <FurlSkeleton width="80%" />
            <FurlSkeleton width="55%" />
            <FurlSkeleton width={120} height={32} radius={t.radius.md} />
          </View>
        </FurlCard>
        <FurlCard padded={false}>
          <FurlEmptyState actionLabel="Add something" onAction={() => {}} />
        </FurlCard>
        <FurlCard padded={false}>
          <FurlErrorState error={new Error("Connection reset by peer")} onAction={() => {}} />
        </FurlCard>
        <FurlCard padded={false}>
          <FurlOfflineState />
        </FurlCard>
        <FurlCard padded={false}>
          {/* Fires a haptic + screen-reader announcement on mount by design. */}
          <FurlSuccessState body="Your payment is on its way." />
        </FurlCard>

        <View style={{ height: t.spacing.xxl }} />
      </ScrollView>

      <FurlTabBar
        tabs={[
          { key: "home", label: "Home", icon: "home-outline", iconActive: "home" },
          { key: "send", label: "Send", icon: "send-outline", iconActive: "send" },
          { key: "cards", label: "Cards", icon: "card-outline", iconActive: "card", badge: 3 },
          { key: "invest", label: "Invest", icon: "trending-up-outline" },
          { key: "settings", label: "Settings", icon: "settings-outline", badge: 128 },
        ]}
        active={tab}
        onChange={setTab}
      />

      <FurlBottomSheet open={sheet} title="Bottom sheet" onClose={() => setSheet(false)}>
        <Text style={[t.type("body"), { color: t.colors.textDim }]}>
          Dismissible by tapping the scrim, the close button, or the Android back button.
        </Text>
        <FurlSummaryRow label="Network" value="Arbitrum" />
        <FurlSummaryRow label="Fee" value={i18n.formatCurrency(0.01)} />
        <FurlButton title={i18n.t("common.done")} onPress={() => setSheet(false)} />
      </FurlBottomSheet>

      <FurlDialog
        open={dialog}
        title="Delete this contact?"
        body="This removes them from your address book. Past transactions are unaffected."
        destructive
        confirmLabel={i18n.t("common.delete")}
        onConfirm={() => setDialog(false)}
        onCancel={() => setDialog(false)}
      />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.colors.bg },
  scroll: { padding: t.spacing.md, gap: t.spacing.md },
  rowWrap: { flexDirection: "row", flexWrap: "wrap", gap: t.spacing.sm, alignItems: "center" },
  listCard: { paddingHorizontal: t.spacing.md },
  swatches: { flexDirection: "row", flexWrap: "wrap", gap: t.spacing.sm },
  swatch: { alignItems: "center", gap: 4, width: 64 },
  swatchChip: {
    width: 48,
    height: 32,
    borderRadius: t.radius.sm,
    borderWidth: 1,
    borderColor: t.colors.border,
  },
}));
