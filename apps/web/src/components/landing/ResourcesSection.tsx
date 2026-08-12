import Link from "next/link";
import {
  BookOpen,
  Braces,
  Terminal,
  Activity,
  History,
  Blocks,
  ArrowUpRight,
} from "lucide-react";
import Reveal from "./Reveal";
import { GitHubIcon } from "@/components/marketing/SocialIcons";

// Every destination here resolves — the previous footer had a /docs/integrations
// link with no index page behind it, which is exactly the sort of thing a
// developer notices first.
const RESOURCES = [
  { Icon: BookOpen, label: "Documentation", desc: "Concepts, guides, quickstarts", href: "/docs" },
  { Icon: Braces, label: "API reference", desc: "Every route and payload", href: "/docs/architecture/api-routes" },
  { Icon: Terminal, label: "SDKs", desc: "TypeScript, Python, Go, Rust", href: "/developer" },
  { Icon: GitHubIcon, label: "GitHub", desc: "Source, issues, releases", href: "https://github.com/Ashutosh0x/furlpay", external: true },
  { Icon: History, label: "Changelog", desc: "What shipped, when", href: "/changelog" },
  { Icon: Activity, label: "Status", desc: "System status board", href: "/status" },
  { Icon: Blocks, label: "Examples", desc: "Apps built on FurlPay", href: "/marketplace" },
  { Icon: Braces, label: "Webhooks", desc: "Signed event delivery", href: "/docs/architecture/webhooks" },
];

export default function ResourcesSection() {
  return (
    <section className="section section-y" id="resources" aria-labelledby="resources-title">
      <Reveal>
        <p className="section-eyebrow">Resources</p>
        <h2 className="section-title mt-3 max-w-3xl" id="resources-title">
          Everything you need to ship.
        </h2>
      </Reveal>

      <div className="mt-9 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {RESOURCES.map((r, i) => {
          const inner = (
            <>
              <div className="flex items-start justify-between gap-3">
                <r.Icon aria-hidden className="h-5 w-5 text-neon" />
                <ArrowUpRight
                  aria-hidden
                  className="h-4 w-4 text-textMuted transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-neon"
                />
              </div>
              <p className="mt-4 text-[15px] font-bold">{r.label}</p>
              <p className="mt-1 text-[12.5px] text-textSecondary">{r.desc}</p>
            </>
          );
          const cls = "surface surface-lift group block h-full p-5";
          return (
            <Reveal delay={i * 40} key={r.label}>
              {r.external ? (
                <a className={cls} href={r.href} rel="noopener noreferrer" target="_blank">
                  {inner}
                </a>
              ) : (
                <Link className={cls} href={r.href}>
                  {inner}
                </Link>
              )}
            </Reveal>
          );
        })}
      </div>
    </section>
  );
}
