"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { ArrowLeft, ArrowUpRight, CreditCard, Home, ScanLine, Clock3, UserRound, MoreHorizontal } from "lucide-react";
import { FurlPayMark } from "@/components/trips/FurlPayLogo";
import { useMiniApp } from "./TelegramProvider";

const tabs = [{ label: "Home", path: "/telegram/home", icon: Home }, { label: "Cards", path: "/telegram/cards", icon: CreditCard }, { label: "Pay", path: "/telegram/pay", icon: ScanLine }, { label: "Activity", path: "/telegram/activity", icon: Clock3 }, { label: "Profile", path: "/telegram/profile", icon: UserRound }];
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname(); const router = useRouter(); const { app, haptic } = useMiniApp();
  const history = useRef<string[]>([]);
  const previous = useRef(pathname);
  useEffect(() => {
    if (previous.current !== pathname) {
      if (history.current.at(-1) === pathname) history.current.pop();
      else history.current.push(previous.current);
      previous.current = pathname;
    }
    if (!app?.isVersionAtLeast("6.1")) return;
    const back = () => { if (history.current.length) router.back(); else router.replace("/telegram"); };
    const canBack = history.current.length > 0 || pathname !== "/telegram";
    if (canBack) app.BackButton.show(); else app.BackButton.hide();
    app.BackButton.onClick(back);
    return () => { app.BackButton.offClick(back); app.BackButton.hide(); };
  }, [app, pathname, router]);
  return <div className="mini-shell">
    <a href="#mini-main" className="mini-skip">Skip to content</a>
    <header className="mini-header">
      <div className="mini-header-left">
        {!app && pathname !== "/telegram" ? <Link className="mini-icon-button" href="/telegram" aria-label="Back to discover"><ArrowLeft /></Link> : <Link className="mini-logo" href="/telegram" aria-label="FurlPay discovery"><FurlPayMark tone="current" size={29} /></Link>}
        <Link href="/telegram" className="mini-wordmark">FurlPay<span>{app ? "mini app" : "Telegram mini app"}</span></Link>
      </div>
      <div className="mini-header-right"><Link href="/" className="mini-website">furlpay.com <ArrowUpRight size={14} /></Link><Link href="/telegram/profile" className="mini-icon-button" aria-label="Account and settings"><MoreHorizontal /></Link></div>
    </header>
    <main id="mini-main" className="mini-main">{children}</main>
    <nav className="mini-bottom-nav" aria-label="Main navigation">{tabs.map(({ label, path, icon: Icon }) => {
      const active = pathname === path || (label === "Home" && pathname === "/telegram");
      return <Link href={path} key={path} onClick={haptic} aria-current={active ? "page" : undefined} className={`${active ? "is-active" : ""} ${label === "Pay" ? "mini-pay-tab" : ""}`}><span><Icon size={21} strokeWidth={active ? 2.2 : 1.7} /></span><small>{label}</small></Link>;
    })}</nav>
  </div>;
}
