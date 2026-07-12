"use client";

import { useEffect, useState } from "react";

// Client-side syntax highlighting via shiki, lazy-loaded like Mermaid so the
// library never enters the initial bundle. SSR emits the plain <pre> (full
// text content for SEO and no layout shift); colors hydrate in after mount.
// Code strings are static author content and shiki HTML-escapes them, so the
// innerHTML injection below never carries user input.

const LANG_ALIASES: Record<string, string> = {
  ts: "typescript",
  js: "javascript",
  sh: "bash",
  shell: "bash",
  yml: "yaml",
  py: "python",
};
const SUPPORTED = new Set([
  "typescript", "tsx", "javascript", "jsx", "bash", "json", "python", "yaml", "solidity", "rust", "html", "css",
]);

type ShikiHighlighter = { codeToHtml: (code: string, opts: { lang: string; theme: string }) => string };
let highlighterPromise: Promise<ShikiHighlighter> | null = null;
function getHighlighter(): Promise<ShikiHighlighter> {
  if (!highlighterPromise) {
    highlighterPromise = import("shiki").then((m) =>
      m.createHighlighter({ themes: ["github-dark-default"], langs: [...SUPPORTED] })
    );
  }
  return highlighterPromise;
}

export default function Highlight({ code, lang }: { code: string; lang: string }) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    const normalized = LANG_ALIASES[lang] ?? lang;
    if (!SUPPORTED.has(normalized)) return; // unknown language stays plain
    let cancelled = false;
    (async () => {
      try {
        const hl = await getHighlighter();
        const out = hl.codeToHtml(code, { lang: normalized, theme: "github-dark-default" });
        if (!cancelled) setHtml(out);
      } catch {
        /* highlighting is progressive enhancement — plain text is fine */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, lang]);

  if (!html) {
    return (
      <pre className="overflow-x-auto px-4 py-4 text-[13px] leading-relaxed">
        <code className="font-mono text-white/90">{code}</code>
      </pre>
    );
  }
  return <div className="shiki-wrap" dangerouslySetInnerHTML={{ __html: html }} />;
}
