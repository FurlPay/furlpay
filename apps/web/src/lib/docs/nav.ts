// Sidebar structure for the developer documentation portal (furlpay.app/docs).
// Mirrors the 2026 blueprint: Getting Started, Architecture, Legal & Compliance,
// Security & Crypto.

export type DocLink = { title: string; href: string };
export type DocSection = { label: string; items: DocLink[] };

export const DOCS_NAV: DocSection[] = [
  {
    label: "Getting Started",
    items: [
      { title: "Introduction", href: "/docs" },
      { title: "Quickstart", href: "/docs/quickstart" },
    ],
  },
  {
    label: "Architecture",
    items: [
      { title: "Monorepo", href: "/docs/architecture/monorepo" },
      { title: "API Routes", href: "/docs/architecture/api-routes" },
    ],
  },
  {
    label: "Legal & Compliance",
    items: [{ title: "MiCA Roadmap", href: "/docs/compliance/mica" }],
  },
  {
    label: "Security & Crypto",
    items: [{ title: "MPC & WebAuthn", href: "/docs/security/mpc-webauthn" }],
  },
];

// Flat, ordered list of pages — used for prev/next footer navigation.
export const DOC_ORDER: DocLink[] = DOCS_NAV.flatMap((s) => s.items);

export function adjacentDocs(pathname: string): { prev?: DocLink; next?: DocLink } {
  const i = DOC_ORDER.findIndex((d) => d.href === pathname);
  if (i === -1) return {};
  return { prev: DOC_ORDER[i - 1], next: DOC_ORDER[i + 1] };
}
