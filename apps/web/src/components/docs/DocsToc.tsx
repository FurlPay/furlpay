"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

// Right-column "On this page" table of contents. Docs pages are plain React
// (no markdown pipeline), so headings are read from the rendered article on
// navigation; IntersectionObserver tracks the section currently in view.

type Heading = { id: string; text: string; level: 2 | 3 };

export default function DocsToc() {
  const pathname = usePathname();
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [activeId, setActiveId] = useState<string>("");

  useEffect(() => {
    const nodes = Array.from(
      document.querySelectorAll<HTMLHeadingElement>("article h2[id], article h3[id]")
    );
    setHeadings(
      nodes.map((n) => ({
        id: n.id,
        text: n.textContent ?? "",
        level: n.tagName === "H2" ? 2 : 3,
      }))
    );
    setActiveId(nodes[0]?.id ?? "");

    if (nodes.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        // Highlight the topmost heading currently intersecting the reading band.
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length > 0) {
          const top = visible.reduce((a, b) =>
            a.boundingClientRect.top < b.boundingClientRect.top ? a : b
          );
          setActiveId(top.target.id);
        }
      },
      { rootMargin: "-80px 0px -70% 0px" }
    );
    nodes.forEach((n) => observer.observe(n));
    return () => observer.disconnect();
  }, [pathname]);

  if (headings.length < 2) return null;

  return (
    <nav aria-label="On this page" className="text-[13px]">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-textSecondary">
        On this page
      </p>
      <ul className="space-y-0.5 border-l border-white/8">
        {headings.map((h) => (
          <li key={h.id}>
            <a
              href={`#${h.id}`}
              className={`-ml-px block border-l py-1 transition-colors ${
                h.level === 3 ? "pl-7" : "pl-4"
              } ${
                activeId === h.id
                  ? "border-neon font-medium text-neon"
                  : "border-transparent text-textMuted hover:border-white/30 hover:text-white"
              }`}
            >
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
