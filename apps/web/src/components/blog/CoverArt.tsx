// Cover for story cards / article headers. Renders a real photo (with a
// category-tinted overlay) when `photo` is set; otherwise falls back to the
// pure-CSS branded gradient. Both keep the small Furlpay watermark.
export default function CoverArt({
  color,
  label,
  className,
  photo,
}: {
  color: string;
  label: string;
  className?: string;
  photo?: string;
}) {
  if (photo) {
    return (
      <div className={`relative overflow-hidden ${className ?? ""}`}>
        <img src={photo} alt={label} loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
        <div
          className="absolute inset-0"
          style={{ background: `linear-gradient(135deg, ${color}40, rgba(10,10,12,0.55) 70%)` }}
        />
        <Watermark label={label} />
      </div>
    );
  }
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
      <Watermark label={label} />
    </div>
  );
}

function Watermark({ label }: { label: string }) {
  return (
    <div className="absolute bottom-3 left-4 flex items-center gap-2">
      <span className="flex h-5 w-5 items-center justify-center rounded bg-neon shadow-glow-sm">
        <svg viewBox="0 0 24 24" className="h-3 w-3 text-black" fill="none" stroke="currentColor" strokeWidth="3">
          <path d="M5 5h14M5 12h10M5 19h6" strokeLinecap="round" />
        </svg>
      </span>
      <span className="text-[11px] font-semibold text-white/70">{label}</span>
    </div>
  );
}
