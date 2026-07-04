// Tiny inline SVG sparkline. Deterministic pseudo-random walk seeded by `seed`
// whose overall drift follows the sign/magnitude of `changePct`, so the shape
// is stable across renders and visually agrees with the quoted move.
export default function MiniSparkline({
  seed,
  changePct,
  width = 52,
  height = 20,
  strokeWidth = 1.5,
  className,
}: {
  seed: string;
  changePct: number;
  width?: number;
  height?: number;
  strokeWidth?: number;
  className?: string;
}) {
  const n = 22;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const rand = () => {
    h = Math.imul(h ^ (h >>> 15), 2246822519);
    return ((h >>> 0) % 1000) / 1000;
  };

  const drift = Math.max(-1, Math.min(1, changePct / 4));
  const pts: number[] = [0];
  for (let i = 1; i < n; i++) pts.push(pts[i - 1] + (rand() - 0.5 + drift * 0.22));
  // Force the endpoint to agree with the direction of the move.
  const end = pts[0] + drift * 2.2;
  const lift = (end - pts[n - 1]) / (n - 1);
  const shaped = pts.map((v, i) => v + lift * i);

  const min = Math.min(...shaped);
  const max = Math.max(...shaped);
  const span = Math.max(max - min, 0.0001);
  const path = shaped
    .map((v, i) => `${((i / (n - 1)) * (width - 2) + 1).toFixed(1)},${(height - 2 - ((v - min) / span) * (height - 4) + 1).toFixed(1)}`)
    .join(" ");

  const up = changePct >= 0;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden>
      <polyline
        points={path}
        fill="none"
        stroke={up ? "#30D158" : "#FF453A"}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.9}
      />
    </svg>
  );
}
