// Brand marks for the wallet mockup — self-contained inline SVGs (no external
// image dependencies). Each icon draws its own coloured coin/badge so it can
// drop straight into a row at h-8 w-8.

type IconProps = { className?: string };

// --- Stablecoins -------------------------------------------------------

export function UsdcIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="12" fill="#2775CA" />
      <text
        x="12"
        y="16.5"
        textAnchor="middle"
        fontFamily="Inter, sans-serif"
        fontSize="13"
        fontWeight="800"
        fill="#FFFFFF"
      >
        $
      </text>
    </svg>
  );
}

export function EurcIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="12" fill="#1A6DD8" />
      <text
        x="12"
        y="16.5"
        textAnchor="middle"
        fontFamily="Inter, sans-serif"
        fontSize="13"
        fontWeight="800"
        fill="#FFFFFF"
      >
        €
      </text>
    </svg>
  );
}

// --- Solana ------------------------------------------------------------

export function SolIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="furl-sol" x1="3" y1="16" x2="20" y2="8" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#9945FF" />
          <stop offset="1" stopColor="#14F195" />
        </linearGradient>
      </defs>
      <circle cx="12" cy="12" r="12" fill="#0B0B14" />
      <g fill="url(#furl-sol)">
        <path d="M6.8 7.6H17L15.4 9.3H5.2z" />
        <path d="M5.2 10.15H15.4L17 11.85H6.8z" />
        <path d="M6.8 12.7H17L15.4 14.4H5.2z" />
      </g>
    </svg>
  );
}

// --- Equities ----------------------------------------------------------

export function AppleIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="12" fill="#111214" />
      <g transform="translate(2.1 2.1) scale(0.82)" fill="#FFFFFF">
        <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
      </g>
    </svg>
  );
}

export function TeslaIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="12" fill="#E82127" />
      <g fill="#FFFFFF">
        {/* top tab */}
        <path d="M10.7 4.9h2.6v1.7h-2.6z" />
        {/* T bar + stem */}
        <path d="M5.2 6.7h13.6v1.95H13.3V18h-2.6V8.65H5.2z" />
      </g>
    </svg>
  );
}

// --- Cash --------------------------------------------------------------

export function UsdCashIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="12" fill="#1E7A46" />
      <g fill="none" stroke="#FFFFFF" strokeWidth="1.4">
        <rect x="5.3" y="8" width="13.4" height="8" rx="1.6" />
        <circle cx="12" cy="12" r="1.9" />
      </g>
      <g fill="#FFFFFF">
        <circle cx="7.6" cy="12" r="0.7" />
        <circle cx="16.4" cy="12" r="0.7" />
      </g>
    </svg>
  );
}
