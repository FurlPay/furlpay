import React from "react";
import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { makeStyles, useTheme } from "@/lib/design";
import { useI18n } from "@/lib/i18n";
import type { SemanticColors } from "@/lib/design";

// ---------------------------------------------------------------------------
// Transaction status.
//
// The set below is CLOSED and exhaustive. Every financial record in the app
// resolves to exactly one of these, which is what makes "is my money gone?"
// answerable — the previous free-string status meant `declined` and `Declined`
// and `DECLINED` were three different states as far as the UI was concerned.
//
// TERMINALITY is the distinction that matters most to a user:
//   in flight  pending | processing | queued  -> money is committed, not final
//   final good completed | settled | confirmed
//   final bad  failed | declined | cancelled | expired
//   unwound    reversed  -> it happened, then it was undone
//   held       escrow | frozen | active       -> not a payment outcome
// ---------------------------------------------------------------------------

export type MoneyStatus =
  | "pending"
  | "processing"
  | "queued"
  | "completed"
  | "settled"
  | "confirmed"
  | "failed"
  | "declined"
  | "cancelled"
  | "expired"
  | "reversed"
  | "escrow"
  | "frozen"
  | "active";

type Tone = "neutral" | "progress" | "good" | "bad" | "warn" | "info";

const TONE: Record<MoneyStatus, Tone> = {
  pending: "progress",
  processing: "progress",
  queued: "progress",
  completed: "good",
  settled: "good",
  confirmed: "good",
  active: "good",
  failed: "bad",
  declined: "bad",
  cancelled: "neutral",
  expired: "neutral",
  // Not an error — the money came back — but it is not a completed payment
  // either, so it gets its own warning tone rather than being coloured green.
  reversed: "warn",
  escrow: "info",
  frozen: "info",
};

/**
 * A glyph per tone.
 *
 * Colour alone does not survive a colour-blind user, a greyscale screenshot in
 * a support ticket, or a phone in bright sun. The icon is the redundant channel.
 */
const GLYPH: Record<Tone, keyof typeof Ionicons.glyphMap> = {
  neutral: "remove-circle-outline",
  progress: "time-outline",
  good: "checkmark-circle",
  bad: "close-circle",
  warn: "return-down-back",
  info: "lock-closed-outline",
};

function toneColors(tone: Tone, c: SemanticColors): { fg: string; bg: string } {
  switch (tone) {
    case "good":
      return { fg: c.success, bg: c.successSoft };
    case "bad":
      return { fg: c.danger, bg: c.dangerSoft };
    case "warn":
      return { fg: c.warning, bg: c.warningSoft };
    case "info":
      return { fg: c.info, bg: c.infoSoft };
    case "progress":
      return { fg: c.warning, bg: c.warningSoft };
    default:
      return { fg: c.textDim, bg: c.surfaceRaised };
  }
}

export function FurlStatusBadge({
  status,
  compact,
  style,
}: {
  status: MoneyStatus;
  /** Drops the icon and shrinks the type — for use inside a dense list row. */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const s = useStyles();
  const { t: tr } = useI18n();
  const tone = TONE[status];
  const { fg, bg } = toneColors(tone, t.colors);
  const label = tr(`status.${status}`);

  return (
    <View
      style={[s.badge, { backgroundColor: bg }, style]}
      accessible
      // Announce the WORD, not the colour. "Failed", not "red badge".
      accessibilityLabel={label}
    >
      {!compact ? <Ionicons name={GLYPH[tone]} size={12} color={fg} /> : null}
      <Text style={[t.type(compact ? "caption" : "overline"), { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** True while the money is committed but not yet final — used to gate retries. */
export function isInFlight(status: MoneyStatus): boolean {
  return TONE[status] === "progress";
}

/** True once the outcome can no longer change. */
export function isTerminal(status: MoneyStatus): boolean {
  return (
    status === "completed" ||
    status === "settled" ||
    status === "confirmed" ||
    status === "failed" ||
    status === "declined" ||
    status === "cancelled" ||
    status === "expired" ||
    status === "reversed"
  );
}

/**
 * Normalize a status string arriving from the API.
 *
 * Returns `null` for anything unrecognized rather than guessing. A status the
 * client does not understand must NOT be rendered as "completed" — showing an
 * unknown state as success is the worst available failure mode here.
 */
export function parseStatus(raw: string | null | undefined): MoneyStatus | null {
  if (!raw) return null;
  const k = raw.trim().toLowerCase();
  return k in TONE ? (k as MoneyStatus) : null;
}

const useStyles = makeStyles((t) => ({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: t.component.badge.paddingX,
    paddingVertical: t.component.badge.paddingY,
    borderRadius: t.component.badge.radius,
    alignSelf: "flex-start",
  },
}));
