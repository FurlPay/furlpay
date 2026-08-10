"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

// Right-column "On this page" table of contents. Docs pages are plain React
// (no markdown pipeline), so headings are read from the rendered article on
// navigation; IntersectionObserver tracks the section currently in view.
//
// Indicator design: ONE continuous hairline rail runs the height of the list,
// and the active item marks itself with a short rounded pill centred on its own
// row. The previous version turned the active row's full-height left border
// green, which read as a bright line slicing through unrelated content rather
// than as a position marker.

type Heading = { id: string; text: string; level: 2 | 3 };

// Matches the sticky header height, so an anchored heading lands below it
// instead of behind it.
const SCROLL_OFFSET = 88;

export default function DocsToc() {
  const pathname = usePathname();
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  // Set while a click-scroll is animating, so the observer doesn't fight the
  // intermediate sections flying past and leave the wrong item highlighted.
  const suppressSpy = useRef(false);

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

    const pick = () => {
      if (suppressSpy.current) return;
      // The heading whose top is closest to (but not past) the reading line.
      const line = SCROLL_OFFSET + 24;
      let current = nodes[0];
      for (const n of nodes) {
        if (n.getBoundingClientRect().top <= line) current = n;
        else break;
      }
      // At the very bottom the last section may never cross the line — if the
      // page is scrolled to the end, that section is what you're reading.
      const atBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      setActiveId(atBottom ? nodes[nodes.length - 1].id : current.id);
    };

    pick();
    window.addEventListener("scroll", pick, { passive: true });
    window.addEventListener("resize", pick);
    return () => {
      window.removeEventListener("scroll", pick);
      window.removeEventListener("resize", pick);
    };
  }, [pathname]);

  const go = useCallback((e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    suppressSpy.current = true;
    setActiveId(id);
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - SCROLL_OFFSET, behavior: "smooth" });
    history.replaceState(null, "", `#${id}`);
    window.setTimeout(() => {
      suppressSpy.current = false;
    }, 650);
  }, []);

  if (headings.length < 2) return null;

  return (
    <nav aria-label="On this page" className="docs-toc text-[13px]">
      <p className="mb-3.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
        On this page
      </p>
      {/* The rail is a pseudo-element on the list, so it is exactly one line for
          the whole component instead of one border per row. */}
      <ul className="relative before:absolute before:inset-y-0 before:left-0 before:w-px before:bg-[var(--border)]">
        {headings.map((h) => {
          const active = activeId === h.id;
          return (
            <li key={h.id}>
              <a
                href={`#${h.id}`}
                onClick={(e) => go(e, h.id)}
                aria-current={active ? "location" : undefined}
                className={`group relative block rounded-r-md py-[7px] leading-snug transition-colors duration-150 ${
                  h.level === 3 ? "pl-[26px] text-[12.5px]" : "pl-4"
                } ${
                  active
                    ? "font-medium text-[var(--accent)]"
                    : "text-[var(--muted)] hover:text-[var(--foreground)]"
                }`}
              >
                {/* Short pill, vertically centred on this row only. */}
                <span
                  aria-hidden
                  className={`absolute left-0 top-1/2 h-[15px] w-[2px] -translate-y-1/2 rounded-full transition-all duration-200 ${
                    active
                      ? "scale-y-100 bg-[var(--accent)] opacity-100"
                      : "scale-y-50 bg-[var(--foreground)] opacity-0 group-hover:opacity-25"
                  }`}
                />
                {h.text}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
