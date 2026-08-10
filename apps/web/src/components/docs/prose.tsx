import Link from "next/link";
import { Pencil } from "lucide-react";
import { adjacentDocs } from "@/lib/docs/nav";
import { CopyButton, CodeTabs } from "@/components/docs/CodeControls";
import Highlight from "@/components/docs/Highlight";
import PageFeedback from "@/components/docs/PageFeedback";

export { CodeTabs };
export type { CodeTab } from "@/components/docs/CodeControls";
export { default as Mermaid } from "@/components/docs/Mermaid";

// Reusable prose primitives for docs pages — consistent typography without a
// markdown pipeline. Green-accented OLED theme, matching the landing page.

export function DocTitle({ eyebrow, children }: { eyebrow?: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      {eyebrow && (
        <p className="mb-2.5 text-[10.5px] font-semibold uppercase tracking-[0.2em] text-[var(--accent)]">
          {eyebrow}
        </p>
      )}
      {/* 34px / 1.15 with tight tracking: clear hierarchy against the 22px h2
          without the display-poster feel a 36px extrabold gave the page. */}
      <h1 className="text-[34px] font-bold leading-[1.15] tracking-[-0.03em]">{children}</h1>
    </div>
  );
}

export function Lead({ children }: { children: React.ReactNode }) {
  // Capped near a 70-character measure so the intro stays scannable even when
  // the article column is wide.
  return (
    <p className="mb-10 max-w-[62ch] text-[16.5px] leading-[1.65] text-[var(--muted)]">
      {children}
    </p>
  );
}

export function H2({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="mt-12 mb-4 scroll-mt-24 text-[24px] font-bold tracking-tighter">
      {children}
    </h2>
  );
}

export function H3({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <h3 id={id} className="mt-8 mb-3 scroll-mt-24 text-[17px] font-bold">
      {children}
    </h3>
  );
}

export function P({ children }: { children: React.ReactNode }) {
  return <p className="mb-4 text-[15px] leading-relaxed text-textMuted">{children}</p>;
}

export function UL({ children }: { children: React.ReactNode }) {
  return <ul className="mb-4 space-y-2 text-[15px] leading-relaxed text-textMuted">{children}</ul>;
}

export function LI({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-neon/70" />
      <span>{children}</span>
    </li>
  );
}

export function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 font-mono text-[13px] text-neon">
      {children}
    </code>
  );
}

export function CodeBlock({
  lang = "ts",
  filename,
  children,
}: {
  lang?: string;
  filename?: string;
  children: string;
}) {
  return (
    <div className="mb-6 overflow-hidden rounded-xl border border-white/10 bg-[#0A0A0C]">
      <div className="flex items-center justify-between gap-3 border-b border-white/5 px-4 py-2">
        <span className="flex min-w-0 items-baseline gap-2.5">
          <span className="text-[11px] font-medium uppercase tracking-wider text-textSecondary">{lang}</span>
          {filename && (
            <span className="truncate font-mono text-[11px] text-textMuted">{filename}</span>
          )}
        </span>
        <CopyButton text={children} />
      </div>
      <Highlight code={children} lang={lang} />
    </div>
  );
}

// Four callout tones matching GitHub-alert semantics. Default "tip" keeps the
// original green-accented look, so existing usages are unchanged.
export type CalloutType = "tip" | "info" | "warning" | "danger";

export function Callout({
  title,
  type = "tip",
  children,
}: {
  title?: string;
  type?: CalloutType;
  children: React.ReactNode;
}) {
  const tones: Record<CalloutType, { box: string; title: string }> = {
    tip: { box: "glow-border", title: "text-neon" },
    info: { box: "rounded-2xl border border-sky-400/25 bg-sky-400/[0.06]", title: "text-sky-300" },
    warning: { box: "rounded-2xl border border-amber-400/25 bg-amber-400/[0.06]", title: "text-amber-300" },
    danger: { box: "rounded-2xl border border-red-400/30 bg-red-400/[0.06]", title: "text-red-300" },
  };
  const tone = tones[type];
  return (
    <div className={`${tone.box} mb-6 p-5`}>
      {title && <p className={`mb-1 text-[14px] font-bold ${tone.title}`}>{title}</p>}
      <div className="text-[14px] leading-relaxed text-textMuted">{children}</div>
    </div>
  );
}

// Request/response parameter reference table (API docs standard).
export type Param = { name: string; type: string; required?: boolean; desc: string };

export function ParameterTable({ params }: { params: Param[] }) {
  return (
    <div className="mb-6 overflow-hidden rounded-xl border border-white/10">
      <table className="w-full text-left text-[13px]">
        <thead className="bg-white/[0.03] text-textSecondary">
          <tr>
            <th className="px-4 py-2.5 font-semibold">Parameter</th>
            <th className="px-4 py-2.5 font-semibold">Type</th>
            <th className="px-4 py-2.5 font-semibold">Description</th>
          </tr>
        </thead>
        <tbody>
          {params.map((p) => (
            <tr key={p.name} className="border-t border-white/5 align-top">
              <td className="px-4 py-2.5">
                <span className="font-mono text-[12.5px] font-semibold text-white/90">{p.name}</span>
                {p.required ? (
                  <span className="ml-2 rounded bg-red-400/10 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-red-300">required</span>
                ) : (
                  <span className="ml-2 rounded bg-white/[0.06] px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-textSecondary">optional</span>
                )}
              </td>
              <td className="px-4 py-2.5 font-mono text-[12px] text-neon/90">{p.type}</td>
              <td className="px-4 py-2.5 text-textMuted">{p.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function EndpointTable({ rows }: { rows: { method: string; path: string; desc: string }[] }) {
  return (
    <div className="mb-6 overflow-hidden rounded-xl border border-white/10">
      <table className="w-full text-left text-[13px]">
        <thead className="bg-white/[0.03] text-textSecondary">
          <tr>
            <th className="px-4 py-2.5 font-semibold">Method</th>
            <th className="px-4 py-2.5 font-semibold">Path</th>
            <th className="px-4 py-2.5 font-semibold">Description</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.method + r.path} className="border-t border-white/5">
              <td className="px-4 py-2.5">
                <span className="rounded-md border border-neon/20 bg-neonSoft px-2 py-0.5 font-mono text-[11px] font-bold text-neon">
                  {r.method}
                </span>
              </td>
              <td className="px-4 py-2.5 font-mono text-white/90">{r.path}</td>
              <td className="px-4 py-2.5 text-textMuted">{r.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Badge({ children, tone = "neon" }: { children: React.ReactNode; tone?: "neon" | "muted" }) {
  const tones = {
    neon: "border-neon/25 bg-neonSoft text-neon",
    muted: "border-white/10 bg-white/[0.04] text-textSecondary",
  };
  return (
    <span className={`rounded-md border px-2 py-0.5 font-mono text-[11px] font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function Figure({ caption, children }: { caption?: string; children: React.ReactNode }) {
  return (
    <figure className="mb-6 overflow-hidden rounded-2xl border border-white/10 bg-[#0A0A0C]">
      <div className="p-5">{children}</div>
      {caption && (
        <figcaption className="border-t border-white/5 bg-white/[0.02] px-5 py-2.5 text-[12px] text-textSecondary">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}

// Layered dependency graph. Each layer is a labelled row of nodes; layers stack
// top-to-bottom with a downward connector, so upper layers depend on lower ones.
export type GraphNode = { name: string; sub?: string };
export type GraphLayer = { label: string; hint?: string; nodes: GraphNode[]; accent?: boolean };

export function DepGraph({ layers, caption }: { layers: GraphLayer[]; caption?: string }) {
  // One card holds the whole diagram, with the caption sealed inside it above a
  // divider. Previously each layer was its own bordered box inside another
  // bordered figure, and the caption floated underneath — so the component read
  // as a stack of unrelated boxes rather than one diagram.
  return (
    <figure className="mb-8 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel)]">
      <div className="p-5 sm:p-6">
        {layers.map((layer, i) => (
          <div key={layer.label}>
            <div
              className={`rounded-xl border p-4 transition-colors ${
                layer.accent
                  ? "border-[var(--accent)]/25 bg-[var(--accent)]/[0.05]"
                  : "border-[var(--border)] bg-[var(--panel-raised)]"
              }`}
            >
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <span
                  className={`font-mono text-[10px] font-semibold uppercase tracking-[0.18em] ${
                    layer.accent ? "text-[var(--accent)]" : "text-[var(--muted)]"
                  }`}
                >
                  {layer.label}
                </span>
                {layer.hint && (
                  <span className="text-[11px] text-[var(--muted)]">{layer.hint}</span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {layer.nodes.map((n) => (
                  <div
                    key={n.name}
                    className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-lg border border-[var(--border)] bg-[var(--ground)] px-3 py-2"
                  >
                    <span className="font-mono text-[12px] font-medium text-[var(--foreground)]">
                      {n.name}
                    </span>
                    {n.sub && (
                      <span className="text-[11px] leading-snug text-[var(--muted)]">{n.sub}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
            {i < layers.length - 1 && (
              // A hairline stem with a chevron, centred on the card's axis — the
              // bare floating arrow never lined up with the boxes it joined.
              <div className="flex flex-col items-center py-2" aria-hidden>
                <span className="h-3 w-px bg-[var(--border)]" />
                <svg
                  width="12"
                  height="8"
                  viewBox="0 0 12 8"
                  fill="none"
                  className="-mt-px text-[var(--border)]"
                >
                  <path
                    d="M1 1.5 6 6.5l5-5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
            )}
          </div>
        ))}
      </div>
      {caption && (
        <figcaption className="border-t border-[var(--border)] bg-[var(--ground)]/40 px-5 py-3.5 text-[12.5px] leading-relaxed text-[var(--muted)] sm:px-6">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}

// Grid of workspace/module specification cards.
export type Spec = { name: string; badge?: string; desc: string };

export function SpecGrid({ specs }: { specs: Spec[] }) {
  return (
    <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
      {specs.map((s) => (
        <div key={s.name} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="font-mono text-[13px] font-bold text-neon">{s.name}</span>
            {s.badge && <Badge tone="muted">{s.badge}</Badge>}
          </div>
          <p className="text-[13px] leading-relaxed text-textMuted">{s.desc}</p>
        </div>
      ))}
    </div>
  );
}

// Page footer: feedback + edit link + prev/next pager driven by the doc order.
export function DocPager({ pathname }: { pathname: string }) {
  const { prev, next } = adjacentDocs(pathname);
  if (!prev && !next) return null;
  const editUrl = `https://github.com/Ashutosh0x/furlpay/edit/main/apps/web/src/app${pathname}/page.tsx`;
  return (
    <>
      <div className="mt-14 flex flex-wrap items-center justify-between gap-4 border-t border-white/5 pt-6">
        <PageFeedback pathname={pathname} />
        <a
          href={editUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-[12px] text-textSecondary transition-colors hover:text-white"
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden />
          Edit this page on GitHub
        </a>
      </div>
      <div className="mt-8 flex items-stretch justify-between gap-4">
      {prev ? (
        <Link href={prev.href} className="glass-card flex-1 p-4 transition-colors hover:border-neon/30">
          <p className="text-[12px] text-textSecondary">← Previous</p>
          <p className="mt-1 font-semibold">{prev.title}</p>
        </Link>
      ) : (
        <span className="flex-1" />
      )}
      {next ? (
        <Link href={next.href} className="glass-card flex-1 p-4 text-right transition-colors hover:border-neon/30">
          <p className="text-[12px] text-textSecondary">Next →</p>
          <p className="mt-1 font-semibold">{next.title}</p>
        </Link>
      ) : (
        <span className="flex-1" />
      )}
      </div>
    </>
  );
}
