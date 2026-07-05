import type { Block } from "@/lib/blog/posts";

// Renders structured article blocks with editorial typography.
export default function ArticleBody({ blocks }: { blocks: Block[] }) {
  return (
    <div>
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} />
      ))}
    </div>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case "h2":
      return (
        <h2 className="mb-3 mt-10 text-[22px] font-bold tracking-tighter text-textPrimary">{block.text}</h2>
      );
    case "p":
      return <p className="mb-4 text-[15px] leading-relaxed text-textMuted">{block.text}</p>;
    case "ul":
      return (
        <ul className="mb-4 space-y-2 text-[15px] leading-relaxed text-textMuted">
          {block.items.map((item, i) => (
            <li key={i} className="flex gap-2.5">
              <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-neon/70" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      );
    case "code":
      return (
        <div className="mb-6 overflow-hidden rounded-xl border border-white/10 bg-[#0A0A0C]">
          <div className="border-b border-white/5 px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-textSecondary">
            {block.lang}
          </div>
          <pre className="overflow-x-auto px-4 py-4 text-[13px] leading-relaxed">
            <code className="font-mono text-white/90">{block.code}</code>
          </pre>
        </div>
      );
    case "quote":
      return (
        <blockquote className="mb-6 border-l-2 border-neon/60 pl-4 text-[16px] italic leading-relaxed text-textMuted">
          {block.text}
        </blockquote>
      );
    case "diagram":
      return (
        <div className="mb-6 overflow-x-auto rounded-xl border border-neon/20 bg-white/[0.02] p-5">
          <pre className="font-mono text-[12.5px] leading-relaxed text-neon/90">{block.text}</pre>
        </div>
      );
    case "table":
      return (
        <div className="mb-6 overflow-x-auto rounded-xl border border-white/10 bg-white/[0.02]">
          <table className="w-full min-w-[720px] border-collapse text-left text-[13px] leading-relaxed">
            <thead>
              <tr className="border-b border-white/10">
                {block.headers.map((h, i) => (
                  <th
                    key={i}
                    className={`px-4 py-3 align-top text-[12px] font-semibold uppercase tracking-wider text-textSecondary ${
                      block.highlightCol === i ? "bg-neon/10 text-neon" : ""
                    }`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r} className="border-b border-white/5 last:border-b-0">
                  {row.map((cell, c) =>
                    c === 0 ? (
                      <th
                        key={c}
                        className="min-w-[120px] px-4 py-3 align-top text-[12px] font-semibold uppercase tracking-wider text-textSecondary"
                      >
                        {cell}
                      </th>
                    ) : (
                      <td
                        key={c}
                        className={`min-w-[170px] px-4 py-3 align-top text-textMuted ${
                          block.highlightCol === c ? "bg-neon/[0.06] text-textPrimary" : ""
                        }`}
                      >
                        {cell}
                      </td>
                    )
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    default:
      return null;
  }
}
