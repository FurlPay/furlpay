import type { Config } from "tailwindcss";

// Design-system tokens lifted directly from the 2026 UI/UX styling spec.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Base surfaces
        oled: "#000000",
        charcoal: "#08080A",
        surface: "#1C1C1E",
        surfaceMuted: "#3A3A3C",
        // Brand accent (vibrant red/pink)
        accent: "#FF3B30",
        accentDeep: "#E02020",
        // Marketing / docs brand (glowing green) — landing page + docs portal.
        neon: "#00E599",
        neonDeep: "#00B87A",
        neonSoft: "#0A2A22",
        // Text hierarchy
        textPrimary: "#FFFFFF",
        textSecondary: "#8E8E93",
        textMuted: "#A1A1AA",
        // Semantic
        gain: "#34C759",
        loss: "#FF453A",
        // ── Terminal surfaces (/dashboard/terminal only) ───────────────────
        // The trading terminal needs more elevation steps than the consumer
        // app: a dense grid of panels on pure #000 has no readable hierarchy.
        // These are ADDITIVE — brand accent stays `neon`, radius stays `card`
        // — so the terminal reads as FurlPay, not as a second product.
        term: {
          bg: "#0B1118",
          panel: "#141C26",
          raised: "#1B2531",
          border: "#243141",
          grid: "#1A2432",
        },
        // ── Trips / travel showcase surfaces (/trips) ──────────────────────
        // A second, warmer brand register: near-black *emerald* rather than the
        // pure-black consumer app. Kept as its own scale instead of retuning
        // `neon`, because the travel poster needs greens that sit legibly on a
        // green ground — `neon` (#00E599) blows out against #021A12 — and the
        // rest of the site must not shift underneath it. Values are sampled
        // from the FurlPay Trips reference composition.
        fp: {
          bg: "#021A12", // page ground
          bgDeep: "#03130E", // vignette / far corners
          green: "#35D98B", // primary accent
          bright: "#55E6A1", // hover / highlight
          dim: "#57C987", // accent as it reads inside a glass card
          emerald: "#063D2A", // filled emerald chips
          ink: "#1B7A4E", // the accent on LIGHT surfaces (in-phone UI)
          inkDeep: "#146B44",
          white: "#F7FAF8",
          sub: "#B6C4BE",
          muted: "#71827B",
          app: "#F4F6F5", // phone app background
          dark: "#111715", // Apple Wallet button / dark controls
        },
        // ── Markets terminal (/markets) ────────────────────────────────────
        // A third register, and the reason it is its own scale rather than a
        // retune of `term`: the trading terminal is BLUE-grey with a neon-green
        // accent, and the markets surface is near-black navy with a CYAN one.
        // Pointing both at the same tokens would mean every future adjustment
        // to /dashboard/terminal silently repaints /markets, and vice versa.
        //
        // Cyan, not the consumer app's red `accent`: on a page where green
        // means "up" and red means "down", a red brand accent on a selected
        // filter pill reads as a market signal. The active state has to sit
        // outside the gain/loss axis entirely, which is what cyan buys.
        mkt: {
          bg: "#05070D", // page ground
          deep: "#03050A", // vignette / far corners
          panel: "#0B0F1A", // card + rail surface
          raised: "#121826", // hover, and the row a pointer is on
          border: "#1B2333", // hairline between panels
          line: "#141B29", // table row separator — quieter than `border`
          cyan: "#22D3EE", // selected / active
          cyanDeep: "#0891B2", // pressed, and cyan text on a light fill
          violet: "#8B5CF6", // secondary accent — badges, promo card
          up: "#34D399", // positive move
          down: "#F87171", // negative move
        },
      },
      borderRadius: {
        card: "18px",
        pill: "24px",
        capsule: "20px",
      },
      fontFamily: {
        sans: ["Inter", "Outfit", "Helvetica Neue", "Helvetica", "sans-serif"],
      },
      letterSpacing: {
        tighter: "-0.5px",
      },
      boxShadow: {
        glow: "0 0 40px -8px rgba(0, 229, 153, 0.45)",
        "glow-sm": "0 0 20px -6px rgba(0, 229, 153, 0.4)",
      },
      keyframes: {
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-12px)" },
        },
      },
      animation: {
        float: "float 6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
