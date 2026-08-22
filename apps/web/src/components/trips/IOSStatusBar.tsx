/**
 * iOS status bar plus the Dynamic Island cutout. Fixed at 9:41 — Apple's own
 * marketing time — because this is a product shot, not a running clock.
 */
export default function IOSStatusBar({ dark = false }: { dark?: boolean }) {
  const ink = dark ? "#FFFFFF" : "#0B0B0C";
  return (
    <div className="relative h-[52px] shrink-0 select-none">
      <span
        className="absolute left-[34px] top-[15px] text-[17px] font-semibold tracking-[-0.01em]"
        style={{ color: ink }}
      >
        9:41
      </span>

      <div className="absolute right-[30px] top-[17px] flex items-center gap-[6px]">
        {/* cellular */}
        <svg viewBox="0 0 18 12" className="h-[11px] w-[17px]" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <rect
              key={i}
              x={i * 4.5}
              y={9 - i * 2.6}
              width="3"
              height={3 + i * 2.6}
              rx="1"
              fill={ink}
            />
          ))}
        </svg>
        {/* wi-fi */}
        <svg viewBox="0 0 16 12" className="h-[11px] w-[15px]" fill="none" aria-hidden="true">
          <path d="M8 10.9l2.2-2.7a3.3 3.3 0 0 0-4.4 0L8 10.9z" fill={ink} />
          <path
            d="M3.6 5.9a6.4 6.4 0 0 1 8.8 0M1.3 3.3a10 10 0 0 1 13.4 0"
            stroke={ink}
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
        {/* battery */}
        <span className="flex items-center gap-[1px]">
          <span
            className="relative flex h-[12px] w-[24px] items-center rounded-[4px] border p-[1.5px]"
            style={{ borderColor: dark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.4)" }}
          >
            <span className="h-full w-[78%] rounded-[2px]" style={{ backgroundColor: ink }} />
          </span>
          <span
            className="h-[4px] w-[1.5px] rounded-r-[1px]"
            style={{ backgroundColor: dark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.4)" }}
          />
        </span>
      </div>

      {/* Dynamic Island */}
      <div className="absolute left-1/2 top-[11px] flex h-[37px] w-[125px] -translate-x-1/2 items-center justify-end rounded-full bg-black pr-[11px]">
        <span className="h-[13px] w-[13px] rounded-full bg-[#0d1520] ring-1 ring-[#16202c]">
          <span className="block h-[4px] w-[4px] translate-x-[4px] translate-y-[4px] rounded-full bg-[#1b3a63]" />
        </span>
      </div>
    </div>
  );
}
