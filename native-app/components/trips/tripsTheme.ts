import { colors } from "@/lib/theme";

// Trips surface palette.
//
// The app is OLED black with a neon-mint primary (lib/theme.ts). The Trips
// design is a warmer, near-black EMERALD register — `neon` (#00E599) blows out
// against a green ground, and the boarding pass itself is a light card, the way
// a pass is in Apple Wallet.
//
// Kept as its own small scale rather than added to lib/theme.ts so nothing else
// in the app can drift onto these values by accident, and so the shared theme
// keeps meaning exactly what it means today.

export const trips = {
  /** Live Activity card — near-black emerald, as on the Lock Screen. */
  liveCardTop: "#06170F",
  liveCardBottom: "#020A07",
  /** Trip hero header. */
  heroTop: "#1D7150",
  heroBottom: "#1E7A58",

  /** Accent as it reads on a DARK surface. */
  green: "#5FDCA0",
  greenBright: "#8DF0BC",
  greenDim: "#4ADE96",

  /** Accent as it reads on the LIGHT pass. Never use `green` there — it fails
   *  contrast on white by a wide margin. */
  ink: "#1B7A4E",

  /** The pass. Light on purpose; a boarding pass is scanned at a gate. */
  passBg: "#FFFFFF",
  passRule: "#DCDCDE",
  passInk: "#111113",
  passInkDim: "#6E6E73",
  passChip: "#E8E8EA",
  passInset: "#F4F4F6",

  /** Apple Wallet button. */
  walletBg: "#111715",

  /** Card edges on the dark screen. */
  border: "rgba(120, 214, 168, 0.26)",
  tile: "rgba(255, 255, 255, 0.05)",
  tileBorder: "rgba(255, 255, 255, 0.08)",
  subText: "#B6C4BE",

  screenBg: colors.bg,
} as const;

export const tripsRadius = { card: 26, pass: 22, tile: 14, pill: 999 } as const;
