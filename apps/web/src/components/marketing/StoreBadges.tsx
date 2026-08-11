import Link from "next/link";

// Mobile + desktop download badges.
//
// Both store badges link to /downloads rather than to a store listing, because
// neither listing is live yet — there is no play.google.com or apps.apple.com
// URL anywhere in this repo. /downloads states what is actually available
// today (the web app) and what each build is waiting on. Pointing a badge at a
// store page that does not exist is the kind of small fiction this codebase
// deliberately avoids.

function GooglePlayGlyph() {
  return (
    <svg viewBox="0 0 512 512" className="h-6 w-6 shrink-0" aria-hidden="true">
      <path fill="#00A0FF" d="M47 24c-6 3-9 9-9 17v430c0 8 3 14 9 17l248-232L47 24z" />
      <path fill="#00E676" d="M47 24l248 232 66-62-263-152C82 34 62 26 47 24z" />
      <path fill="#FFCE00" d="M361 194l-66 62 66 62 78-45c19-11 19-23 0-34l-78-45z" />
      <path fill="#FF3A44" d="M47 488c15-2 35-10 51-18l263-152-66-62L47 488z" />
    </svg>
  );
}

function AppleGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0" aria-hidden="true" fill="currentColor">
      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
    </svg>
  );
}

function Badge({
  glyph,
  small,
  large,
}: {
  glyph: React.ReactNode;
  small: string;
  large: string;
}) {
  return (
    <Link
      href="/downloads"
      className="flex min-w-[172px] flex-1 items-center gap-3 rounded-xl border border-white/15 bg-black px-4 py-2.5 transition-colors hover:border-white/35 sm:flex-none"
    >
      {glyph}
      <span className="text-left leading-tight">
        <span className="block text-[9px] uppercase tracking-wide text-textSecondary">{small}</span>
        <span className="block text-[15px] font-semibold">{large}</span>
      </span>
    </Link>
  );
}

export default function StoreBadges() {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex w-full flex-wrap items-stretch justify-center gap-3">
        <Badge glyph={<GooglePlayGlyph />} small="Get it on" large="Google Play" />
        <Badge glyph={<AppleGlyph />} small="Download on the" large="App Store" />
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2 text-[12px] text-textSecondary">
        <span className="text-textMuted">Desktop:</span>
        {[
          { os: "Windows", ext: ".msi" },
          { os: "macOS", ext: ".dmg" },
          { os: "Linux", ext: ".deb" },
        ].map((d) => (
          <Link
            key={d.os}
            href="/downloads"
            className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1 transition-colors hover:border-neon/40 hover:text-neon"
          >
            {d.os} <span className="text-textMuted">{d.ext}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
