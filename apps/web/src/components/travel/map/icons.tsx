import type { LuxuryCategoryId } from "@/lib/hotels/luxuryTiers";

// ---------------------------------------------------------------------------
// The map's icon set.
//
// WHY THESE ARE DRAWN AND NOT TYPED. The category taxonomy used to carry an
// emoji per entry, which is convenient and wrong for a product surface: an
// emoji is a FONT GLYPH, so it renders as Apple's artwork on a Mac, Segoe's on
// Windows and Noto's on Android — three different visual languages on one
// screen, none of them FurlPay's — and it cannot take `currentColor`, so a pill
// that highlights white-on-green shows a full-colour crown sitting in it.
//
// These are single-path-weight line icons on a 20-unit grid, stroked in
// currentColor at 1.6, matching the weight of the header controls. One family,
// one weight, one colour model.
// ---------------------------------------------------------------------------

const S = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export type IconProps = { className?: string };

const box = (className?: string) => ({
  className: className ?? "h-[18px] w-[18px] shrink-0",
  viewBox: "0 0 20 20",
  "aria-hidden": true as const,
});

/** Ultra luxury — a crown, reduced to its silhouette. */
export function CrownIcon({ className }: IconProps) {
  return (
    <svg {...box(className)}>
      <path {...S} d="M3 7.2 5.6 12h8.8L17 7.2l-3.6 2.3L10 4.5 6.6 9.5 3 7.2Z" />
      <path {...S} d="M5.6 14.8h8.8" />
    </svg>
  );
}

/** Boutique design — a cut gem. */
export function GemIcon({ className }: IconProps) {
  return (
    <svg {...box(className)}>
      <path {...S} d="M6.2 3.5h7.6L17 8l-7 8.5L3 8l3.2-4.5Z" />
      <path {...S} d="M3 8h14M7.4 3.5 6 8l4 8.5M12.6 3.5 14 8l-4 8.5" />
    </svg>
  );
}

/** Island and overwater — a palm over water. */
export function IslandIcon({ className }: IconProps) {
  return (
    <svg {...box(className)}>
      <path {...S} d="M10 14.5V8" />
      <path {...S} d="M10 8c-2.6 0-4.8 1.1-5.7 2.3C4.9 7.2 7.2 5 10 5s5.1 2.2 5.7 5.3C14.8 9.1 12.6 8 10 8Z" />
      <path {...S} d="M2.5 17c1.25-1 2.5-1 3.75 0s2.5 1 3.75 0 2.5-1 3.75 0 2.5 1 3.75 0" />
    </svg>
  );
}

/** Alpine chalets — a peak. */
export function MountainIcon({ className }: IconProps) {
  return (
    <svg {...box(className)}>
      <path {...S} d="M2 16h16L12.5 5.5 9.4 11l-1.9-2.6L2 16Z" />
      <path {...S} d="M10.9 8.4h3.2" />
    </svg>
  );
}

/** Castles and palaces — crenellations. */
export function CastleIcon({ className }: IconProps) {
  return (
    <svg {...box(className)}>
      <path {...S} d="M4 16V6l2 1.4V6l2-1.2V6l2-1.4L12 6V4.8L14 6V7.4L16 6v10" />
      <path {...S} d="M2.6 16h14.8" />
      <path {...S} d="M8.6 16v-3.4h2.8V16" />
    </svg>
  );
}

/** Wine and wellness — a glass. */
export function WineIcon({ className }: IconProps) {
  return (
    <svg {...box(className)}>
      <path {...S} d="M6 3.5h8l-.6 4.2a3.5 3.5 0 0 1-6.8 0L6 3.5Z" />
      <path {...S} d="M10 11.4V16M7.4 16h5.2" />
    </svg>
  );
}

/** Business executive — a tower block. */
export function BusinessIcon({ className }: IconProps) {
  return (
    <svg {...box(className)}>
      <path {...S} d="M4 16.5V4.6A1.1 1.1 0 0 1 5.1 3.5h5.8A1.1 1.1 0 0 1 12 4.6V16.5" />
      <path {...S} d="M12 8.5h2.9A1.1 1.1 0 0 1 16 9.6v6.9M2.6 16.5h14.8" />
      <path {...S} d="M6.4 6.4h1.3M8.9 6.4h1.3M6.4 9.4h1.3M8.9 9.4h1.3M6.4 12.4h1.3M8.9 12.4h1.3" />
    </svg>
  );
}

/** Michelin dining — cloche and cover. */
export function DiningIcon({ className }: IconProps) {
  return (
    <svg {...box(className)}>
      <path {...S} d="M3 13.5a7 7 0 0 1 14 0H3Z" />
      <path {...S} d="M2.4 16h15.2M10 6.5v-2" />
      <circle {...S} cx="10" cy="4" r="1.1" />
    </svg>
  );
}

/** Helipad and transit — a departing aircraft. */
export function TransitIcon({ className }: IconProps) {
  return (
    <svg {...box(className)}>
      <path {...S} d="M3 11.4 5.2 12l3-2.6-4.6-2.8 1.7-1 5.5 1.9 3.2-2.8a1.7 1.7 0 0 1 2.3 2.5l-2.9 3 1.9 5.4-1 1.7-2.8-4.6L8.9 15l.6 2.2-1.2.8-1.6-2.6-2.6-1.7 1-1.3Z" />
    </svg>
  );
}

/** Pay with USDC — a payment mark, not a lightning emoji. */
export function UsdcIcon({ className }: IconProps) {
  return (
    <svg {...box(className)}>
      <circle {...S} cx="10" cy="10" r="7" />
      <path {...S} d="M10 5.6v8.8" />
      <path {...S} d="M12.3 7.6a2.5 2.5 0 0 0-2.3-1.2c-1.3 0-2.3.8-2.3 1.9 0 2.5 4.6 1.3 4.6 3.8 0 1.1-1 1.9-2.3 1.9a2.5 2.5 0 0 1-2.3-1.2" />
    </svg>
  );
}

/** A hotel, the generic fallback. */
export function HotelIcon({ className }: IconProps) {
  return (
    <svg {...box(className)}>
      <path {...S} d="M4 16.5V4.6A1.1 1.1 0 0 1 5.1 3.5h5.8A1.1 1.1 0 0 1 12 4.6V16.5" />
      <path {...S} d="M12 8.5h2.9A1.1 1.1 0 0 1 16 9.6v6.9M2.6 16.5h14.8" />
      <path {...S} d="M6.4 6.4h1.3M8.9 6.4h1.3M6.4 9.4h1.3M8.9 9.4h1.3M6.4 12.4h1.3M8.9 12.4h1.3" />
    </svg>
  );
}

export function ResortIcon({ className }: IconProps) {
  return <IslandIcon className={className} />;
}

/** A villa — a pitched roof. */
export function VillaIcon({ className }: IconProps) {
  return (
    <svg {...box(className)}>
      <path {...S} d="M3 9.4 10 4l7 5.4" />
      <path {...S} d="M4.75 8.7v7.8h10.5V8.7" />
      <path {...S} d="M8.25 16.5v-3.9h3.5v3.9" />
    </svg>
  );
}

/** A verified position — a shield with a check. */
export function VerifiedIcon({ className }: IconProps) {
  return (
    <svg {...box(className)}>
      <path {...S} d="M10 2.6 16.4 5v5.1c0 3.5-2.7 6.1-6.4 7.3-3.7-1.2-6.4-3.8-6.4-7.3V5L10 2.6Z" />
      <path {...S} d="m7.3 10 1.9 1.9 3.5-3.8" />
    </svg>
  );
}

/** A map pin, for destination rows in search. */
export function PinIcon({ className }: IconProps) {
  return (
    <svg {...box(className)}>
      <path {...S} d="M10 17.4s5.4-4.6 5.4-8.9a5.4 5.4 0 1 0-10.8 0c0 4.3 5.4 8.9 5.4 8.9Z" />
      <circle {...S} cx="10" cy="8.4" r="2" />
    </svg>
  );
}

/**
 * A filled star. The one icon that is deliberately solid rather than stroked —
 * it is a rating mark, not a control, and it reads as a value at 14px where a
 * stroked outline would not.
 */
export function StarIcon({ className }: IconProps) {
  return (
    <svg
      className={className ?? "h-3.5 w-3.5 shrink-0"}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden
    >
      <path d="m8 1.8 1.9 3.9 4.3.6-3.1 3 .74 4.3L8 11.6l-3.84 2 .74-4.3-3.1-3 4.3-.6L8 1.8Z" />
    </svg>
  );
}

export function SearchIcon({ className }: IconProps) {
  return (
    <svg className={className ?? "h-5 w-5 shrink-0"} viewBox="0 0 20 20" fill="none" aria-hidden>
      <circle cx="9" cy="9" r="6.25" stroke="currentColor" strokeWidth="1.8" />
      <path d="m13.6 13.6 3.4 3.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function SlidersIcon({ className }: IconProps) {
  return (
    <svg {...box(className)}>
      <path {...S} d="M3 6h8.5M15.5 6H17M3 14h1.5M8.5 14H17" />
      <circle {...S} cx="13.5" cy="6" r="2" />
      <circle {...S} cx="6.5" cy="14" r="2" />
    </svg>
  );
}

export function ClockIcon({ className }: IconProps) {
  return (
    <svg {...box(className)}>
      <circle {...S} cx="10" cy="10" r="7.25" />
      <path {...S} d="M10 5.75V10l2.75 1.75" />
    </svg>
  );
}

export function CalendarIcon({ className }: IconProps) {
  return (
    <svg {...box(className)}>
      <rect {...S} x="3" y="4.5" width="14" height="13" rx="2.5" />
      <path {...S} d="M3 8.5h14M7 2.75v3.5M13 2.75v3.5" />
    </svg>
  );
}

export function GuestsIcon({ className }: IconProps) {
  return (
    <svg {...box(className)}>
      <circle {...S} cx="10" cy="7" r="3.25" />
      <path {...S} d="M4.25 16.5a5.75 5.75 0 0 1 11.5 0" />
    </svg>
  );
}

export function ChevronDownIcon({ className }: IconProps) {
  return (
    <svg className={className ?? "h-4 w-4 shrink-0"} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CloseIcon({ className }: IconProps) {
  return (
    <svg className={className ?? "h-4 w-4 shrink-0"} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function ArrowRightIcon({ className }: IconProps) {
  return (
    <svg className={className ?? "h-3 w-3 shrink-0"} viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d="M2 6h8M6.5 2.5 10 6l-3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Every category's icon, by id. The taxonomy stays data; the artwork lives
 *  here, so a category can be recoloured or restyled without touching it. */
export const CATEGORY_ICONS: Record<LuxuryCategoryId, (p: IconProps) => React.ReactElement> = {
  ultra_luxury: CrownIcon,
  boutique: GemIcon,
  overwater_villas: IslandIcon,
  alpine_chalets: MountainIcon,
  heritage_castles: CastleIcon,
  vineyard_wellness: WineIcon,
  executive_suites: BusinessIcon,
  michelin_dining: DiningIcon,
  helipad_transit: TransitIcon,
  crypto_escrow: UsdcIcon,
};

export function CategoryIcon({ id, className }: { id: LuxuryCategoryId; className?: string }) {
  const Icon = CATEGORY_ICONS[id] ?? HotelIcon;
  return <Icon className={className} />;
}
