import { categoryById } from "@/lib/blog/categories";

// Tiny pill badge with a transparent fill and a 1px border in the category
// colour, per the brand blog framework.
export default function CategoryBadge({ id }: { id: string }) {
  const c = categoryById(id);
  if (!c) return null;
  return (
    <span
      style={{ color: c.color, borderColor: c.color, backgroundColor: `${c.color}1A` }}
      className="inline-block rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-tight"
    >
      {c.label}
    </span>
  );
}
