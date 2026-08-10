"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { DOCS_NAV, RESOURCES_NAV, type DocBadge } from "@/lib/docs/nav";

// Left column of the docs portal. Sections carry an icon and collapse/expand
// (the section containing the active page always opens); pages can carry
// New/Updated badges. Top-level resources render at the bottom.
//
// Active indicator: one hairline rail per section list, with a short rounded
// pill centred on the active row. Previously the active row's own full-height
// border went bright green, which competed with the text instead of pointing
// at it.

function BadgeChip({ badge }: { badge: DocBadge }) {
  return (
    <span
      className={`ml-1.5 inline-block translate-y-[-1px] rounded-[4px] border px-1 py-px align-middle text-[9px] font-semibold uppercase tracking-[0.08em] ${
        badge === "new"
          ? "border-[var(--accent)]/25 bg-[var(--accent)]/10 text-[var(--accent)]"
          : "border-[var(--border)] bg-[var(--panel-raised)] text-[var(--muted)]"
      }`}
    >
      {badge}
    </span>
  );
}

export default function DocsSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  return (
    <nav className="docs-sidebar space-y-6 text-[13.5px]">
      {DOCS_NAV.map((section) => {
        const containsActive = section.items.some((i) => i.href === pathname);
        const isCollapsed = (collapsed[section.label] ?? false) && !containsActive;
        const Icon = section.icon;
        return (
          <div key={section.label}>
            <button
              type="button"
              onClick={() => setCollapsed((c) => ({ ...c, [section.label]: !isCollapsed }))}
              aria-expanded={!isCollapsed}
              className="group mb-2.5 flex w-full items-center gap-2 text-left text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
            >
              <Icon
                className="h-3.5 w-3.5 flex-shrink-0 text-[var(--accent)]/60 transition-colors group-hover:text-[var(--accent)]"
                strokeWidth={1.75}
                aria-hidden
              />
              <span className="flex-1">{section.label}</span>
              <svg
                width="10"
                height="10"
                viewBox="0 0 10 10"
                fill="none"
                aria-hidden
                className={`flex-shrink-0 opacity-50 transition-transform duration-200 ${
                  isCollapsed ? "-rotate-90" : ""
                }`}
              >
                <path
                  d="M2 3.5 5 6.5 8 3.5"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            {!isCollapsed && (
              <ul className="relative before:absolute before:inset-y-0 before:left-0 before:w-px before:bg-[var(--border)]">
                {section.items.map((item) => {
                  const active = pathname === item.href;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onNavigate}
                        aria-current={active ? "page" : undefined}
                        className={`group relative block rounded-r-md py-[7px] pl-4 pr-2 leading-snug transition-colors duration-150 ${
                          active
                            ? "bg-[var(--accent)]/[0.06] font-medium text-[var(--accent)]"
                            : "text-[var(--muted)] hover:bg-white/[0.02] hover:text-[var(--foreground)]"
                        }`}
                      >
                        <span
                          aria-hidden
                          className={`absolute left-0 top-1/2 h-[15px] w-[2px] -translate-y-1/2 rounded-full transition-all duration-200 ${
                            active
                              ? "scale-y-100 bg-[var(--accent)] opacity-100"
                              : "scale-y-50 bg-[var(--foreground)] opacity-0 group-hover:opacity-25"
                          }`}
                        />
                        {item.title}
                        {item.badge && <BadgeChip badge={item.badge} />}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}

      <div className="border-t border-[var(--border)] pt-5">
        <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
          Resources
        </p>
        <ul>
          {RESOURCES_NAV.map((r) => (
            <li key={r.href}>
              <a
                href={r.href}
                onClick={onNavigate}
                target={r.external ? "_blank" : undefined}
                rel={r.external ? "noopener noreferrer" : undefined}
                className="flex items-center gap-1.5 rounded-md py-[7px] pl-0 pr-2 text-[var(--muted)] transition-colors duration-150 hover:text-[var(--foreground)]"
              >
                {r.title}
                {r.external && (
                  <ExternalLink className="h-3 w-3 opacity-50" aria-hidden />
                )}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
