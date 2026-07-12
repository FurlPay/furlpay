"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { DOCS_NAV, RESOURCES_NAV, type DocBadge } from "@/lib/docs/nav";

// Left column of the docs portal. Sections carry an icon and collapse/expand
// (the section containing the active page always opens); pages can carry
// New/Updated badges. Top-level resources render at the bottom.

function BadgeChip({ badge }: { badge: DocBadge }) {
  return (
    <span
      className={`ml-2 rounded px-1.5 py-px text-[9px] font-bold uppercase tracking-wider ${
        badge === "new"
          ? "bg-neonSoft text-neon"
          : "bg-white/[0.07] text-textSecondary"
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
    <nav className="space-y-5 text-[14px]">
      {DOCS_NAV.map((section) => {
        const containsActive = section.items.some((i) => i.href === pathname);
        const isCollapsed = (collapsed[section.label] ?? false) && !containsActive;
        const Icon = section.icon;
        return (
          <div key={section.label}>
            <button
              type="button"
              onClick={() =>
                setCollapsed((c) => ({ ...c, [section.label]: !isCollapsed }))
              }
              aria-expanded={!isCollapsed}
              className="mb-2 flex w-full items-center gap-2 text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-textSecondary transition-colors hover:text-white"
            >
              <Icon className="h-3.5 w-3.5 flex-shrink-0 text-neon/70" strokeWidth={1.75} aria-hidden />
              <span className="flex-1">{section.label}</span>
              <svg
                width="10"
                height="10"
                viewBox="0 0 10 10"
                fill="none"
                aria-hidden
                className={`flex-shrink-0 transition-transform ${isCollapsed ? "-rotate-90" : ""}`}
              >
                <path d="M2 3.5 5 6.5 8 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {!isCollapsed && (
              <ul className="space-y-0.5 border-l border-white/8">
                {section.items.map((item) => {
                  const active = pathname === item.href;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onNavigate}
                        className={`-ml-px block border-l py-1.5 pl-4 transition-colors ${
                          active
                            ? "border-neon font-semibold text-neon"
                            : "border-transparent text-textMuted hover:border-white/30 hover:text-white"
                        }`}
                      >
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

      <div className="border-t border-white/8 pt-5">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-textSecondary">Resources</p>
        <ul className="space-y-0.5">
          {RESOURCES_NAV.map((r) => (
            <li key={r.href}>
              <a
                href={r.href}
                onClick={onNavigate}
                target={r.external ? "_blank" : undefined}
                rel={r.external ? "noopener noreferrer" : undefined}
                className="flex items-center gap-1.5 py-1.5 text-textMuted transition-colors hover:text-white"
              >
                {r.title}
                {r.external && <ExternalLink className="h-3 w-3 text-textSecondary" aria-hidden />}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
