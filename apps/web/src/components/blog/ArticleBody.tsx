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
    default:
      return null;
  }
}
