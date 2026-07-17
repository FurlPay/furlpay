// ---------------------------------------------------------------------------
// FurlPay icon system — 24×24, 2px rounded strokes, monochrome (currentColor).
// Matches the site's line-icon language; accent color comes from the parent's
// `color`, gradients only via .qa-icon / active states in CSS.
// ---------------------------------------------------------------------------

import type { CSSProperties } from "react";

export type IconName =
  | "wallet"
  | "send"
  | "receive"
  | "swap"
  | "card"
  | "travel"
  | "invest"
  | "earn"
  | "approve"
  | "security"
  | "passkey"
  | "bell"
  | "settings"
  | "networks"
  | "search"
  | "history"
  | "help"
  | "activity"
  | "check"
  | "close"
  | "chevronRight"
  | "logout"
  | "code"
  | "user"
  | "globe"
  | "copy"
  | "qr"
  | "refresh"
  | "eye"
  | "eyeOff";

// Each icon is one or more SVG path `d` strings drawn on a 24×24 grid.
const PATHS: Record<IconName, string[]> = {
  wallet: [
    "M3.5 8a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-11a3 3 0 0 1-3-3V8z",
    "M15.5 12h2.5",
  ],
  send: ["M7 17 17 7", "M9.5 7H17v7.5"],
  receive: ["M17 7 7 17", "M14.5 17H7V9.5"],
  swap: ["M4 9h13l-3-3", "M20 15H7l3 3"],
  card: ["M3 8.5a2.5 2.5 0 0 1 2.5-2.5h13A2.5 2.5 0 0 1 21 8.5v7a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 15.5v-7z", "M3 10h18", "M6.5 14.5h4"],
  travel: [
    "M10.5 20l1.5-5.5L16.5 13c1.2-.35 2-.9 2-2s-.8-1.65-2-2l-11-3-1 1.5 6.5 4-2.5 2.5-3-.5-1 1 3.5 2 2 3.5 1-1-.5-3z",
  ],
  invest: ["M4 20V4", "M4 20h16", "M7.5 15.5 11 11l3 2.5L18.5 8", "M15 8h3.5V11.5"],
  earn: ["M12 3.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1z", "M6 14.5c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5-2.7-2.5-6-2.5-6 1.1-6 2.5z", "M6 14.5v3c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-3"],
  approve: ["M12 3l7.5 2.8v5.4c0 4.3-3.2 7.4-7.5 8.8-4.3-1.4-7.5-4.5-7.5-8.8V5.8L12 3z", "M8.8 12l2.2 2.2 4.2-4.4"],
  security: ["M12 3l7.5 2.8v5.4c0 4.3-3.2 7.4-7.5 8.8-4.3-1.4-7.5-4.5-7.5-8.8V5.8L12 3z", "M12 10.5v3", "M12 10.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"],
  passkey: ["M14 10a4 4 0 1 0-4 4", "M10 14v6", "M10 17.5h3", "M17.5 14.5a2.5 2.5 0 0 1 2.5 2.5v3", "M17.5 17v3"],
  bell: ["M6 16v-5a6 6 0 0 1 12 0v5l1.5 2.5H4.5L6 16z", "M10 21a2 2 0 0 0 4 0"],
  settings: ["M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z", "M19.5 12a7.5 7.5 0 0 0-.15-1.5l2.05-1.55-2-3.4-2.4.95a7.6 7.6 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.5a7.6 7.6 0 0 0-2.6 1.5l-2.4-.95-2 3.4L4.65 10.5A7.5 7.5 0 0 0 4.5 12c0 .5.05 1 .15 1.5L2.6 15.05l2 3.4 2.4-.95c.75.65 1.65 1.15 2.6 1.5l.4 2.5h4l.4-2.5a7.6 7.6 0 0 0 2.6-1.5l2.4.95 2-3.4-2.05-1.55c.1-.5.15-1 .15-1.5z"],
  networks: ["M12 5.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4z", "M5 20.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4z", "M19 20.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4z", "M12 5.5v5m0 0-6 7m6-7 6 7"],
  search: ["M11 17.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z", "M15.8 15.8 20.5 20.5"],
  history: ["M12 20.5a8.5 8.5 0 1 0-8.4-9.9", "M3.5 7v3.5H7", "M12 8v4.5l3 2"],
  help: ["M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H13l-4 4v-4H6.5A2.5 2.5 0 0 1 4 13.5v-7z", "M10.2 8.6a2 2 0 0 1 3.8.9c0 1.3-1.9 1.6-1.9 2.7", "M12 14.7v.05"],
  activity: ["M3 12h4l2.5-6.5 5 13L17 12h4"],
  check: ["M5 12.5 10 17.5 19 7"],
  close: ["M6.5 6.5l11 11", "M17.5 6.5l-11 11"],
  chevronRight: ["M9.5 6 15.5 12 9.5 18"],
  logout: ["M14 4H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7", "M17 8l4 4-4 4", "M21 12H10"],
  code: ["M8.5 7.5 4 12l4.5 4.5", "M15.5 7.5 20 12l-4.5 4.5", "M13.2 5 10.8 19"],
  user: ["M12 11.5a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5z", "M4.75 20a7.25 7.25 0 0 1 14.5 0"],
  globe: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M3 12h18", "M12 3c2.5 2.4 3.75 5.4 3.75 9S14.5 18.6 12 21c-2.5-2.4-3.75-5.4-3.75-9S9.5 5.4 12 3z"],
  copy: ["M9 9.5A1.5 1.5 0 0 1 10.5 8h8A1.5 1.5 0 0 1 20 9.5v9a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 9 18.5v-9z", "M6 15H5.5A1.5 1.5 0 0 1 4 13.5v-9A1.5 1.5 0 0 1 5.5 3h8A1.5 1.5 0 0 1 15 4.5V5"],
  qr: ["M4 4h6v6H4V4z", "M14 4h6v6h-6V4z", "M4 14h6v6H4v-6z", "M14 14h2.5v2.5H14V14z", "M17.5 17.5H20V20h-2.5v-2.5z", "M14 20h.01", "M20 14h.01"],
  refresh: ["M20 12a8 8 0 1 1-2.34-5.66", "M20 3.5V7h-3.5"],
  eye: ["M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z", "M12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z"],
  eyeOff: ["M4 4l16 16", "M9.9 5.9A9.5 9.5 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17.6 17.6 0 0 1-2.7 3.4", "M6.2 6.9A17 17 0 0 0 2.5 12S6 18.5 12 18.5c1.3 0 2.5-.3 3.6-.8", "M9.9 10.3a2.5 2.5 0 0 0 3.4 3.6"],
};

export function Icon({
  name,
  size = 18,
  strokeWidth = 2,
  style,
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      {PATHS[name].map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

/** Official FurlPay logo mark — rounded tile with the neon gradient F. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="fp-logo-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#00E599" />
          <stop offset="100%" stopColor="#00B87A" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="8" fill="#08080A" stroke="url(#fp-logo-grad)" strokeWidth="1.5" />
      <path
        d="M11.5 24V8.5H22v3.4h-6.6v3.2h5.4v3.3h-5.4V24h-3.9z"
        fill="url(#fp-logo-grad)"
      />
    </svg>
  );
}

/** Wordmark matching the site header (extrabold, tight tracking). */
export function Wordmark({ size = "1.05rem" }: { size?: string }) {
  return (
    <span style={{ fontWeight: 800, fontSize: size, letterSpacing: "-0.5px" }}>
      Furl<span style={{ color: "var(--fp-accent)" }}>pay</span>
    </span>
  );
}
