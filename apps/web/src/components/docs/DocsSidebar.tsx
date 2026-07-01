"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DOCS_NAV } from "@/lib/docs/nav";

// Left column of the docs portal. Highlights the active page.
export default function DocsSidebar() {
  const pathname = usePathname();

  return (
    <nav className="space-y-7 text-[14px]">
      {DOCS_NAV.map((section) => (
        <div key={section.label}>
          <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-textSecondary">
            {section.label}
          </p>
          <ul className="space-y-0.5 border-l border-white/8">
            {section.items.map((item) => {
              const active = pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`-ml-px block border-l py-1.5 pl-4 transition-colors ${
                      active
                        ? "border-neon font-semibold text-neon"
                        : "border-transparent text-textMuted hover:border-white/30 hover:text-white"
                    }`}
                  >
                    {item.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
