"use client";

import { useEffect, useId, useState } from "react";

// Diagrams-as-code for the docs portal. Charts are static author-written
// strings (never user input); mermaid runs with securityLevel "strict" and the
// resulting SVG is injected into a Figure-style frame themed to the OLED/neon
// design tokens. The library is dynamically imported so it never enters the
// bundle of pages without diagrams. If a chart fails to parse, the raw
// definition is shown instead so the page stays readable.

const THEME_VARS = {
  background: "#000000",
  mainBkg: "#0A0A0C",
  primaryColor: "#0A2A22",
  primaryTextColor: "#FFFFFF",
  primaryBorderColor: "#00E599",
  secondaryColor: "#111113",
  secondaryBorderColor: "rgba(255,255,255,0.14)",
  secondaryTextColor: "#A1A1AA",
  tertiaryColor: "#111113",
  tertiaryBorderColor: "rgba(255,255,255,0.10)",
  tertiaryTextColor: "#A1A1AA",
  lineColor: "#8E8E93",
  textColor: "#A1A1AA",
  fontFamily: "ui-sans-serif, system-ui, sans-serif",
  fontSize: "13px",
  // sequence diagrams
  actorBkg: "#0A2A22",
  actorBorder: "#00E599",
  actorTextColor: "#FFFFFF",
  actorLineColor: "rgba(255,255,255,0.25)",
  signalColor: "#A1A1AA",
  signalTextColor: "#A1A1AA",
  labelBoxBkgColor: "#111113",
  labelBoxBorderColor: "rgba(255,255,255,0.14)",
  labelTextColor: "#FFFFFF",
  loopTextColor: "#A1A1AA",
  noteBkgColor: "#111113",
  noteBorderColor: "rgba(255,255,255,0.14)",
  noteTextColor: "#A1A1AA",
  activationBkgColor: "#0A2A22",
  activationBorderColor: "#00E599",
  // flowcharts
  nodeBorder: "#00E599",
  nodeTextColor: "#FFFFFF",
  clusterBkg: "#0A0A0C",
  clusterBorder: "rgba(255,255,255,0.14)",
  titleColor: "#FFFFFF",
  edgeLabelBackground: "#0A0A0C",
} as const;

export default function Mermaid({ chart, caption }: { chart: string; caption?: string }) {
  const reactId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [svg, setSvg] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "base",
          themeVariables: THEME_VARS,
          sequence: { mirrorActors: false, actorMargin: 44, messageMargin: 34 },
          flowchart: { curve: "basis", nodeSpacing: 34, rankSpacing: 44 },
        });
        const { svg: rendered } = await mermaid.render(`mmd${reactId}`, chart);
        if (!cancelled) setSvg(rendered);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chart, reactId]);

  return (
    <figure className="mb-6 overflow-hidden rounded-2xl border border-white/10 bg-[#0A0A0C]">
      <div className="overflow-x-auto p-5">
        {failed ? (
          <pre className="text-[12px] leading-relaxed text-textMuted">{chart}</pre>
        ) : svg ? (
          // Static author-written chart, sanitized by mermaid strict mode —
          // never user input (see module comment).
          <div className="[&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: svg }} />
        ) : (
          <div className="flex h-40 items-center justify-center text-[12px] text-textSecondary">
            Rendering diagram…
          </div>
        )}
      </div>
      {caption && (
        <figcaption className="border-t border-white/5 bg-white/[0.02] px-5 py-2.5 text-[12px] text-textSecondary">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}
