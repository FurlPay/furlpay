import React from "react";
import Svg, { Circle, G, Line, Path } from "react-native-svg";

// Route graphics for the Trips screen. Two shapes, one per surface — a single
// parameterised path would need every caller to pass curvature, dash rhythm and
// marker placement, at which point the "shared" component is just an argument
// list. They share the dash rhythm and the palette instead.

const DASH = "5,7";
const GREEN = "#4FD794";
const GREEN_BRIGHT = "#8DF0BC";

/** Top-down airliner silhouette in a 24x24 box, nose UP (rotated at each use). */
const PLANE =
  "M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z";

function PlaneMark({ x, y, size, fill }: { x: number; y: number; size: number; fill: string }) {
  return (
    <G transform={`translate(${x} ${y}) scale(${size / 24})`}>
      <Path d={PLANE} fill={fill} transform="rotate(90 12 12)" />
    </G>
  );
}

/** Live Activity card: flat dashed run, endpoint dots, aircraft at the middle. */
export function RouteDashed({ width, height = 26 }: { width: number; height?: number }) {
  const mid = width / 2;
  const y = height / 2;
  return (
    <Svg width={width} height={height}>
      <Circle cx={4} cy={y} r={3.6} fill={GREEN} />
      <Line x1={12} y1={y} x2={mid - 18} y2={y} stroke={GREEN} strokeWidth={2.4} strokeDasharray={DASH} strokeLinecap="round" />
      <Line x1={mid + 18} y1={y} x2={width - 12} y2={y} stroke={GREEN} strokeWidth={2.4} strokeDasharray={DASH} strokeLinecap="round" />
      <Circle cx={width - 4} cy={y} r={3.6} fill={GREEN} />
      <PlaneMark x={mid - 11} y={y - 11} size={22} fill="#FFFFFF" />
    </Svg>
  );
}

// The trajectory, in a 250x66 viewBox scaled to fit: a long shallow climb that
// flattens out under the aircraft.
const VB_W = 250;
const VB_H = 66;
const P0: readonly [number, number] = [2, 58];
const P1: readonly [number, number] = [140, 4];
const P2: readonly [number, number] = [232, 10];

/** Point on the quadratic at `t`. */
function pointAt(t: number): [number, number] {
  const a = (1 - t) * (1 - t);
  const b = 2 * (1 - t) * t;
  const c = t * t;
  return [a * P0[0] + b * P1[0] + c * P2[0], a * P0[1] + b * P1[1] + c * P2[1]];
}

/**
 * Arc length of the curve, measured once by chord summation.
 *
 * SVG's own `pathLength` would express the flown fraction directly, but
 * react-native-svg does not implement it — so the dash pattern has to be in
 * real user units, and that needs a number. 64 chords is well past the point
 * where more segments change the result at this size.
 */
const ARC_LENGTH = (() => {
  let length = 0;
  let [px, py] = pointAt(0);
  for (let i = 1; i <= 64; i++) {
    const [x, y] = pointAt(i / 64);
    length += Math.hypot(x - px, y - py);
    px = x;
    py = y;
  }
  return length;
})();

/**
 * Flight status card: the trajectory arcs up from the origin to the aircraft,
 * with a bead at `progress` along the drawn curve. Flown portion solid, the
 * rest dashed — the convention every airline map already uses.
 */
export function RouteArc({
  width,
  height = 48,
  progress = 0,
}: {
  width: number;
  height?: number;
  progress?: number;
}) {
  const d = `M${P0[0]} ${P0[1]} Q${P1[0]} ${P1[1]} ${P2[0]} ${P2[1]}`;
  const t = Math.min(Math.max(progress, 0), 1);
  const [bx, by] = pointAt(t);

  return (
    <Svg width={width} height={height} viewBox={`0 0 ${VB_W} ${VB_H}`}>
      <Path d={d} fill="none" stroke="#3FCB88" strokeWidth={2} strokeDasharray={DASH} strokeLinecap="round" />
      {t > 0 && (
        <Path
          d={d}
          fill="none"
          stroke={GREEN_BRIGHT}
          strokeWidth={2.4}
          strokeLinecap="round"
          // react-native-svg has no `pathLength`, so the flown fraction is
          // expressed in real user units: draw `t` of the measured curve, then
          // a gap longer than the whole thing so nothing repeats.
          strokeDasharray={`${ARC_LENGTH * t},${ARC_LENGTH}`}
        />
      )}
      <Circle cx={bx} cy={by} r={4} fill="#C8FBDE" />
      <PlaneMark x={224} y={-4} size={30} fill="#5FE3A0" />
    </Svg>
  );
}
