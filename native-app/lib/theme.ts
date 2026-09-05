// FurlPay mobile theme — COMPATIBILITY LAYER.
//
// The real design system now lives in lib/design/ (tokens.ts + theme.tsx).
// This file survives so the ~200 screens that already import { colors, spacing,
// radius, type } keep compiling and keep rendering exactly as they did, while
// they migrate one at a time.
//
// WHAT THIS FILE CANNOT DO: react to the theme. Every value here is the DARK
// scheme, frozen. `StyleSheet.create` snapshots whatever it is handed, so a
// screen built on these constants is a dark-mode screen no matter what the user
// picked.
//
// MIGRATING A SCREEN — replace
//     import { colors, spacing, type } from "@/lib/theme";
//     const styles = StyleSheet.create({ card: { backgroundColor: colors.surface } });
// with
//     import { makeStyles } from "@/lib/design";
//     const useStyles = makeStyles((t) => ({ card: { backgroundColor: t.colors.surface } }));
// and read `const s = useStyles();` inside the component.
//
// Colour mapping, old name -> new role:
//   neon      -> primary       neonDeep -> primaryDeep
//   neonSoft  -> primarySoft   onNeon   -> onPrimary
// The old names are mint-specific; the new ones say what the colour is FOR,
// which is what lets the light scheme use a different mint.

import { schemes, spacing as spacingTokens, radius as radiusTokens } from "./design/tokens";

const dark = schemes.dark;

/** @deprecated Dark scheme only. Use `useTheme().colors` / `makeStyles`. */
export const colors = {
  bg: dark.bg,
  surface: dark.surface,
  surfaceRaised: dark.surfaceRaised,
  border: dark.border,
  text: dark.text,
  textDim: dark.textDim,
  textFaint: dark.textFaint,
  neon: dark.primary,
  neonDeep: dark.primaryDeep,
  neonSoft: dark.primarySoft,
  accent: dark.accent,
  accentDeep: dark.accentDeep,
  warning: dark.warning,
  onNeon: dark.onPrimary,
} as const;

export const spacing = spacingTokens;
export const radius = radiusTokens;

// Signature "selected" treatment — a soft luminous gradient border used ONLY on
// active/selected pills (see components/GlowSelectionPill). Warm amber → pale
// silver → FurlPay mint. Defined centrally so the accent stays consistent.
export const glow = {
  gradient: ["#E8B77A", "#D9E2DD", dark.primary] as const,
  glowColor: dark.primary,
} as const;

/** @deprecated Dark scheme, unscaled. Use `useTheme().type("body")`. */
export const type = {
  title: { fontSize: 28, fontWeight: "700" as const, color: colors.text },
  h2: { fontSize: 20, fontWeight: "700" as const, color: colors.text },
  body: { fontSize: 15, color: colors.text },
  dim: { fontSize: 13, color: colors.textDim },
  mono: { fontSize: 13, color: colors.textDim, fontFamily: "monospace" },
} as const;
