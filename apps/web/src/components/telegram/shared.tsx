"use client";
import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";
import { ArrowRight, ShieldCheck, RefreshCw, X, type LucideIcon } from "lucide-react";
import { useMiniApp } from "./TelegramProvider";

export function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="mini-page-heading"><div><span className="mini-eyebrow">{eyebrow}</span><h1>{title}</h1>{description && <p>{description}</p>}</div>{action}</div>;
}
export function DetailSheet({ title, children, close }: { title: string; children: ReactNode; close(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  return <dialog ref={dialog} className="mini-dialog" aria-label={title} onCancel={close} onClick={e => { if (e.target === e.currentTarget) close(); }}><div className="mini-dialog-body"><div className="mini-dialog-heading"><h2>{title}</h2><button className="mini-icon-button" onClick={close} aria-label="Close details"><X /></button></div>{children}</div></dialog>;
}
export function FeatureLink({ title, description, icon: Icon, href, color = "blue" }: { title: string; description: string; icon: LucideIcon; href: string; color?: string }) {
  return <Link className="mini-feature" href={href}><span className={`mini-tile-icon ${color}`}><Icon size={25} /></span><span><strong>{title}</strong><small>{description}</small></span><ArrowRight size={18} /></Link>;
}
export function AccountGate({ children }: { children: ReactNode }) {
  const { dataStatus, refresh, authError, retryAuth, telegramStatus } = useMiniApp();
  if (dataStatus === "loading") return <div className="mini-panel mini-loading" role="status" aria-label="Loading account"><div /><div /><div /><span className="sr-only">Loading your account…</span></div>;
  if (dataStatus === "error") return <div className="mini-panel mini-empty" role="alert"><RefreshCw /><h2>Let’s try that again</h2><p>{authError || "Your account couldn’t be loaded. Please check your connection and try again."}</p><button className="mini-primary" onClick={() => { if (telegramStatus === "error") retryAuth(); else void refresh(); }}>Try again</button></div>;
  if (dataStatus === "anonymous") return <div className="mini-panel mini-empty"><span className="mini-empty-symbol"><ShieldCheck size={32} /></span><h2>Your FurlPay, connected.</h2><p>Sign in to see your balances, payments, and account activity. Your existing FurlPay account works here too.</p><Link className="mini-primary" href="/login?next=%2Ftelegram%2Fprofile">Sign in to FurlPay <ArrowRight size={17} /></Link><Link className="mini-text-link" href="/signup?next=%2Ftelegram%2Fprofile">Create an account</Link></div>;
  return <>{children}</>;
}
export function EmptyState({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) { return <div className="mini-empty"><span className="mini-empty-symbol"><Icon size={28} /></span><h2>{title}</h2><p>{children}</p></div>; }
export function money(amount: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(amount); }
