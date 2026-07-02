"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export const LEGAL_NAV = [
  // Core policies
  { title: "Terms of Service", href: "/legal/terms" },
  { title: "Privacy Policy", href: "/legal/privacy" },
  { title: "Cookie Policy", href: "/legal/cookies" },
  { title: "Risk Disclosure", href: "/legal/risk-disclosure" },
  { title: "AML / KYC Policy", href: "/legal/aml-kyc" },
  { title: "Acceptable Use", href: "/legal/acceptable-use" },
  { title: "Refund & Cancellation", href: "/legal/refund" },
  // Agentic & developer
  { title: "Agent Terms of Use", href: "/legal/agent-terms" },
  { title: "Responsible Disclosure", href: "/legal/responsible-disclosure" },
  // Compliance & data
  { title: "Data Processing (DPA)", href: "/legal/dpa" },
  { title: "Subprocessor List", href: "/legal/subprocessors" },
  { title: "Travel Rule", href: "/legal/travel-rule" },
  { title: "Grievance Redressal", href: "/legal/grievance" },
  { title: "Regulatory Disclosures", href: "/legal/disclosures" },
];

// Left rail for the legal section, highlighting the active page.
export default function LegalSidebar() {
  const pathname = usePathname();
  return (
    <nav className="text-[14px]">
      <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-textSecondary">
        Legal & Policies
      </p>
      <ul className="space-y-0.5 border-l border-white/8">
        {LEGAL_NAV.map((item) => {
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
    </nav>
  );
}
