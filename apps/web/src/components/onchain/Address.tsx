"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";

// A blockchain address or hash shown IN FULL (wraps on narrow screens; never
// truncated), with copy and an explorer link. What is copied is always the
// complete value, whatever the wrapping.

export function Address({ value, href, label = "address", className = "" }: { value: string; href?: string | null; label?: string; className?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("failed");
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2000);
  };
  return (
    <span className={`inline-flex min-w-0 max-w-full items-start gap-1 ${className}`}>
      <code className="min-w-0 select-all break-all font-mono text-[11px] leading-[1.45] text-white/80">{value}</code>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={`Copy ${label}`}
        title={state === "copied" ? "Copied" : `Copy ${label}`}
        className="mt-[1px] shrink-0 rounded p-0.5 text-white/40 hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#00E599]"
      >
        {state === "copied" ? <Check className="h-3 w-3 text-[#00E599]" aria-hidden="true" /> : <Copy className="h-3 w-3" aria-hidden="true" />}
      </button>
      {href && (
        <a href={href} target="_blank" rel="noopener noreferrer" aria-label={`View ${label} in explorer`} title="Open in explorer" className="mt-[1px] shrink-0 rounded p-0.5 text-white/40 hover:text-[#7DD3FC]">
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </a>
      )}
      <span role="status" className="sr-only">
        {state === "copied" ? `${label} copied` : state === "failed" ? "Copy failed; select the text to copy it." : ""}
      </span>
    </span>
  );
}

/** Explorer URL for an address or transaction on a chain whose explorer base is known. */
export function explorerUrl(explorer: string | null | undefined, kind: "address" | "tx", value: string): string | null {
  if (!explorer) return null;
  const base = explorer.replace(/\/+$/, "");
  const [root, query] = base.split("?");
  return `${root}/${kind}/${encodeURIComponent(value)}${query ? `?${query}` : ""}`;
}
