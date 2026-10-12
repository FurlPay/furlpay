import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing, type } from "@/lib/theme";
import type { CardStatus } from "@/lib/cards/lifecycle";
import { CardFrontContent, CardSurface } from "@/components/cards/CardArt";
import { designFor, type CardDesign } from "@/lib/cards/designs";

// ---------------------------------------------------------------------------
// The card itself.
//
// Lifted out of app/(tabs)/cards.tsx, which had it as a local component — so
// the order flow, the card detail screen and the tab each drew their own and
// the three could disagree about what a FurlPay card looks like.
//
// THE OVERLAY STATES ARE THE REASON THIS IS WORTH A COMPONENT. A card can be
// frozen, awaiting activation, reported lost, or closed, and each of those has
// to be legible from the artwork alone — a user scrolling a carousel is looking
// at pictures, not reading status rows. They are rendered as one dimming layer
// with one label, never stacked, because "Frozen · Not activated · Closed" on
// one card is three answers to a question that has one.
//
// ORDER OF PRECEDENCE, most permanent first: closed and lost outrank "needs
// activating", which outranks a freeze. A lost card is also frozen server-side;
// saying "Frozen" about it would understate what happened.
// ---------------------------------------------------------------------------

export interface CardFaceProps {
  label: string;
  last4: string;
  network: string;
  kind: "virtual" | "physical";
  gradient: readonly [string, string];
  /** The card's theme id. When it (or the gradient) names one of the three
   *  FurlPay designs, that artwork is drawn instead of the plain gradient. */
  themeId?: string;
  settlementCurrency?: string;
  frozen?: boolean;
  status?: CardStatus;
  /** Shrinks everything proportionally for a preview or a dense list. */
  compact?: boolean;
}

interface Overlay {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  tint: string;
}

function overlayFor(props: CardFaceProps): Overlay | null {
  const { status, frozen } = props;
  if (status === "closed") return { label: "Closed", icon: "close-circle", tint: colors.textDim };
  if (status === "lost") return { label: "Reported lost", icon: "alert-circle", tint: colors.accent };
  if (status === "ordered" || status === "shipped") {
    return {
      label: status === "shipped" ? "In the post" : "Being made",
      icon: "cube-outline",
      tint: colors.warning,
    };
  }
  if (frozen) return { label: "Frozen", icon: "snow", tint: "#4CC2FF" };
  return null;
}

export function CardFace(props: CardFaceProps) {
  const { label, last4, network, kind, gradient, settlementCurrency, compact = false } = props;
  const overlay = overlayFor(props);
  const scale = compact ? 0.78 : 1;
  const design: CardDesign | null = designFor({ themeId: props.themeId, gradient });

  const overlayNode = overlay ? (
    <View style={styles.overlay}>
      <View style={styles.overlayPill}>
        <Ionicons name={overlay.icon} size={14} color={overlay.tint} />
        <Text style={styles.overlayText} allowFontScaling={false}>
          {overlay.label}
        </Text>
      </View>
    </View>
  ) : null;

  if (design) {
    return (
      <View style={styles.shadow}>
        <CardSurface design={design} style={[styles.card, compact && styles.cardCompact]}>
          <CardFrontContent
            design={design}
            label={label}
            kind={kind}
            last4={last4}
            network={network}
            settlementCurrency={settlementCurrency}
            scale={scale}
          />
          {overlayNode}
        </CardSurface>
      </View>
    );
  }

  return (
    <View style={styles.shadow}>
      <LinearGradient
        colors={[gradient[0], gradient[1]]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.card, compact && styles.cardCompact]}
      >
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text
              style={[styles.label, { fontSize: 16 * scale }]}
              numberOfLines={1}
              allowFontScaling={false}
            >
              {label}
            </Text>
            <Text style={[styles.kind, { fontSize: 11 * scale }]} allowFontScaling={false}>
              {kind === "physical" ? "Physical" : "Virtual"}
            </Text>
          </View>
          <Text style={[styles.network, { fontSize: 18 * scale }]} allowFontScaling={false}>
            {network}
          </Text>
        </View>

        <View style={[styles.chip, compact && { width: 32, height: 24 }]} />

        <View style={styles.row}>
          <Text style={[styles.pan, { fontSize: 17 * scale }]} allowFontScaling={false}>
            •••• {last4}
          </Text>
          {settlementCurrency ? (
            <Text style={[styles.currency, { fontSize: 13 * scale }]}>{settlementCurrency}</Text>
          ) : null}
        </View>

        {overlayNode}
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  shadow: {
    borderRadius: radius.lg,
    // Elevation rather than a border: a card is an object, and outlining it
    // makes it read as a UI panel that happens to be card-shaped.
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  card: {
    borderRadius: radius.lg,
    padding: spacing.md + 2,
    minHeight: 190,
    justifyContent: "space-between",
    overflow: "hidden",
  },
  cardCompact: { minHeight: 140, padding: spacing.md },
  row: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.sm },
  label: { color: "#FFFFFF", fontWeight: "700" },
  kind: {
    color: "rgba(255,255,255,0.7)",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginTop: 1,
  },
  network: { color: "#FFFFFF", fontWeight: "800", fontStyle: "italic" },
  chip: {
    width: 40,
    height: 30,
    borderRadius: 6,
    backgroundColor: "rgba(255,255,255,0.28)",
  },
  pan: {
    color: "#FFFFFF",
    fontWeight: "700",
    letterSpacing: 2,
    fontVariant: ["tabular-nums"],
  },
  currency: { color: "rgba(255,255,255,0.7)", fontWeight: "600" },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.lg,
  },
  overlayPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    borderRadius: radius.pill,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  overlayText: { color: colors.text, fontWeight: "700", fontSize: 13 },
});

/** Placeholder used while a card is being ordered — the artwork the user is
 *  choosing, with no number to show yet. */
export function CardFacePreview({
  label,
  network,
  kind,
  gradient,
  themeId,
}: {
  label: string;
  network: string;
  kind: "virtual" | "physical";
  gradient: readonly [string, string];
  themeId?: string;
}) {
  return (
    <CardFace
      label={label || "Your card"}
      last4="••••"
      network={network}
      kind={kind}
      gradient={gradient}
      themeId={themeId}
      compact
    />
  );
}

/** Shared status chip, so the tab, the detail screen and the order receipt all
 *  say the same word in the same colour. */
export function StatusChip({ label, tone }: { label: string; tone: "good" | "warn" | "bad" | "neutral" }) {
  const palette = {
    good: { bg: colors.neonSoft, fg: colors.neon },
    warn: { bg: "#2A230A", fg: colors.warning },
    bad: { bg: "#2A0A0A", fg: colors.accent },
    neutral: { bg: colors.surfaceRaised, fg: colors.textDim },
  }[tone];
  return (
    <View style={[chipStyles.chip, { backgroundColor: palette.bg }]}>
      <View style={[chipStyles.dot, { backgroundColor: palette.fg }]} />
      <Text style={[chipStyles.text, { color: palette.fg }]}>{label}</Text>
    </View>
  );
}

const chipStyles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  text: { fontSize: 11, fontWeight: "800", letterSpacing: 0.4, textTransform: "uppercase" },
});

/** Re-exported so screens can lay out beside a card without hardcoding 190. */
export const CARD_MIN_HEIGHT = 190;
export const CARD_TYPE = type;
