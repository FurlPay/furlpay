import React from "react";
import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { FurlCard } from "@/components/furl";
import { useTheme } from "@/lib/design";
import { useI18n } from "@/lib/i18n";
import { RISK_ORDER, type RiskLevel, type ScanResult } from "@/lib/txscan";

// ---------------------------------------------------------------------------
// The scan verdict, rendered.
//
// FINDINGS ARE ORDERED MOST SEVERE FIRST and shown in full. The temptation is
// to show a single headline verdict and hide the detail behind "see more",
// which reads better and means the one sentence that would have stopped the
// user is one tap away from where they are looking.
//
// "NOT CHECKED" IS RENDERED AS ITS OWN STATE, never as green. A scan that did
// not run is a gap in knowledge, and colouring it as safe would put the word
// the user acts on in front of a transaction nothing examined.
//
// COLOUR IS NEVER THE ONLY SIGNAL. Each level carries an icon and a text
// label, because a red border means nothing to a user with a colour vision
// deficiency and nothing at all to a screen reader.
// ---------------------------------------------------------------------------

const ICONS: Record<RiskLevel, keyof typeof Ionicons.glyphMap> = {
  safe: "checkmark-circle-outline",
  unknown: "help-circle-outline",
  caution: "alert-circle-outline",
  danger: "warning-outline",
};

export function RiskFindings({ scan }: { scan: ScanResult }) {
  const t = useTheme();
  const { t: tr } = useI18n();

  const tint = (level: RiskLevel): string =>
    level === "danger" ? t.colors.danger : level === "caution" ? t.colors.warning : t.colors.textDim;

  const label = (level: RiskLevel): string =>
    level === "danger"
      ? tr("walletConnect.riskDanger")
      : level === "caution"
        ? tr("walletConnect.riskCaution")
        : level === "unknown"
          ? tr("walletConnect.riskUnknown")
          : tr("walletConnect.riskSafe");

  // Most severe first, stable within a level so the order does not flicker
  // between renders of the same scan.
  const findings = [...scan.findings].sort((a, b) => RISK_ORDER[b.level] - RISK_ORDER[a.level]);

  return (
    <FurlCard style={scan.level === "danger" ? { borderColor: t.colors.danger } : undefined}>
      <View style={{ gap: t.spacing.sm }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: t.spacing.xs }}>
          <Ionicons name={ICONS[scan.level]} size={t.component.icon.md} color={tint(scan.level)} />
          <Text style={[t.type("body"), { color: tint(scan.level), flex: 1 }]}>{label(scan.level)}</Text>
        </View>

        {findings.map((f) => (
          <View key={f.id} style={{ gap: 2 }}>
            <Text style={[t.type("callout"), { color: tint(f.level) }]}>{f.title}</Text>
            {f.detail ? (
              <Text style={[t.type("caption"), { color: t.colors.textDim }]}>{f.detail}</Text>
            ) : null}
          </View>
        ))}

        {/* Whether a provider actually simulated against chain state. Stated
            plainly because "we checked" and "we could not check" are the two
            things a user most needs to tell apart, and only one of them
            justifies confidence in an empty findings list. */}
        {!scan.simulated ? (
          <Text style={[t.type("caption"), { color: t.colors.textDim }]}>
            {tr("walletConnect.notChecked")}
          </Text>
        ) : null}

        {scan.deltas.length === 0 && scan.category !== "signature" ? (
          <Text style={[t.type("caption"), { color: t.colors.textDim }]}>
            {tr("walletConnect.cannotDetermine")}
          </Text>
        ) : null}
      </View>
    </FurlCard>
  );
}
