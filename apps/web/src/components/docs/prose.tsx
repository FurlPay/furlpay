import Link from "next/link";
import { adjacentDocs } from "@/lib/docs/nav";
import { CopyButton, CodeTabs } from "@/components/docs/CodeControls";

export { CodeTabs };
export type { CodeTab } from "@/components/docs/CodeControls";

// Reusable prose primitives for docs pages — consistent typography without a
// markdown pipeline. Green-accented OLED theme, matching the landing page.

export function DocTitle({ eyebrow, children }: { eyebrow?: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      {eyebrow && (
        <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.18em] text-neon">{eyebrow}</p>
      )}
      <h1 className="text-[36px] font-extrabold leading-tight tracking-tighter">{children}</h1>
    </div>
  );
}

export function Lead({ children }: { children: React.ReactNode }) {
  return <p className="mb-8 text-[17px] leading-relaxed text-textMuted">{children}</p>;
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
      <pre className="overflow-x-auto px-4 py-4 text-[13px] leading-relaxed">
        <code className="font-mono text-white/90">{children}</code>
      </pre>
    </div>
  );
}

export function Callout({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="glow-border mb-6 p-5">
      {title && <p className="mb-1 text-[14px] font-bold text-neon">{title}</p>}
      <div className="text-[14px] leading-relaxed text-textMuted">{children}</div>
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
  return (
    <Figure caption={caption}>
      <div className="space-y-2">
        {layers.map((layer, i) => (
          <div key={layer.label}>
            <div
              className={`rounded-xl border p-3 ${
                layer.accent
                  ? "border-neon/25 bg-neonSoft/40"
                  : "border-white/10 bg-white/[0.03]"
              }`}
            >
              <div className="mb-2 flex items-baseline justify-between">
                <span className="text-[12px] font-bold uppercase tracking-wider text-textSecondary">
                  {layer.label}
                </span>
                {layer.hint && <span className="text-[11px] text-textMuted">{layer.hint}</span>}
              </div>
              <div className="flex flex-wrap gap-2">
                {layer.nodes.map((n) => (
                  <div
                    key={n.name}
                    className={`rounded-lg border px-3 py-1.5 ${
                      layer.accent
                        ? "border-neon/30 bg-black/30"
                        : "border-white/10 bg-black/40"
                    }`}
                  >
                    <span className="font-mono text-[12px] font-semibold text-white/90">{n.name}</span>
                    {n.sub && <span className="ml-2 text-[11px] text-textMuted">{n.sub}</span>}
                  </div>
                ))}
              </div>
            </div>
            {i < layers.length - 1 && (
              <div className="flex justify-center py-0.5 text-textSecondary" aria-hidden>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M8 2v10M4 9l4 4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            )}
          </div>
        ))}
      </div>
    </Figure>
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

// Prev/next pager driven by the flat doc order.
export function DocPager({ pathname }: { pathname: string }) {
  const { prev, next } = adjacentDocs(pathname);
  if (!prev && !next) return null;
  return (
    <div className="mt-16 flex items-stretch justify-between gap-4 border-t border-white/5 pt-8">
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
  );
}
