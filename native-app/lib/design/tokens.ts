// FurlPay design tokens.
//
// THE ONE RULE: a screen names a ROLE ("the ground behind a card", "text that
// is secondary"), never a colour. Roles resolve per scheme, which is what makes
// light mode possible at all — a literal `#0D0D0D` in a screen is a dark-mode
// assumption that light mode cannot undo.
//
// The DARK values below are byte-identical to the ones that shipped in
// lib/theme.ts. That is deliberate: the dark app is the one users have, and
// this file must not restyle it while adding a second scheme. Light is a
// designed counterpart — NOT an inversion. Inverting an OLED-black palette
// yields grey-on-white mush and an unreadable mint, so each light role was
// picked for contrast against its own ground.
//
// Contrast floors targeted (WCAG 2.1):
//   body text on its ground      >= 4.5:1
//   secondary text on its ground >= 4.5:1
//   large text / icons / borders >= 3:1
//   text on a filled button      >= 4.5:1

export type ColorScheme = "light" | "dark";

/**
 * Semantic colour roles. Every screen consumes THIS shape, never a raw hex.
 * Adding a role means adding it to both schemes below — the type makes a
 * half-finished scheme a compile error rather than an unreadable screen.
 */
export interface SemanticColors {
  // --- grounds -------------------------------------------------------------
  /** The page itself. */
  bg: string;
  /** A card, sheet, input — one step off the page. */
  surface: string;
  /** A control sitting ON a surface: segmented track, stepper, avatar well. */
  surfaceRaised: string;
  /** Sunken well: code blocks, QR mats, read-only value boxes. */
  surfaceSunken: string;
  /** Scrim behind a modal or sheet. */
  scrim: string;

  // --- lines ---------------------------------------------------------------
  border: string;
  /** A border that must be seen (focused field, selected card). */
  borderStrong: string;
  /** Hairline between list rows — quieter than `border`. */
  divider: string;

  // --- text ----------------------------------------------------------------
  text: string;
  /** Secondary copy, labels, captions. Still >= 4.5:1. */
  textDim: string;
  /** Placeholders and disabled text. Decorative weight only. */
  textFaint: string;
  /** Text drawn on `primary` / `accent` / `info` fills. */
  onPrimary: string;
  onAccent: string;
  onInfo: string;

  // --- brand primary (FurlPay mint) ---------------------------------------
  /** Fill for the main call to action. */
  primary: string;
  /** Pressed / deeper variant of the fill. */
  primaryDeep: string;
  /** Primary used AS TEXT or an icon on `bg`/`surface`. Differs from `primary`
   *  in light mode, where the button mint is too light to read as text. */
  primaryText: string;
  /** Tinted ground for a primary-flavoured badge or banner. */
  primarySoft: string;

  // --- accent (FurlPay red) ------------------------------------------------
  /** FILL for a destructive control. Must carry `onAccent` at >= 4.5:1. */
  accent: string;
  accentDeep: string;
  /** Accent used AS TEXT or an icon on `bg`/`surface`/`accentSoft`. */
  accentText: string;
  accentSoft: string;

  // --- status --------------------------------------------------------------
  //
  // These are TEXT/ICON roles, not fills: they are drawn on their matching
  // `*Soft` ground in a badge, or on `bg` as a state icon. A destructive FILL
  // uses `accent`, which is the role that carries `onAccent`. One token cannot
  // do both — a red dark enough to carry white text is too dark to read as a
  // badge label on a dark ground, and vice versa.
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  info: string;
  infoSoft: string;

  // --- money ---------------------------------------------------------------
  /** Value moving IN. Never the only signal — always paired with a +/- sign,
   *  because ~1 in 12 men cannot separate these two hues. */
  credit: string;
  /** Value moving OUT. */
  debit: string;

  // --- charts --------------------------------------------------------------
  /** Categorical series, in order. Ordered for distinguishability, and each
   *  member clears 3:1 against both schemes' `surface`. */
  chart: readonly string[];
  chartGrid: string;
  /** Positive / negative price movement (separate from credit/debit so a
   *  market can be red-down while a refund is green-in). */
  chartUp: string;
  chartDown: string;

  // --- skeleton ------------------------------------------------------------
  skeleton: string;
  skeletonHighlight: string;
}

const dark: SemanticColors = {
  bg: "#000000",
  surface: "#0D0D0D",
  surfaceRaised: "#161616",
  surfaceSunken: "#080808",
  scrim: "rgba(0,0,0,0.6)",

  border: "#232323",
  borderStrong: "#3A3A3A",
  divider: "#1A1A1A",

  text: "#FFFFFF",
  textDim: "#9CA3AF",
  textFaint: "#6B7280",
  onPrimary: "#00170F",
  onAccent: "#FFFFFF",
  onInfo: "#04121C",

  primary: "#00E599",
  primaryDeep: "#00B87A",
  primaryText: "#00E599",
  primarySoft: "#0A2A22",

  // #FF3B30 under white text is 3.55:1 — it FAILS as a button fill. The deeper
  // red carries white at 4.78:1; the bright one survives as `accentText`.
  accent: "#E02020",
  accentDeep: "#B41A1A",
  accentText: "#FF3B30",
  accentSoft: "#2A0A0A",

  success: "#00E599",
  successSoft: "#0A2A22",
  warning: "#F59E0B",
  warningSoft: "#2A230A",
  danger: "#FF3B30",
  dangerSoft: "#2A0A0A",
  info: "#4CC2FF",
  infoSoft: "#0A1A2A",

  credit: "#00E599",
  debit: "#FF6B6B",

  chart: ["#00E599", "#4CC2FF", "#F59E0B", "#C084FC", "#FF6B6B", "#5EEAD4"],
  chartGrid: "#1A1A1A",
  chartUp: "#00E599",
  chartDown: "#FF3B30",

  skeleton: "#141414",
  skeletonHighlight: "#1F1F1F",
};

const light: SemanticColors = {
  // Not pure white: a full-white ground under an all-day finance app is
  // fatiguing and makes every card border look like a seam. A hair of the
  // brand's cool green bias keeps it related to the dark scheme.
  bg: "#FBFCFC",
  surface: "#FFFFFF",
  surfaceRaised: "#F1F4F3",
  surfaceSunken: "#F1F4F3",
  scrim: "rgba(16,24,20,0.45)",

  border: "#DEE4E2",
  borderStrong: "#B6C0BC",
  divider: "#EAEEEC",

  text: "#0A1512",
  textDim: "#59665F", //  6.2:1 on bg
  textFaint: "#8B978F", //  3.1:1 — placeholders/disabled only, never body copy
  onPrimary: "#FFFFFF",
  onAccent: "#FFFFFF",
  onInfo: "#FFFFFF",

  // #00E599 is 1.6:1 on white — unusable as a fill under white text and
  // unreadable as text. The light scheme drops to a deeper mint for both.
  primary: "#00875A", //  4.6:1 with #FFFFFF on top
  primaryDeep: "#006D48",
  primaryText: "#006D48", //  5.9:1 on bg
  primarySoft: "#E3F7EF",

  accent: "#D92D20", //  4.8:1 with #FFFFFF on top
  accentDeep: "#B42318",
  accentText: "#B42318", //  6.1:1 on bg
  accentSoft: "#FEE4E2",

  // Deeper than `primary`/`accent` on purpose. These are read on the TINTED
  // `*Soft` grounds, where the fill colours miss the 4.5:1 floor: #00875A is
  // only 4.08:1 on successSoft and #D92D20 only 4.01:1 on dangerSoft.
  success: "#00754E", //  5.15:1 on successSoft, 5.59:1 on bg
  successSoft: "#E3F7EF",
  warning: "#B54708", //  4.78:1 on warningSoft — the dark amber is 2.1:1 here
  warningSoft: "#FEF0C7",
  danger: "#B42318", //  5.45:1 on dangerSoft, 6.40:1 on bg
  dangerSoft: "#FEE4E2",
  info: "#175CD3",
  infoSoft: "#D1E9FF",

  credit: "#00754E",
  debit: "#B42318",

  chart: ["#00875A", "#175CD3", "#B54708", "#7839EE", "#C01048", "#0E9384"],
  chartGrid: "#EAEEEC",
  chartUp: "#00875A",
  chartDown: "#D92D20",

  skeleton: "#EDF1EF",
  skeletonHighlight: "#F7FAF9",
};

export const schemes: Record<ColorScheme, SemanticColors> = { light, dark };

// ---------------------------------------------------------------------------
// Scheme-independent tokens
// ---------------------------------------------------------------------------

/** 4pt base scale. `xs`..`xl` keep their shipped values; `xxl`/`xxxl` are new. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  xxxl: 64,
} as const;

export const radius = {
  sm: 8,
  md: 14,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;

export const border = {
  hairline: 1,
  thin: 1,
  thick: 2,
} as const;

/**
 * Type scale. Sizes are in points and are multiplied by the OS font-scale at
 * render time (see `useTypography`), so this is the scale at 100% only.
 *
 * `tabular: true` marks styles whose digits must line up in a column — every
 * balance, amount and fee. Without it a proportional font makes a scrolling
 * list of amounts jitter horizontally.
 */
export const typeScale = {
  display: { fontSize: 34, lineHeight: 40, fontWeight: "700", tabular: true },
  title: { fontSize: 28, lineHeight: 34, fontWeight: "700" },
  h1: { fontSize: 24, lineHeight: 30, fontWeight: "700" },
  h2: { fontSize: 20, lineHeight: 26, fontWeight: "700" },
  h3: { fontSize: 17, lineHeight: 22, fontWeight: "600" },
  body: { fontSize: 15, lineHeight: 21, fontWeight: "400" },
  bodyStrong: { fontSize: 15, lineHeight: 21, fontWeight: "600" },
  callout: { fontSize: 14, lineHeight: 19, fontWeight: "400" },
  dim: { fontSize: 13, lineHeight: 18, fontWeight: "400" },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: "400" },
  overline: { fontSize: 11, lineHeight: 14, fontWeight: "700", letterSpacing: 0.6 },
  mono: { fontSize: 13, lineHeight: 18, fontWeight: "400", mono: true, tabular: true },
  amount: { fontSize: 32, lineHeight: 38, fontWeight: "700", tabular: true },
  amountSmall: { fontSize: 15, lineHeight: 20, fontWeight: "600", tabular: true },
} as const;

export type TypeRole = keyof typeof typeScale;

/**
 * Elevation. Android reads `elevation`; iOS reads the shadow triple. Both are
 * emitted so a card looks the same on either platform, and the shadow colour
 * is scheme-dependent (a black shadow on a black ground is invisible, so the
 * dark scheme leans on the border instead).
 */
export const elevation = {
  none: { elevation: 0, shadowOpacity: 0, shadowRadius: 0, shadowOffset: { width: 0, height: 0 } },
  sm: { elevation: 2, shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } },
  md: { elevation: 6, shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  lg: { elevation: 12, shadowOpacity: 0.18, shadowRadius: 20, shadowOffset: { width: 0, height: 8 } },
} as const;

export type ElevationRole = keyof typeof elevation;

/**
 * Motion. Every duration here is multiplied by 0 when the OS "reduce motion"
 * switch is on (see `useMotion`) — a financial app must never animate at a
 * user who has asked it not to.
 */
export const motion = {
  instant: 0,
  fast: 120,
  normal: 220,
  slow: 380,
  /** A success confirmation holds slightly longer — it is the receipt. */
  celebrate: 600,
} as const;

/**
 * The shape of a motion scale, with the durations WIDENED to `number`.
 *
 * `motion` above is `as const`, so `fast` has the literal type `120` — which
 * makes the all-zero reduced-motion scale unassignable to it. Consumers take
 * this type instead, so "no animation" is a representable motion scale rather
 * than a type error.
 */
export type MotionScale = Record<keyof typeof motion, number>;

/** Every duration zeroed, for when the OS reports "reduce motion". */
export const noMotion: MotionScale = {
  instant: 0,
  fast: 0,
  normal: 0,
  slow: 0,
  celebrate: 0,
};

/** Android's minimum is 48dp, Apple's is 44pt. Take the stricter of the two. */
export const touchTarget = { min: 48 } as const;

export const zIndex = {
  base: 0,
  sticky: 10,
  header: 20,
  sheet: 30,
  dialog: 40,
  toast: 50,
} as const;

/**
 * Component-level tokens. These exist so "how tall is a button" has ONE answer
 * across 55 routes, rather than each screen re-deciding it.
 */
export const component = {
  button: {
    heightSm: 36,
    heightMd: 48,
    heightLg: 56,
    paddingX: spacing.md,
    radius: radius.md,
    gap: 10,
  },
  input: {
    height: 48,
    paddingX: spacing.md,
    radius: radius.md,
  },
  card: {
    padding: spacing.md,
    radius: radius.md,
    gap: spacing.sm,
  },
  sheet: {
    radius: radius.lg,
    padding: spacing.md,
    maxHeight: "85%",
    handleWidth: 36,
    handleHeight: 4,
  },
  dialog: {
    radius: radius.lg,
    padding: spacing.lg,
    maxWidth: 380,
  },
  row: {
    minHeight: 56,
    paddingX: spacing.md,
    paddingY: spacing.sm,
    gap: spacing.sm,
  },
  badge: {
    paddingX: 8,
    paddingY: 3,
    radius: radius.pill,
  },
  avatar: { sm: 28, md: 40, lg: 56 },
  icon: { sm: 14, md: 18, lg: 24, xl: 32 },
  tabBar: { height: 56 },
  topBar: { height: 52 },
  chart: { height: 180, strokeWidth: 2 },
} as const;

/**
 * Breakpoints, in dp of the SHORTEST screen edge.
 *
 * Keyed off the short edge rather than the width so a phone in landscape stays
 * "compact" — it has the width of a tablet but none of the height, and giving
 * it a tablet's two-column layout produces two columns three rows tall.
 */
export const breakpoint = {
  /** phones */
  compact: 0,
  /** large phones unfolded, small tablets */
  medium: 600,
  /** tablets */
  expanded: 840,
} as const;

export type SizeClass = "compact" | "medium" | "expanded";

export function sizeClassFor(shortestEdge: number): SizeClass {
  if (shortestEdge >= breakpoint.expanded) return "expanded";
  if (shortestEdge >= breakpoint.medium) return "medium";
  return "compact";
}
