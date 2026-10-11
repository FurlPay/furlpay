"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AlertTriangle, BadgeCheck, ClipboardCheck, Building2, FileText, Fingerprint, Gauge, Globe2, Inbox, LayoutDashboard, Menu, Scale, Settings2, ShieldAlert, X } from "lucide-react";
import Header from "@/components/settlement/os/Header";
import { COMPLIANCE_MODULES, type ComplianceModuleId } from "@/lib/compliance/modules";

const ICON: Record<ComplianceModuleId, typeof Gauge> = {
  kyc: BadgeCheck,
  kyb: Building2,
  aml: ShieldAlert,
  fraud: Fingerprint,
  monitoring: Gauge,
  travel: Globe2,
  india: Fingerprint,
  policies: Scale,
  reports: FileText,
  settings: Settings2,
};

/** The compliance workspace frame: the Settlement OS header plus a module sidebar. */
export default function ComplianceShell({ children }: { children: ReactNode }) {
  const path = usePathname() ?? "";
  const [nav, setNav] = useState(false);
  const current = (href: string) => (path === href ? "page" : undefined);
  return (
    <div className="os">
      <Header />
      <div className="os-app">
        <button type="button" className="os-nav-toggle os-btn os-btn-sm" aria-expanded={nav} aria-controls="compliance-nav" onClick={() => setNav(!nav)}>
          {nav ? <X size={16} /> : <Menu size={16} />} Menu
        </button>
        <aside id="compliance-nav" className={`os-sidenav ${nav ? "os-sidenav-open" : ""}`} aria-label="Compliance navigation">
          <nav>
            <Link href="/ops/compliance" aria-current={current("/ops/compliance")}>
              <LayoutDashboard size={18} /> Compliance Overview
            </Link>
            <Link href="/ops/compliance/cases" aria-current={current("/ops/compliance/cases")}>
              <Inbox size={18} /> Case Management
            </Link>
            <Link href="/ops/compliance/reviews" aria-current={current("/ops/compliance/reviews")}>
              <ClipboardCheck size={18} /> Onboarding Reviews
            </Link>
            <hr />
            {COMPLIANCE_MODULES.map((m) => {
              const Icon = ICON[m.id];
              return (
                <Link key={m.id} href={`/ops/compliance/${m.id}`} aria-current={current(`/ops/compliance/${m.id}`)}>
                  <Icon size={18} /> {m.label}
                </Link>
              );
            })}
          </nav>
          <div className="os-sidenav-card">
            <AlertTriangle size={22} color="var(--os-amber)" />
            <strong>Fail-closed by design</strong>
            <small>Capabilities without a configured provider show as unavailable and never return a pass.</small>
          </div>
        </aside>
        <div className="os-content">{children}</div>
      </div>
    </div>
  );
}
