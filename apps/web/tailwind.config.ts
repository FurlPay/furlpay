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
