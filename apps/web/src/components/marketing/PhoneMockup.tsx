import { EyeIcon, SnowflakeIcon, SlidersIcon, GearIcon } from "@/components/icons";

// Floating Android phone showcasing the Furlpay card screen.
export default function PhoneMockup() {
  return (
    <div className="flex flex-col items-center">
      <div className="animate-float">
        {/* Android device frame */}
        <div className="relative h-[560px] w-[276px] rounded-[42px] border border-white/15 bg-[#0a0a0c] p-3 shadow-glow">
          {/* Punch-hole camera */}
          <div className="absolute left-1/2 top-4 z-10 h-2 w-2 -translate-x-1/2 rounded-full bg-white/25" />
          {/* Screen */}
          <div className="relative h-full w-full overflow-hidden rounded-[32px] bg-black">
            <div className="h-full w-full px-4 pt-8">
              <CardScreen />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CardScreen() {
  const actions = [
    { Icon: EyeIcon, label: "View" },
    { Icon: SnowflakeIcon, label: "Freeze" },
    { Icon: SlidersIcon, label: "Limit" },
    { Icon: GearIcon, label: "Settings" },
  ];
  return (
    <div>
      <p className="mb-3 text-left text-[13px] font-semibold">Furlpay Pro</p>
      <div className="relative h-[150px] w-full overflow-hidden rounded-2xl bg-gradient-to-br from-neonDeep to-[#053a2c] p-4">
        <div className="absolute right-4 top-4 text-[13px] font-bold italic text-white/90">VISA</div>
        <div className="mt-8 text-[15px] tracking-[0.2em] text-white/90">•••• 4417</div>
        <div className="mt-6 flex justify-between text-[10px] text-white/70">
          <span>ASHUTOSH</span>
          <span>08/29</span>
        </div>
        <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-white/10 blur-2xl" />
      </div>
      <div className="mt-5 grid grid-cols-4 gap-2">
        {actions.map(({ Icon, label }) => (
          <div key={label} className="flex flex-col items-center gap-1.5">
            <div className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/[0.05]">
              <Icon className="h-5 w-5 text-neon" />
            </div>
            <span className="text-[10px] text-textSecondary">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
