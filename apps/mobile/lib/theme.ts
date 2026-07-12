// FurlPay mobile theme — mirrors apps/web/tailwind.config.ts (OLED black,
// neon green primary, red accent). Keep hex values in sync with the web app.

export const colors = {
  bg: "#000000",
  surface: "#0D0D0D",
  surfaceRaised: "#161616",
  border: "#232323",
  text: "#FFFFFF",
  textDim: "#9CA3AF",
  textFaint: "#6B7280",
  neon: "#00E599",
  neonDeep: "#00B87A",
  neonSoft: "#0A2A22",
  accent: "#FF3B30",
  accentDeep: "#E02020",
  warning: "#F59E0B",
  onNeon: "#00170F",
} as const;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;

export const radius = { sm: 8, md: 14, lg: 20, pill: 999 } as const;

export const type = {
  title: { fontSize: 28, fontWeight: "700" as const, color: colors.text },
  h2: { fontSize: 20, fontWeight: "700" as const, color: colors.text },
  body: { fontSize: 15, color: colors.text },
  dim: { fontSize: 13, color: colors.textDim },
  mono: { fontSize: 13, color: colors.textDim, fontFamily: "monospace" },
} as const;
