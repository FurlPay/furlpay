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
        // Text hierarchy
        textPrimary: "#FFFFFF",
        textSecondary: "#8E8E93",
        textMuted: "#A1A1AA",
        // Semantic
        gain: "#34C759",
        loss: "#FF453A",
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
    },
  },
  plugins: [],
};

export default config;
