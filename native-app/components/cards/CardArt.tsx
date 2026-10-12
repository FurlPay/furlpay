import React from "react";
import { Image, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Circle, Path } from "react-native-svg";
import { FurlPayMark } from "@/components/trips/FurlPayMark";
import { CARD_DESIGNS, cardBackFields, specFor, type CardDesign, type CardSecrets } from "@/lib/cards/designs";
import { radius, spacing } from "@/lib/theme";

// ---------------------------------------------------------------------------
// Artwork for the three FurlPay card designs (electric, world, pearl), front
// and back. See lib/cards/designs.ts for where the colours come from.
//
// CardSurface is only the painted background — gradient, streaks, globe — so
// the cards tab can keep its own tilt and specular layers on top of it, and
// CardFace can keep its status overlays. Everything is absolutely positioned
// decoration behind `children`; it never takes part in layout.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-require-imports
const GLOBE = require("../../assets/cards/global-network.webp");

const PLAIN: readonly [string, string] = ["#0B1220", "#1E293B"];

export function CardSurface({
  design,
  gradient = PLAIN,
  style,
  children,
}: {
  design: CardDesign | null;
  /** Used only when `design` is null: an older two-colour theme. */
  gradient?: readonly [string, string];
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}) {
  const spec = specFor(design, gradient);
  return (
    <LinearGradient
      colors={spec.colors}
      locations={spec.locations}
      start={{ x: 0.1, y: 0 }}
      end={{ x: 0.9, y: 1 }}
      style={[styles.surface, { borderColor: spec.border }, style]}
    >
      {spec.art ? (
        <Image
          source={GLOBE}
          resizeMode="cover"
          style={StyleSheet.absoluteFill}
          accessibilityIgnoresInvertColors
        />
      ) : null}
      {spec.streaks ? (
        <LinearGradient
          pointerEvents="none"
          colors={spec.streaks.colors}
          locations={spec.streaks.locations}
          start={{ x: 0.15, y: 0 }}
          end={{ x: 0.85, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      {children}
    </LinearGradient>
  );
}

function Contactless({ color, size }: { color: string; size: number }) {
  return (
    <Svg width={(size * 36) / 40} height={size} viewBox="0 0 36 40" fill="none">
      <Path
        d="M9 16a9 9 0 010 8m6-13a18 18 0 010 18m6-24a29 29 0 010 30m6-35a39 39 0 010 40"
        stroke={color}
        strokeWidth={3}
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function NetworkMark({ network, color, scale = 1 }: { network: string; color: string; scale?: number }) {
  if (network === "Mastercard") {
    const d = 26 * scale;
    return (
      <Svg width={d * 1.62} height={d} viewBox="0 0 42 26" accessibilityLabel="Mastercard">
        <Circle cx={13} cy={13} r={12.5} fill="#ED1023" stroke="#FFFFFF" strokeWidth={0.6} />
        <Circle cx={29} cy={13} r={12.5} fill="#FFB500" fillOpacity={0.96} stroke="#FFFFFF" strokeWidth={0.6} />
      </Svg>
    );
  }
  return (
    <Text style={[styles.network, { color, fontSize: 19 * scale }]} allowFontScaling={false}>
      {network.toUpperCase()}
    </Text>
  );
}

/** Everything printed on the front. Lays out inside a padded CardSurface. */
export function CardFrontContent({
  design,
  label,
  kind,
  last4,
  network,
  settlementCurrency,
  scale = 1,
}: {
  design: CardDesign;
  label: string;
  kind: "virtual" | "physical";
  last4: string;
  network: string;
  settlementCurrency?: string;
  scale?: number;
}) {
  const spec = CARD_DESIGNS[design];
  return (
    <>
      <View style={styles.row}>
        <View style={styles.brand}>
          <FurlPayMark size={24 * scale} color={spec.ink} />
          <Text style={[styles.wordmark, { color: spec.ink, fontSize: 24 * scale }]} allowFontScaling={false}>
            FurlPay
          </Text>
        </View>
        <Contactless color={spec.ink} size={26 * scale} />
      </View>

      <View>
        <Text style={[styles.label, { color: spec.ink, fontSize: 15 * scale }]} numberOfLines={1} allowFontScaling={false}>
          {label}
        </Text>
        <Text style={[styles.kind, { color: spec.inkDim, fontSize: 10.5 * scale }]} allowFontScaling={false}>
          {kind === "physical" ? "Physical" : "Virtual"}
          {settlementCurrency ? ` · ${settlementCurrency}` : ""}
        </Text>
      </View>

      <View style={[styles.row, { alignItems: "center" }]}>
        <Text style={[styles.pan, { color: spec.ink, fontSize: 17 * scale }]} allowFontScaling={false}>
          •••• {last4}
        </Text>
        <NetworkMark network={network} color={spec.ink} scale={scale} />
      </View>
    </>
  );
}

/**
 * The back of the card: magnetic stripe, signature panel with the security
 * code, the number and the expiry.
 *
 * `secrets` is the issuer vault's response and nothing else. With `null` every
 * field is a mask — the back still looks like a card back, but it shows no
 * digit the app did not receive.
 */
export function CardBack({
  design,
  gradient = PLAIN,
  last4,
  network,
  secrets,
  style,
}: {
  design: CardDesign | null;
  gradient?: readonly [string, string];
  last4: string;
  network: string;
  secrets: CardSecrets | null;
  style?: StyleProp<ViewStyle>;
}) {
  const spec = specFor(design, gradient);
  const f = cardBackFields(last4, secrets);
  const a11y = f.revealed
    ? `Back of card. Number ${f.number.split("").join(" ")}. Expires ${f.expiry}. Security code ${f.cvv.split("").join(" ")}.`
    : `Back of card ending in ${last4}. Card number, expiry and security code are hidden.`;
  return (
    <CardSurface design={design} gradient={gradient} style={[styles.back, style]}>
      <View accessible accessibilityRole="image" accessibilityLabel={a11y} style={styles.backInner}>
        <View style={[styles.stripe, { backgroundColor: spec.light ? "#1B2040" : "#02040C" }]} />

        <View style={styles.signatureRow}>
          <View style={styles.signature} />
          <View style={styles.cvvBox}>
            <Text style={styles.cvvCaption} allowFontScaling={false}>
              CVV
            </Text>
            <Text style={styles.cvv} allowFontScaling={false}>
              {f.cvv}
            </Text>
          </View>
        </View>

        <View style={styles.backFields}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.caption, { color: spec.inkDim }]} allowFontScaling={false}>
              CARD NUMBER
            </Text>
            <Text
              style={[styles.backNumber, { color: spec.ink }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              allowFontScaling={false}
            >
              {f.number}
            </Text>
          </View>
          <View>
            <Text style={[styles.caption, { color: spec.inkDim }]} allowFontScaling={false}>
              EXPIRES
            </Text>
            <Text style={[styles.backNumber, { color: spec.ink }]} allowFontScaling={false}>
              {f.expiry}
            </Text>
          </View>
        </View>

        <View style={[styles.row, { alignItems: "center", paddingHorizontal: spacing.md + 2 }]}>
          <Text style={[styles.caption, { color: spec.inkDim }]} allowFontScaling={false}>
            furlpay.com
          </Text>
          <NetworkMark network={network} color={spec.ink} scale={0.72} />
        </View>
      </View>
    </CardSurface>
  );
}

const styles = StyleSheet.create({
  surface: {
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: "hidden",
  },
  row: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.sm },
  brand: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 },
  wordmark: { fontWeight: "700", letterSpacing: -0.8 },
  label: { fontWeight: "700" },
  kind: { textTransform: "uppercase", letterSpacing: 1, marginTop: 1 },
  pan: { fontWeight: "700", letterSpacing: 2, fontVariant: ["tabular-nums"] },
  network: { fontWeight: "800", fontStyle: "italic", letterSpacing: 0.5 },

  back: { minHeight: 190 },
  backInner: { flex: 1, justifyContent: "space-between", paddingTop: spacing.md + 4, paddingBottom: spacing.md },
  stripe: { height: 38 },
  signatureRow: {
    flexDirection: "row",
    alignItems: "stretch",
    marginHorizontal: spacing.md + 2,
    height: 34,
    borderRadius: 4,
    overflow: "hidden",
  },
  signature: { flex: 1, backgroundColor: "rgba(255,255,255,0.86)" },
  cvvBox: {
    minWidth: 78,
    paddingHorizontal: 10,
    backgroundColor: "#FFFFFF",
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: "rgba(0,0,0,0.25)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  cvvCaption: { color: "#5A607A", fontSize: 9, fontWeight: "700", letterSpacing: 1 },
  cvv: {
    color: "#11142A",
    fontSize: 15,
    fontWeight: "700",
    fontStyle: "italic",
    letterSpacing: 2,
    fontVariant: ["tabular-nums"],
  },
  backFields: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.md,
    paddingHorizontal: spacing.md + 2,
  },
  caption: { fontSize: 9, fontWeight: "700", letterSpacing: 1.2 },
  backNumber: {
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 1.5,
    marginTop: 2,
    fontVariant: ["tabular-nums"],
  },
});
