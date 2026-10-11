"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  Check,
  CircleDollarSign,
  ExternalLink,
  FileText,
  Landmark,
  LayoutDashboard,
  Menu,
  Plus,
  Scale,
  Send,
  Settings2,
  ShieldCheck,
  Code2,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import type { Activity, DraftKind, WorkspaceRecord, WorkspaceSnapshot, Draft } from "@/lib/settlement/model";
import { FurlPayMark } from "@/components/trips/FurlPayLogo";
import Header from "./os/Header";
import { api, Notice } from "./os/primitives";
import DraftEditor, { DRAFT_LABELS } from "./DraftEditor";
import { DraftDetail, DraftList } from "./DraftViews";
import { Drawer } from "./ui";
import Transactions, { TransactionDetail } from "./Transactions";
import { Balances, BatchPayouts, Conversion, Receive, VirtualAccounts } from "./TreasuryTools";
import { Approvals, Compliance, DeveloperTools, Reconciliation, Reports, Settings } from "./ControlPanels";
import OverviewDashboard, { type Approval, type RailRow } from "./OverviewDashboard";
import type { OnboardingView } from "./onboarding/types";

// ---------------------------------------------------------------------------
// /settlement — the Settlement OS shell. Real routes, one persistent client
// shell (data loads once and survives navigation between sections):
//   /settlement                         Overview
//   /settlement/<section>[/<sub>]       a section, optionally a sub-view
// Every number comes from /api/settlement/* or an existing service API.
// ---------------------------------------------------------------------------

type ViewId =
  | "transactions" | "receive" | "links" | "invoices" | "checkout"
  | "payouts" | "batch" | "schedules" | "approvals" | "beneficiaries"
  | "balances" | "convert" | "rules"
  | "accounts" | "compliance" | "reconciliation" | "developers" | "reports" | "settings";

type Section = { id: string; label: string; icon: LucideIcon; subs: { slug: string; label: string; view: ViewId }[] };
export const SECTIONS: Section[] = [
  { id: "payments", label: "Payments", icon: CircleDollarSign, subs: [
    { slug: "transactions", label: "All transactions", view: "transactions" },
    { slug: "receive", label: "Receive USDC", view: "receive" },
    { slug: "links", label: "Payment links", view: "links" },
    { slug: "invoices", label: "Invoices", view: "invoices" },
    { slug: "checkout", label: "Hosted checkout", view: "checkout" },
  ] },
  { id: "payouts", label: "Payouts", icon: Send, subs: [
    { slug: "send", label: "Send funds", view: "payouts" },
    { slug: "batch", label: "Batch payouts", view: "batch" },
    { slug: "schedules", label: "Scheduled", view: "schedules" },
    { slug: "approvals", label: "Approvals", view: "approvals" },
    { slug: "beneficiaries", label: "Beneficiaries", view: "beneficiaries" },
  ] },
  { id: "treasury", label: "Treasury", icon: Wallet, subs: [
    { slug: "balances", label: "Balances", view: "balances" },
    { slug: "convert", label: "Convert & FX", view: "convert" },
    { slug: "rules", label: "Settlement rules", view: "rules" },
  ] },
  { id: "virtual-accounts", label: "Virtual Accounts", icon: Landmark, subs: [{ slug: "", label: "Virtual accounts", view: "accounts" }] },
  { id: "compliance", label: "Compliance", icon: ShieldCheck, subs: [{ slug: "", label: "Compliance", view: "compliance" }] },
  { id: "reconcile", label: "Reconcile", icon: Scale, subs: [{ slug: "", label: "Reconciliation", view: "reconciliation" }] },
  { id: "developers", label: "Developers", icon: Code2, subs: [{ slug: "", label: "Developers", view: "developers" }] },
];
const LOWER: Section[] = [
  { id: "reports", label: "Reports", icon: FileText, subs: [{ slug: "", label: "Reports & exports", view: "reports" }] },
  { id: "settings", label: "Settings", icon: Settings2, subs: [{ slug: "", label: "Settings", view: "settings" }] },
];
const ALL = [...SECTIONS, ...LOWER];
const VIEW_DRAFT: Partial<Record<ViewId, DraftKind>> = { links: "link", invoices: "invoice", payouts: "payout", schedules: "schedule", beneficiaries: "beneficiary", rules: "rule", checkout: "checkout" };
const TITLES: Partial<Record<ViewId, [string, string]>> = {
  transactions: ["All Transactions", "Every movement on your account ledger."],
  receive: ["Receive USDC", "One destination. Your choice of network."],
  links: ["Payment Links", "Fixed or open-amount links for collecting USDC."],
  invoices: ["Invoices", "Itemized invoices with taxes, discounts and due dates."],
  checkout: ["Hosted Checkout", "Branding, return URL and accepted networks."],
  payouts: ["Send Funds", "Prepare payouts to your recipients."],
  batch: ["Batch Payouts", "One file for your entire payment run."],
  schedules: ["Scheduled Payments", "One-time, weekly or monthly payouts."],
  approvals: ["Approvals", "Payments held for a decision before money moves."],
  beneficiaries: ["Beneficiaries", "The recipients you pay."],
  balances: ["Treasury Balances", "Every asset and account in one view."],
  convert: ["Convert & FX", "Live quotes with every cost in view."],
  rules: ["Settlement Rules", "Where incoming money is allocated."],
  accounts: ["Virtual Accounts", "Local bank rails in one workspace."],
  compliance: ["Compliance", "Verification, screening and the checks before money moves."],
  reconciliation: ["Reconciliation", "Make every movement add up."],
  developers: ["Developers", "Connect your systems to FurlPay."],
  reports: ["Reports & Exports", "Your activity, ready for accounting."],
  settings: ["Settings", "Make this workspace work for you."],
};

function resolve(path: string[]): { section: Section | null; view: ViewId | null } {
  if (path.length === 0) return { section: null, view: null };
  const section = ALL.find((s) => s.id === path[0]) ?? null;
  if (!section) return { section: null, view: null };
  const sub = section.subs.find((s) => s.slug === (path[1] ?? section.subs[0].slug)) ?? section.subs[0];
  return { section, view: sub.view };
}

export default function SettlementWorkspace({ path }: { path: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { section, view } = resolve(path);
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [snapError, setSnapError] = useState("");
  const [onboarding, setOnboarding] = useState<OnboardingView | null>(null);
  const [approvals, setApprovals] = useState<{ items: Approval[] | null; error: string }>({ items: null, error: "" });
  const [rails, setRails] = useState<{ items: RailRow[] | null; error: string }>({ items: null, error: "" });
  const [editor, setEditor] = useState<DraftKind | null>(null);
  const [record, setRecord] = useState<WorkspaceRecord | null>(null);
  const [toast, setToast] = useState("");
  const [nav, setNav] = useState(false);
  const [searchedTx, setSearchedTx] = useState<Activity | null>(null);
  const loadVersion = useRef(0);
  const loadAbort = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    loadAbort.current?.abort();
    const ac = new AbortController(); loadAbort.current = ac;
    setSnapError("");
    try {
      const next = await api<WorkspaceSnapshot>("/api/settlement/workspace", { signal: ac.signal });
      if (version === loadVersion.current) setSnapshot(next);
    } catch (e) {
      if (ac.signal.aborted || version !== loadVersion.current) return;
      if ((e as { status?: number }).status === 401) setSnapshot(null);
      setSnapError(e instanceof Error ? e.message : "Workspace unavailable");
    }
  }, []);
  useEffect(() => {
    void load();
    api<OnboardingView>("/api/settlement/onboarding").then(setOnboarding).catch(() => setOnboarding(null));
    api<{ approvals: Approval[] }>("/api/control-plane/approvals")
      .then((r) => setApprovals({ items: r.approvals, error: "" }))
      .catch((e) => setApprovals({ items: null, error: e.message }));
    api<{ rails: RailRow[] }>("/api/rails")
      .then((r) => setRails({ items: r.rails, error: "" }))
      .catch((e) => setRails({ items: null, error: e.message }));
  }, [load]);
  // Ledger state can change under the page (a payment settling). Refetch safely.
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === "visible" && void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(t);
  }, [toast]);
  // /settlement/<section>/<sub>?new=1 opens the matching editor (quick actions).
  useEffect(() => {
    if (params.get("new") === "1" && view && VIEW_DRAFT[view]) {
      setEditor(VIEW_DRAFT[view]!);
      router.replace(pathname);
    }
  }, [params, view, router, pathname]);
  useEffect(() => setNav(false), [pathname]);
  useEffect(() => () => { loadVersion.current++; loadAbort.current?.abort(); }, []);
  useEffect(() => {
    const tx = params.get("tx"), draft = params.get("draft");
    const ac = new AbortController();
    setSearchedTx(null);
    if (tx) api<{ items: Activity[] }>(`/api/settlement/transactions?limit=50&q=${encodeURIComponent(tx)}`, { signal: ac.signal })
      .then((r) => { if (!ac.signal.aborted) { const hit = r.items.find((t) => t.id === tx); hit ? setSearchedTx(hit) : setToast("Transaction not found on your account."); } })
      .catch((e) => { if (!ac.signal.aborted) setToast(e.message); });
    if (draft) api<{ record: WorkspaceRecord }>(`/api/settlement/workspace?id=${encodeURIComponent(draft)}`, { signal: ac.signal })
      .then((r) => { if (!ac.signal.aborted) setRecord(r.record); })
      .catch((e) => { if (!ac.signal.aborted) setToast(e.message); });
    return () => ac.abort();
  }, [params]);
  function closeSearchDetail() {
    setSearchedTx(null);
    const next = new URLSearchParams(params.toString()); next.delete("tx");
    router.replace(`${pathname}?${next}`, { scroll: false });
  }

  async function saveDraft(draft: Draft, id: string) {
    const saved = (await api<{ record: WorkspaceRecord }>("/api/settlement/workspace", { method: "POST", body: JSON.stringify({ id, data: draft }) })).record;
    loadVersion.current++; loadAbort.current?.abort();
    setSnapshot((cur) => (cur ? { ...cur, records: [saved, ...cur.records.filter((r) => r.id !== saved.id)] } : cur));
    setToast(`${DRAFT_LABELS[draft.kind]} draft saved to your account.`);
  }
  async function archive(item: WorkspaceRecord) {
    await api("/api/settlement/workspace", { method: "PATCH", body: JSON.stringify({ id: item.id }) });
    loadVersion.current++; loadAbort.current?.abort();
    setSnapshot((cur) => (cur ? { ...cur, records: cur.records.map((r) => (r.id === item.id ? { ...r, archivedAt: new Date().toISOString() } : r)) } : cur));
    setRecord(null);
    setToast("Draft archived.");
  }

  const pendingApprovals = approvals.items?.length ?? 0;
  const title = view ? TITLES[view] : null;
  const activation = onboarding?.state.activation.status;

  const content = useMemo(() => {
    if (!view) return null;
    if (!snapshot) return null;
    switch (view) {
      case "transactions":
        return <Transactions />;
      case "receive":
        return <Receive onMessage={setToast} />;
      case "balances":
        return <Balances snapshot={snapshot} onReceive={() => router.push("/settlement/payments/receive")} />;
      case "convert":
        return <Conversion />;
      case "batch":
        return <BatchPayouts onSave={saveDraft} onMessage={setToast} />;
      case "accounts":
        return <VirtualAccounts />;
      case "approvals":
        return <Approvals onMessage={setToast} />;
      case "reconciliation":
        return <Reconciliation transactions={snapshot.transactions} />;
      case "reports":
        return <Reports transactions={snapshot.transactions} />;
      case "compliance":
        return <Compliance snapshot={snapshot} />;
      case "developers":
        return <DeveloperTools />;
      case "settings":
        return <Settings />;
      default: {
        const kind = VIEW_DRAFT[view]!;
        return <DraftList kind={kind} records={snapshot.records} onCreate={() => setEditor(kind)} onOpen={setRecord} available={snapshot.storage === "available"} />;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, snapshot]);

  return (
    <div className="os">
      <Header user={snapshot || onboarding ? { name: snapshot?.name ?? onboarding?.account.name, company: onboarding?.state.business?.tradingName ?? onboarding?.state.business?.legalName } : null} environment={snapshot?.environment ?? onboarding?.environment} alerts={pendingApprovals} onAlerts={() => router.push("/settlement/payouts/approvals")} />
      <div className="os-app">
        <button type="button" className="os-nav-toggle os-btn os-btn-sm" aria-expanded={nav} aria-controls="os-sidenav" onClick={() => setNav(!nav)}>
          {nav ? <X size={16} /> : <Menu size={16} />} Menu
        </button>
        <aside id="os-sidenav" className={`os-sidenav ${nav ? "os-sidenav-open" : ""}`} aria-label="Workspace navigation">
          <nav>
            <Link href="/settlement" aria-current={!section ? "page" : undefined}>
              <LayoutDashboard size={18} /> Overview
            </Link>
            {SECTIONS.map((s) => (
              <Link key={s.id} href={`/settlement/${s.id}`} aria-current={section?.id === s.id ? "page" : undefined}>
                <s.icon size={18} /> {s.label}
              </Link>
            ))}
            <hr />
            <Link href="/onchain">
              <BarChart3 size={18} /> Analytics <ExternalLink size={12} className="os-sidenav-ext" />
            </Link>
            {LOWER.map((s) => (
              <Link key={s.id} href={`/settlement/${s.id}`} aria-current={section?.id === s.id ? "page" : undefined}>
                <s.icon size={18} /> {s.label}
              </Link>
            ))}
          </nav>
          <div className="os-sidenav-card">
            <FurlPayMark size={30} />
            <strong>FurlPay Wallet</strong>
            <small>Reserve your FurlPay handle and personal stablecoin wallet.</small>
            <Link className="os-btn os-btn-sm" href="/wallet">
              Learn more <ExternalLink size={12} />
            </Link>
          </div>
        </aside>

        <div className="os-content">
          {onboarding && activation !== "ACTIVE" && (
            <Notice tone="warn">
              <strong>Business onboarding: {onboarding.progress.done} of {onboarding.progress.total} steps complete.</strong> Activation is confirmed by the server once verification and review are finished.{" "}
              <Link className="os-link" href="/settlement/onboarding">
                Continue onboarding
              </Link>
            </Notice>
          )}
          {snapError && (
            <Notice tone="error">
              Your workspace could not be loaded: {snapError}{" "}
              <button type="button" className="os-link" style={{ background: "none", border: 0 }} onClick={() => void load()}>
                Retry
              </button>
            </Notice>
          )}
          {!section ? (
            <OverviewDashboard snapshot={snapshot} onboarding={onboarding} approvals={approvals} rails={rails} onToast={setToast} />
          ) : (
            <>
              <header className="os-page-head">
                <div>
                  <h1 className="os-title" style={{ marginTop: 0 }}>{title?.[0] ?? section.label}</h1>
                  <p className="os-subtitle">{title?.[1]}</p>
                </div>
                {view && VIEW_DRAFT[view] && (
                  <button type="button" className="os-btn os-btn-primary" disabled={snapshot?.storage !== "available"} onClick={() => setEditor(VIEW_DRAFT[view]!)}>
                    <Plus size={16} /> New {DRAFT_LABELS[VIEW_DRAFT[view]!]}
                  </button>
                )}
              </header>
              {section.subs.length > 1 && (
                <nav className="os-subnav" aria-label={`${section.label} views`}>
                  {section.subs.map((s) => (
                    <Link key={s.slug} href={`/settlement/${section.id}/${s.slug}`} aria-current={s.view === view ? "page" : undefined}>
                      {s.label}
                    </Link>
                  ))}
                </nav>
              )}
              {snapshot?.storage === "unavailable" && view && VIEW_DRAFT[view] && <Notice tone="info">{snapshot.storageMessage}</Notice>}
              <div className="settlement-app os-embedded">
                {snapshot ? (
                  <div className="st-content-stack">{content}</div>
                ) : !snapError ? (
                  <div className="os-skeleton" style={{ height: 320 }} aria-busy="true" aria-label="Loading" />
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>

      {searchedTx && <div className="settlement-app os-embedded"><TransactionDetail transaction={searchedTx} onClose={closeSearchDetail} /></div>}
      {editor && (
        <div className="settlement-app os-embedded">
          <Drawer title={`New ${DRAFT_LABELS[editor]}`} onClose={() => setEditor(null)}>
            <DraftEditor kind={editor} onSave={saveDraft} onClose={() => setEditor(null)} />
          </Drawer>
        </div>
      )}
      {record && (
        <div className="settlement-app os-embedded">
          <DraftDetail record={record} onArchive={archive} onClose={() => setRecord(null)} />
        </div>
      )}
      {toast && (
        <div className="os-toast" role="status">
          <Check size={17} color="var(--os-accent)" /> {toast}
        </div>
      )}
    </div>
  );
}
