import { barcodeBars } from "@/lib/trips/barcode";

/**
 * Boarding-pass barcode. The bar pattern is a pure function of `value` (see
 * `lib/trips/barcode.ts` for why that matters), so this component is safe to
 * render on the server.
 */
export default function Barcode({
  value,
  className = "",
  height = 52,
}: {
  value: string;
  className?: string;
  height?: number;
}) {
  const bars = barcodeBars(value);
  const total = bars.reduce((sum, b) => sum + b, 0);

  let x = 0;
  return (
    <svg
      viewBox={`0 0 ${total} ${height}`}
      preserveAspectRatio="none"
      className={className}
      style={{ height }}
      role="img"
      aria-label={`Boarding pass barcode for ${value}`}
    >
      {bars.map((w, i) => {
        const at = x;
        x += w;
        // Even indices are bars, odd indices the gaps between them.
        return i % 2 === 0 ? (
          <rect key={i} x={at} y="0" width={w} height={height} fill="#0A0A0A" />
        ) : null;
      })}
    </svg>
  );
}
