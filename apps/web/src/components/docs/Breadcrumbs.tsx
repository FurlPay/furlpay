"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { docCrumbs } from "@/lib/docs/nav";

// "Docs / Section / Page" trail above the article title. Hidden on /docs
// itself (the root has no useful trail).
export default function Breadcrumbs() {
  const pathname = usePathname();
  if (pathname === "/docs") return null;
  const crumbs = docCrumbs(pathname);
  if (!crumbs) return null;

  return (
    <nav aria-label="Breadcrumb" className="mb-5 flex items-center gap-1.5 text-[12px] text-textSecondary">
      <Link href="/docs" className="transition-colors hover:text-white">
        Docs
      </Link>
      <span aria-hidden>/</span>
      <span>{crumbs.section}</span>
      <span aria-hidden>/</span>
      <span className="text-white/80">{crumbs.title}</span>
    </nav>
  );
}
