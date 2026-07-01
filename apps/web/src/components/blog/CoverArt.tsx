// Branded gradient cover for story cards / article headers. Pure CSS — no
// external images. Tinted by the category colour with a neon glow overlay and a
// small Furlpay watermark.
export default function CoverArt({
  color,
  label,
  className,
}: {
  color: string;
  label: string;
  className?: string;
}) {
  return (
    <div
      className={`relative overflow-hidden ${className ?? ""}`}
      style={{ background: `linear-gradient(135deg, ${color}33, #0a0a0c 70%)` }}
    >
      {/* coloured orb */}
      <div
        className="absolute -right-8 -top-10 h-40 w-40 rounded-full blur-3xl"
        style={{ background: `${color}66` }}
      />
      {/* neon accent wash */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(60% 80% at 25% 30%, rgba(0,229,153,0.22), transparent 60%)",
        }}
      />
      {/* faux card motif */}
      <div className="absolute right-5 top-1/2 h-16 w-24 -translate-y-1/2 rotate-[8deg] rounded-lg border border-white/15 bg-white/[0.06] backdrop-blur-sm" />
      {/* watermark */}
      <div className="absolute bottom-3 left-4 flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded bg-neon shadow-glow-sm">
          <svg viewBox="0 0 24 24" className="h-3 w-3 text-black" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M5 5h14M5 12h10M5 19h6" strokeLinecap="round" />
          </svg>
        </span>
        <span className="text-[11px] font-semibold text-white/70">{label}</span>
      </div>
    </div>
  );
}
