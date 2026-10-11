import Link from "next/link";
import type { CSSProperties } from "react";
import {
  BotMessageSquare,
  BriefcaseBusiness,
  Check,
  CircleUserRound,
  CreditCard,
  Database,
  FileCheck2,
  Fingerprint,
  Landmark,
  Plane,
  ShieldCheck,
  Sparkles,
  Store,
  Bot,
  Wallet,
  type LucideIcon,
} from "lucide-react";

/*
 * "FurlPay API Global Settlement Hub" — the homepage architecture diagram.
 *
 * DESKTOP IS THE REFERENCE, TO SCALE. Every box is placed in the reference
 * artwork's own coordinate space (1680 × 940) and every connector is drawn in
 * one SVG with that same viewBox, so lines meet their boxes at any width.
 * Type and icons are sized in container-query units (cqw) against the same
 * canvas, so proportions hold instead of drifting as the column narrows.
 *
 * PHONES GET THEIR OWN LAYOUT — the same five layers stacked, joined by
 * vertical rails — rather than the desktop canvas shrunk to illegibility.
 *
 * NO JAVASCRIPT. A Server Component: the motion is SVG <animateMotion> and the
 * site's CSS keyframes. Particles sit in a group hidden under
 * prefers-reduced-motion; the static glow remains.
 *
 * It is an ARCHITECTURE diagram, not an availability claim: several of these
 * surfaces are sandbox-only or in development, and the caption under the
 * figure links to "What is actually running", which lists each one.
 */

const W = 1680;
const H = 940;
const pct = (n: number, of: number) => `${(n / of) * 100}%`;
const box = (x: number, y: number, w: number, h: number): CSSProperties => ({
  left: pct(x, W),
  top: pct(y, H),
  width: pct(w, W),
  height: pct(h, H),
});
/** A length on the 1680-wide canvas, as container-query width units. */
const cq = (px: number) => `${(px / W) * 100}cqw`;

type Icon = LucideIcon;

const TOP: Array<{ label: string; Icon: Icon; extra?: Icon; x: number }> = [
  { label: "Your App", Icon: Check, x: 188 },
  { label: "AI Agent", Icon: Bot, extra: Sparkles, x: 455 },
  { label: "Marketplace", Icon: Store, x: 723 },
  { label: "Travel", Icon: BriefcaseBusiness, x: 991 },
  { label: "Fintech", Icon: CircleUserRound, x: 1259 },
];
const INFRA: Array<{ label: string; Icon: Icon; x: number; w: number }> = [
  { label: "Policy Engine", Icon: ShieldCheck, x: 215, w: 305 },
  { label: "Identity & Auth", Icon: Fingerprint, x: 540, w: 289 },
  { label: "Risk & Compliance", Icon: FileCheck2, x: 849, w: 289 },
  { label: "Ledger & Accounting", Icon: Database, x: 1157, w: 306 },
];
const PRODUCTS: Array<{ label: string[]; Icon: Icon; x: number }> = [
  { label: ["Payments"], Icon: Wallet, x: 100 },
  { label: ["Wallets &", "Accounts"], Icon: Landmark, x: 349 },
  { label: ["Cards"], Icon: CreditCard, x: 599 },
  { label: ["AI Agents", "& x402"], Icon: BotMessageSquare, x: 849 },
  { label: ["Travel APIs"], Icon: Plane, x: 1099 },
  { label: ["Banking & FX"], Icon: Landmark, x: 1350 },
];
const RAILS: Array<{ name: string; src: string }> = [
  { name: "USDC", src: "/logos/coins/usdc.svg" },
  { name: "BTC", src: "/logos/coins/btc.svg" },
  { name: "ETH", src: "/logos/coins/eth.svg" },
  { name: "SOL", src: "/logos/coins/sol.svg" },
];

/* Connectors, in canvas coordinates. Anchors match the boxes above. */
const LINES = {
  app: "M303 188 C303 228 318 237 360 237 L612 237 C646 237 657 256 657 289",
  agent: "M570 188 C570 226 657 222 657 289",
  market: "M839 188 L839 289",
  travel: "M1107 188 C1107 226 1021 222 1021 289",
  fintech: "M1374 188 C1374 228 1360 237 1318 237 L1066 237 C1032 237 1021 256 1021 289",
  left: "M428 353 L167 353 L167 520 C167 566 213 552 213 597",
  right: "M1251 353 L1512 353 L1512 520 C1512 566 1464 552 1464 597",
  hubDown: "M840 415 L840 440",
  toPolicy: "M840 432 C760 446 420 434 367 462",
  toIdentity: "M840 432 C800 444 700 444 684 462",
  toRisk: "M840 432 C880 444 980 444 993 462",
  toLedger: "M840 432 C920 446 1260 434 1310 462",
  policyWallets: "M470 545 C470 578 463 566 463 597",
  identityCards: "M688 545 C688 576 713 566 713 597",
  riskAgents: "M990 545 C990 576 963 566 963 597",
  ledgerTravel: "M1230 545 C1230 576 1213 566 1213 597",
} as const;
const MAIN = [LINES.app, LINES.agent, LINES.market, LINES.travel, LINES.fintech, LINES.left, LINES.right, LINES.hubDown, LINES.policyWallets, LINES.identityCards, LINES.riskAgents, LINES.ledgerTravel];
const SOFT = [LINES.toPolicy, LINES.toIdentity, LINES.toRisk, LINES.toLedger];
const NODES: Array<[number, number]> = [
  [303, 188], [570, 188], [839, 188], [1107, 188], [1374, 188],
  [657, 289], [839, 289], [1021, 289], [428, 353], [1251, 353], [840, 418],
  [213, 597], [463, 597], [713, 597], [963, 597], [1213, 597], [1464, 597],
  [688, 545], [990, 545],
];
/* Faint circuitry at both ends of the hub, and the outer traces. */
const CIRCUIT_LEFT = [
  "M170 320 L320 320", "M170 335 L250 335 L262 347", "M180 385 L330 385", "M170 398 L240 398",
  "M205 312 L205 405", "M240 318 L240 395", "M300 330 L300 378",
];
const TRACES = [
  "M560 268 L236 268 C170 268 122 300 122 366 L122 556",
  "M1120 268 L1444 268 C1510 268 1556 300 1556 366 L1556 556",
  "M600 300 C520 300 470 320 430 330", "M1080 300 C1160 300 1210 320 1250 330",
  "M610 405 C540 420 470 430 430 445", "M1070 405 C1140 420 1210 430 1250 445",
];

const NEON = "#21F0B4";

function FurlMark({ size, id }: { size: string; id: string }) {
  // The three-bar FurlPay "F", as the brand draws it in the nav, in the
  // reference's emerald gradient.
  return (
    <svg viewBox="0 0 64 64" style={{ width: size, height: size }} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5BFFD0" />
          <stop offset="1" stopColor="#00C98F" />
        </linearGradient>
      </defs>
      <g fill={`url(#${id})`}>
        <rect x="8" y="6" width="50" height="15" rx="7.5" />
        <rect x="8" y="25" width="38" height="15" rx="7.5" />
        <rect x="8" y="44" width="18" height="15" rx="7.5" />
        <rect x="8" y="6" width="15" height="53" rx="7.5" />
      </g>
    </svg>
  );
}

/** The card surface every box in the diagram shares. */
const CARD =
  "group/card absolute flex flex-col items-center justify-center border border-[#1EE0A6]/55 text-white transition-[border-color,box-shadow,transform] duration-300 hover:-translate-y-0.5 hover:border-[#3DFFC6] " +
  "bg-[linear-gradient(180deg,rgba(6,46,35,0.62),rgba(2,12,9,0.92))] shadow-[inset_0_0_22px_rgba(0,230,167,0.08),0_0_18px_rgba(0,230,167,0.10)] hover:shadow-[inset_0_0_26px_rgba(0,230,167,0.16),0_0_28px_rgba(0,230,167,0.30)]";

function DesktopCanvas() {
  return (
    <div className="relative hidden w-full [container-type:inline-size] lg:block">
      <div className="relative aspect-[1680/940] w-full">
        {/* Connectors and circuitry — under every box. */}
        <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full" aria-hidden>
          <defs>
            <filter id="hub-blur" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="4" />
            </filter>
            <radialGradient id="hub-halo" cx="0.5" cy="0.5" r="0.5">
              <stop offset="0" stopColor="#00E6A7" stopOpacity="0.30" />
              <stop offset="1" stopColor="#00E6A7" stopOpacity="0" />
            </radialGradient>
          </defs>
          <ellipse cx="840" cy="354" rx="560" ry="150" fill="url(#hub-halo)" className="flow-pulse" />
          <g stroke={NEON} fill="none" strokeLinecap="round" opacity="0.18" strokeWidth="1.1">
            {TRACES.map((d) => <path key={d} d={d} />)}
          </g>
          <g stroke={NEON} fill="none" opacity="0.45" strokeWidth="1.2">
            {CIRCUIT_LEFT.map((d) => <path key={d} d={d} />)}
            <g transform={`translate(${W} 0) scale(-1 1)`}>
              {CIRCUIT_LEFT.map((d) => <path key={d} d={d} />)}
            </g>
          </g>
          {/* Dashes on the side rails, like the reference. */}
          <g stroke={NEON} strokeWidth="5" strokeLinecap="round" opacity="0.9">
            <path d="M215 353 L232 353 M262 353 L284 353" />
            <path d="M1465 353 L1448 353 M1418 353 L1396 353" />
            <path d="M167 470 L167 486 M1512 470 L1512 486" />
          </g>
          <g stroke={NEON} fill="none" strokeLinecap="round">
            {MAIN.map((d) => <path key={`g${d}`} d={d} strokeWidth="6" opacity="0.35" filter="url(#hub-blur)" />)}
            {MAIN.map((d) => <path key={d} d={d} strokeWidth="1.8" opacity="0.95" />)}
            {SOFT.map((d) => <path key={d} d={d} strokeWidth="1.2" opacity="0.35" />)}
          </g>
          <g fill={NEON}>
            {NODES.map(([x, y]) => (
              <g key={`${x}-${y}`}>
                <circle cx={x} cy={y} r="9" opacity="0.25" filter="url(#hub-blur)" />
                <circle cx={x} cy={y} r="5" />
              </g>
            ))}
          </g>
          {/* Data in flight. Hidden under prefers-reduced-motion. */}
          <g className="motion-reduce:hidden" fill="#CFFFF0">
            {[
              [LINES.app, "5.5s", "0s"],
              [LINES.market, "2.6s", "0.8s"],
              [LINES.fintech, "5.5s", "1.6s"],
              [LINES.left, "6s", "0.4s"],
              [LINES.right, "6s", "2.4s"],
              [LINES.riskAgents, "3s", "1.2s"],
              [LINES.policyWallets, "3s", "2s"],
            ].map(([d, dur, begin]) => (
              <circle key={d} r="3.2" opacity="0.95">
                <animateMotion path={d} dur={dur} begin={begin} repeatCount="indefinite" />
              </circle>
            ))}
          </g>
        </svg>

        {/* Applications */}
        {TOP.map(({ label, Icon, extra: Extra, x }) => (
          <div key={label} className={CARD} style={{ ...box(x, 35, 231, 152), borderRadius: cq(20), gap: cq(14) }}>
            <span className="relative text-[#21F0B4] transition-transform duration-300 group-hover/card:scale-105">
              <Icon strokeWidth={label === "Your App" ? 3 : 1.9} style={{ width: cq(52), height: cq(52) }} aria-hidden />
              {Extra && <Extra strokeWidth={2} className="absolute" style={{ width: cq(20), height: cq(20), right: cq(-14), top: cq(-8) }} aria-hidden />}
            </span>
            <span className="font-semibold tracking-tight" style={{ fontSize: cq(25) }}>{label}</span>
          </div>
        ))}

        {/* The hub */}
        <div
          className="absolute flex items-center justify-center border-2 border-[#2BF7BC] bg-[radial-gradient(120%_140%_at_50%_0%,rgba(16,120,88,0.55),rgba(3,22,17,0.95)_62%)] shadow-[0_0_44px_rgba(0,230,167,0.45),inset_0_0_36px_rgba(0,230,167,0.22)]"
          style={{ ...box(428, 293, 823, 122), borderRadius: cq(62), gap: cq(46) }}
        >
          <span className="pointer-events-none absolute inset-0 overflow-hidden" style={{ borderRadius: cq(62) }} aria-hidden>
            <span className="ambient-drift absolute -inset-1/2 bg-[radial-gradient(40%_60%_at_50%_50%,rgba(60,255,200,0.16),transparent_70%)]" />
          </span>
          <FurlMark size={cq(64)} id="hub-mark-desktop" />
          <span className="relative font-extrabold tracking-tight text-white [text-shadow:0_0_24px_rgba(0,230,167,0.35)]" style={{ fontSize: cq(56) }}>
            FurlPay API
          </span>
        </div>

        {/* Infrastructure */}
        {INFRA.map(({ label, Icon, x, w }) => (
          <div key={label} className={`${CARD} !flex-row`} style={{ ...box(x, 462, w, 83), borderRadius: cq(18), gap: cq(14) }}>
            <Icon strokeWidth={1.8} className="text-[#21F0B4]" style={{ width: cq(34), height: cq(34) }} aria-hidden />
            <span className="font-medium" style={{ fontSize: cq(22) }}>{label}</span>
          </div>
        ))}

        {/* Products */}
        {PRODUCTS.map(({ label, Icon, x }) => (
          <div key={label.join(" ")} className={CARD} style={{ ...box(x, 598, 228, 160), borderRadius: cq(20), gap: cq(12) }}>
            <Icon strokeWidth={1.8} className="text-white transition-transform duration-300 group-hover/card:scale-105 group-hover/card:text-[#21F0B4]" style={{ width: cq(44), height: cq(44) }} aria-hidden />
            <span className="text-center font-semibold leading-tight" style={{ fontSize: cq(23) }}>
              {label.map((l) => <span key={l} className="block">{l}</span>)}
            </span>
          </div>
        ))}

        {/* Settlement rails */}
        <div
          className="absolute flex items-center justify-around border-2 border-[#1EE0A6]/60 bg-[linear-gradient(180deg,rgba(4,30,23,0.7),rgba(2,10,8,0.92))] shadow-[0_0_24px_rgba(0,230,167,0.18)]"
          style={{ ...box(263, 805, 820, 95), borderRadius: cq(48), paddingInline: cq(30) }}
          title="Supported rails vary by product"
        >
          {RAILS.map((r) => (
            <span key={r.name} className="flex items-center text-[#E6EAE8]" style={{ gap: cq(14), fontSize: cq(25) }}>
              <img src={r.src} alt="" className="rounded-full" style={{ width: cq(40), height: cq(40) }} />
              {r.name}
            </span>
          ))}
        </div>
        <span className="absolute bg-white/20" style={{ left: pct(1117, W), top: pct(830, H), width: 1, height: pct(48, H) }} aria-hidden />
        <span className="absolute flex items-center font-semibold text-[#A4AAA9]" style={{ left: pct(1150, W), top: pct(830, H), height: pct(48, H), fontSize: cq(24) }}>
          Global Settlement Rails
        </span>
      </div>
    </div>
  );
}

function Rail() {
  return (
    <div aria-hidden className="flex justify-center py-1.5">
      <span className="flow-rail block h-6 w-px rounded-full" />
    </div>
  );
}

const MCARD =
  "flex flex-col items-center justify-center gap-2 rounded-2xl border border-[#1EE0A6]/50 bg-[linear-gradient(180deg,rgba(6,46,35,0.6),rgba(2,12,9,0.92))] px-3 py-4 text-center text-white shadow-[inset_0_0_18px_rgba(0,230,167,0.08)]";

function StackedLayout() {
  return (
    <div className="lg:hidden">
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {TOP.map(({ label, Icon }, i) => (
          <li key={label} className={`${MCARD} ${i === 4 ? "col-span-2 sm:col-span-1" : ""}`}>
            <Icon strokeWidth={label === "Your App" ? 3 : 1.9} className="h-7 w-7 text-[#21F0B4]" aria-hidden />
            <span className="text-[14px] font-semibold">{label}</span>
          </li>
        ))}
      </ul>
      <Rail />
      <div className="flex items-center justify-center gap-3 rounded-[28px] border-2 border-[#2BF7BC] bg-[radial-gradient(120%_140%_at_50%_0%,rgba(16,120,88,0.55),rgba(3,22,17,0.95)_62%)] py-5 shadow-[0_0_34px_rgba(0,230,167,0.4)]">
        <FurlMark size="34px" id="hub-mark-stacked" />
        <span className="text-[28px] font-extrabold tracking-tight text-white">FurlPay API</span>
      </div>
      <Rail />
      <ul className="grid grid-cols-2 gap-3">
        {INFRA.map(({ label, Icon }) => (
          <li key={label} className={`${MCARD} !flex-row !justify-start gap-2.5 !py-3 text-left`}>
            <Icon strokeWidth={1.8} className="h-5 w-5 shrink-0 text-[#21F0B4]" aria-hidden />
            <span className="text-[13px] font-medium leading-tight">{label}</span>
          </li>
        ))}
      </ul>
      <Rail />
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {PRODUCTS.map(({ label, Icon }) => (
          <li key={label.join(" ")} className={MCARD}>
            <Icon strokeWidth={1.8} className="h-6 w-6 text-white" aria-hidden />
            <span className="text-[14px] font-semibold leading-tight">{label.join(" ")}</span>
          </li>
        ))}
      </ul>
      <Rail />
      <div className="rounded-[26px] border-2 border-[#1EE0A6]/60 bg-[linear-gradient(180deg,rgba(4,30,23,0.7),rgba(2,10,8,0.92))] px-4 py-4" title="Supported rails vary by product">
        <ul className="grid grid-cols-4 gap-2">
          {RAILS.map((r) => (
            <li key={r.name} className="flex flex-col items-center gap-1.5 text-[13px] text-[#E6EAE8] sm:flex-row sm:justify-center sm:text-[15px]">
              <img src={r.src} alt="" className="h-7 w-7 rounded-full" />
              {r.name}
            </li>
          ))}
        </ul>
        <p className="mt-3 border-t border-white/10 pt-3 text-center text-[13px] font-semibold text-[#A4AAA9]">Global Settlement Rails</p>
      </div>
    </div>
  );
}

export default function ApiSettlementHub() {
  return (
    <figure
      className="relative isolate overflow-hidden rounded-[28px] border border-white/[0.06] bg-[#020706] px-4 py-6 sm:px-6 sm:py-8 lg:px-6 lg:py-6"
      aria-label="FurlPay API architecture: your app, AI agents, marketplaces, travel and fintech connect to the FurlPay API; it runs on a policy engine, identity and auth, risk and compliance, and a ledger; it powers payments, wallets and accounts, cards, AI agents and x402, travel APIs, and banking and FX; and settles over USDC, BTC, ETH and SOL rails."
    >
      {/* Ground: near-black, a faint grid and dot field, two quiet glows. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 opacity-[0.07] [background-image:linear-gradient(rgba(33,240,180,0.5)_1px,transparent_1px),linear-gradient(90deg,rgba(33,240,180,0.5)_1px,transparent_1px)] [background-size:44px_44px]" />
        <div className="absolute inset-0 opacity-[0.10] [background-image:radial-gradient(rgba(33,240,180,0.7)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(70%_60%_at_50%_45%,black,transparent)]" />
        <div className="ambient-drift absolute left-1/2 top-[38%] h-[60%] w-[70%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(0,230,167,0.16),transparent)]" />
      </div>

      <DesktopCanvas />
      <StackedLayout />

      <figcaption className="mt-5 text-center text-[12.5px] text-textMuted lg:mt-3">
        How the FurlPay API fits together. Availability differs by product and rail — several are sandbox-only or in
        development.{" "}
        <Link href="#what-is-running" className="font-semibold text-neon hover:text-white">
          See what is actually running
        </Link>
        .
      </figcaption>
    </figure>
  );
}
