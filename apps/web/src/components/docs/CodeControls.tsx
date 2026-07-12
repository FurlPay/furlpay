"use client";

import { useState } from "react";

// Client-side pieces of the docs code blocks: the copy-to-clipboard button and
// the multi-language tab switcher. The surrounding chrome stays in prose.tsx
// (server) so pages remain server components.

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label="Copy code"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          /* clipboard unavailable (insecure context) — nothing to do */
        }
      }}
      className={`rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
        copied
          ? "border-neon/40 bg-neonSoft text-neon"
          : "border-white/10 bg-white/[0.04] text-textSecondary hover:border-white/25 hover:text-white"
      }`}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export type CodeTab = { label: string; code: string };

// Language switcher: tabs across the top, one <pre> per tab. Code panels are
// passed as plain strings so the whole block stays copyable.
export function CodeTabs({ tabs, filename }: { tabs: CodeTab[]; filename?: string }) {
  const [active, setActive] = useState(0);
  const tab = tabs[active];
  return (
    <div className="mb-6 overflow-hidden rounded-xl border border-white/10 bg-[#0A0A0C]">
      <div className="flex items-center justify-between gap-3 border-b border-white/5 px-2 py-1.5">
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
          {tabs.map((t, i) => (
            <button
              key={t.label}
              type="button"
              onClick={() => setActive(i)}
              className={`whitespace-nowrap rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors ${
                i === active
                  ? "bg-white/[0.07] text-white"
                  : "text-textSecondary hover:text-white"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex flex-shrink-0 items-center gap-2 pr-1.5">
          {filename && (
            <span className="hidden font-mono text-[11px] text-textSecondary sm:inline">{filename}</span>
          )}
          <CopyButton text={tab.code} />
        </div>
      </div>
      <pre className="overflow-x-auto px-4 py-4 text-[13px] leading-relaxed">
        <code className="font-mono text-white/90">{tab.code}</code>
      </pre>
    </div>
  );
}
