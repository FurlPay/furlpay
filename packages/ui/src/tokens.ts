// Furlpay design tokens — the single source of truth for the premium dark theme,
// shared across web, desktop and extension.

export const colors = {
  oled: "#000000",
  charcoal: "#08080A",
  surface: "#1C1C1E",
  surfaceMuted: "#3A3A3C",
  accent: "#FF3B30",
  accentDeep: "#E02020",
  textPrimary: "#FFFFFF",
  textSecondary: "#8E8E93",
  textMuted: "#A1A1AA",
  gain: "#34C759",
  loss: "#FF453A",
} as const;

export const radius = {
  card: 18,
  pill: 24,
  capsule: 20,
} as const;

export const typography = {
  fontFamily: 'Inter, Outfit, "Helvetica Neue", Helvetica, sans-serif',
  headerSize: 32,
  headerWeight: 700,
  headerTracking: "-0.5px",
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 20, xl: 32 } as const;

export type Colors = typeof colors;
