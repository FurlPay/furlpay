/**
 * The FurlPay mark — two stacked hooks that read as an `F`.
 *
 * Drawn as vector paths rather than reusing `/furlpay-mark.svg`, which is a
 * 400px PNG wrapped in an `<svg>` (416KB) and turns to mush at the 22–56px this
 * page renders it at. The geometry is traced from the same artwork, so the two
 * stay in sync; the viewBox is the traced glyph's tight bounding box, so the
 * rendered mark is exactly `size` tall with no invisible padding to align around.
 *
 * The two hooks carry slightly different flat greens instead of a shared
 * `<linearGradient>`. That reproduces the sheen the artwork has while keeping
 * the component id-free — a gradient would need either a hook (forcing every
 * consumer across the client boundary) or a document-global id duplicated once
 * per instance.
 */
export function FurlPayMark({
  size = 24,
  className = "",
  tone = "brand",
}: {
  size?: number;
  className?: string;
  /** `brand` paints the green ramp; `current` inherits `color`. */
  tone?: "brand" | "current";
}) {
  const upper = tone === "current" ? "currentColor" : "#66DE9C";
  const lower = tone === "current" ? "currentColor" : "#74E9AC";
  return (
    <svg
      viewBox="5 5 54 55"
      width={(size * 54) / 55}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M18 5H59V9A10 11 0 0 1 49 20H20C15.8 23.4 11 26.4 5 29V18A13 13 0 0 1 18 5Z"
        fill={upper}
      />
      <path
        d="M18 27H43V35A7 7 0 0 1 36 42H20C18.5 43.9 18 45.5 18 47.6V50C18 55.6 13.4 60 5 60V37A13 10 0 0 1 18 27Z"
        fill={lower}
      />
    </svg>
  );
}

/**
 * Mark + wordmark lockup. `size` is the wordmark's font size; `markSize` is the
 * mark's height, which is a separate knob because the lockup is not one fixed
 * ratio — the page header sets an oversized mark against a modest wordmark,
 * while the in-card lockups run the two at nearly the same height.
 */
export default function FurlPayLogo({
  size = 24,
  markSize,
  className = "",
  wordmarkClassName = "text-fp-white",
  tone = "brand",
}: {
  size?: number;
  markSize?: number;
  className?: string;
  wordmarkClassName?: string;
  tone?: "brand" | "current";
}) {
  const mark = markSize ?? Math.round(size * 1.08);
  return (
    <span
      className={`inline-flex items-center ${className}`}
      style={{ gap: Math.round(size * 0.34) }}
    >
      <FurlPayMark size={mark} tone={tone} className="shrink-0" />
      <span
        className={`font-semibold leading-none tracking-[-0.025em] ${wordmarkClassName}`}
        style={{ fontSize: size }}
      >
        FurlPay
      </span>
    </span>
  );
}
