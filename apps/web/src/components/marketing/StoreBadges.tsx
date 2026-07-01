// Download badges shown beneath the phone mockup: Google Play + the three Tauri
// desktop wrappers (Windows .msi, macOS .dmg, Linux .deb). Links are placeholders
// pointing at /downloads until the artifacts are published.

function GooglePlayGlyph() {
  return (
    <svg viewBox="0 0 512 512" className="h-6 w-6" aria-hidden>
      <path fill="#00D2FF" d="M47 24c-6 3-9 9-9 17v430c0 8 3 14 9 17l248-232L47 24z" />
      <path fill="#00E599" d="M47 24l248 232 66-62-263-152C82 34 62 26 47 24z" />
      <path fill="#FFC800" d="M361 194l-66 62 66 62 78-45c19-11 19-23 0-34l-78-45z" />
      <path fill="#FF3B6B" d="M47 488c15-2 35-10 51-18l263-152-66-62L47 488z" />
    </svg>
  );
}

export default function StoreBadges() {
  return (
    <div className="flex flex-col items-center gap-3">
      <a
        href="/downloads"
        className="flex items-center gap-3 rounded-xl border border-white/15 bg-black px-5 py-2.5 transition-colors hover:border-white/30"
      >
        <GooglePlayGlyph />
        <span className="text-left leading-tight">
          <span className="block text-[9px] uppercase tracking-wide text-textSecondary">Get it on</span>
          <span className="block text-[15px] font-semibold">Google Play</span>
        </span>
      </a>

      <div className="flex items-center gap-2 text-[12px] text-textSecondary">
        <span className="text-textMuted">Desktop:</span>
        {[
          { os: "Windows", ext: ".msi" },
          { os: "macOS", ext: ".dmg" },
          { os: "Linux", ext: ".deb" },
        ].map((d) => (
          <a
            key={d.os}
            href="/downloads"
            className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1 transition-colors hover:border-neon/40 hover:text-neon"
          >
            {d.os} <span className="text-textMuted">{d.ext}</span>
          </a>
        ))}
      </div>
    </div>
  );
}
