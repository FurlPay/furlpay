import { PLANE_PATH, PlaneGlyph } from "./icons";
import styles from "./trips.module.css";

/** The airliner silhouette placed inside a parent `<svg>`'s coordinate space. */
function PlaneMark({ x, y, size, fill }: { x: number; y: number; size: number; fill: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${size / 24})`}>
      <path transform="rotate(90 12 12)" d={PLANE_PATH} fill={fill} />
    </g>
  );
}

/**
 * Route graphics. Three shapes, one per surface, because a single
 * parameterised path would need every caller to pass curvature, dash rhythm and
 * marker placement — at which point the "shared" component is just an argument
 * list. They share the dash rhythm and colours instead.
 */

const DASH = "5 7";

/** Live Activity card: flat dashed run, endpoint dots, aircraft at the middle. */
export function RouteDashed({ className = "" }: { className?: string }) {
  return (
    <span className={`relative flex min-w-0 flex-1 items-center ${className}`} aria-hidden="true">
      <svg viewBox="0 0 200 12" preserveAspectRatio="none" className="h-3 w-full">
        <circle cx="4" cy="6" r="3.6" fill="#4FD794" />
        <line
          x1="12"
          y1="6"
          x2="82"
          y2="6"
          stroke="#4FD794"
          strokeWidth="2.4"
          strokeDasharray={DASH}
          strokeLinecap="round"
          className={styles.dashFlow}
        />
        <line
          x1="118"
          y1="6"
          x2="188"
          y2="6"
          stroke="#4FD794"
          strokeWidth="2.4"
          strokeDasharray={DASH}
          strokeLinecap="round"
          className={styles.dashFlow}
        />
        <circle cx="196" cy="6" r="3.6" fill="#4FD794" />
      </svg>
      <PlaneGlyph className="absolute left-1/2 top-1/2 h-[22px] w-[22px] -translate-x-1/2 -translate-y-1/2 text-white" />
    </span>
  );
}

/**
 * Flight status card: the trajectory arcs up from the origin to the aircraft,
 * with a progress bead at `progress` along the drawn curve. Flown portion is
 * solid, the rest dashed — the same convention every airline map uses.
 */
export function RouteArc({ progress = 0.18 }: { progress?: number }) {
  // Quadratic curve from (2,58) to (232,10) with control (140,4): a long shallow
  // climb that flattens under the aircraft, matching the reference trajectory.
  const d = "M2 58 Q140 4 232 10";
  const t = Math.min(Math.max(progress, 0), 1);
  // Point on the quadratic at t, for the bead.
  const q = (p0: number, p1: number, p2: number) =>
    (1 - t) * (1 - t) * p0 + 2 * (1 - t) * t * p1 + t * t * p2;
  const bx = q(2, 140, 232);
  const by = q(58, 4, 10);

  return (
    <svg viewBox="0 0 250 66" className="h-[48px] w-full" aria-hidden="true">
      <path
        d={d}
        fill="none"
        stroke="#3FCB88"
        strokeWidth="2"
        strokeDasharray={DASH}
        strokeLinecap="round"
        className={styles.dashFlow}
      />
      <path
        d={d}
        fill="none"
        stroke="#8DF0BC"
        strokeWidth="2.4"
        strokeLinecap="round"
        pathLength={1}
        strokeDasharray={`${t} 1`}
      />
      {/* progress bead with its comet trail */}
      <ellipse cx={bx + 3} cy={by - 1} rx="7" ry="5" fill="#8DF0BC" opacity="0.55" />
      <circle cx={bx} cy={by} r="4" fill="#C8FBDE" />
      <PlaneMark x={224} y={-4} size={30} fill="#5FE3A0" />
    </svg>
  );
}

/**
 * In-phone Live Activity: a shallow dip with a diamond waypoint, sized to sit
 * beside the route text rather than under it.
 */
export function RouteDip({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 140 34" className={className} aria-hidden="true">
      <path
        d="M2 12 Q40 28 70 25 Q104 22 130 8"
        fill="none"
        stroke="#4FD794"
        strokeWidth="1.6"
        strokeDasharray="3 5"
        strokeLinecap="round"
        className={styles.dashFlow}
      />
      <path d="M70 20l4.5 5-4.5 5-4.5-5z" fill="#8DF0BC" />
      <PlaneMark x={120} y={-4} size={22} fill="#FFFFFF" />
    </svg>
  );
}
