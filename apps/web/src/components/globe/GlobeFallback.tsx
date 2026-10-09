import { useId } from "react";

// Shown when WebGL is unavailable or the context is lost: a still, dotted sphere
// in the same palette. Pure SVG, no animation, nothing to clean up.
export default function GlobeFallback() {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 200 200" className="h-full w-full" aria-hidden="true">
      <defs>
        <radialGradient id={`${id}-body`} cx="40%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#0b3a2b" />
          <stop offset="70%" stopColor="#04170f" />
          <stop offset="100%" stopColor="#020c09" />
        </radialGradient>
        <radialGradient id={`${id}-halo`} cx="50%" cy="50%" r="50%">
          <stop offset="80%" stopColor="#00dba0" stopOpacity="0" />
          <stop offset="92%" stopColor="#00dba0" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#00dba0" stopOpacity="0" />
        </radialGradient>
        <pattern id={`${id}-dots`} width="4" height="4" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="0.55" fill="#00dba0" fillOpacity="0.35" />
        </pattern>
        <clipPath id={`${id}-clip`}><circle cx="100" cy="100" r="80" /></clipPath>
      </defs>
      <circle cx="100" cy="100" r="98" fill={`url(#${id}-halo)`} />
      <circle cx="100" cy="100" r="80" fill={`url(#${id}-body)`} />
      <g clipPath={`url(#${id}-clip)`} stroke="#00dba0" strokeOpacity="0.18" fill="none" strokeWidth="0.5">
        <rect x="20" y="20" width="160" height="160" fill={`url(#${id}-dots)`} stroke="none" opacity="0.6" />
        {[-60, -30, 0, 30, 60].map(y => <ellipse key={y} cx="100" cy={100 + y} rx={Math.sqrt(80 * 80 - y * y)} ry={Math.abs(y) / 6 + 2} />)}
        {[20, 45, 70].map(rx => <ellipse key={rx} cx="100" cy="100" rx={rx} ry="80" />)}
      </g>
      <circle cx="100" cy="100" r="80" fill="none" stroke="#00dba0" strokeOpacity="0.35" strokeWidth="0.6" />
    </svg>
  );
}
