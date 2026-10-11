"use client";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Globe2 } from "lucide-react";
import { FurlPayMark } from "@/components/trips/FurlPayLogo";

export function PaymentCard({ variant = "world", compact = false, last4, network }: { variant?: "world" | "electric" | "pearl"; compact?: boolean; last4?: string; network?: "Visa" | "Mastercard" }) {
  return <div className={`mini-payment-card ${variant} ${compact ? "compact" : ""}`} role="img" aria-label={last4 ? `FurlPay ${network ?? ""} card ending in ${last4}` : `FurlPay ${variant} card design preview`}>
    {variant === "world" && <Image src="/images/telegram/global-network.webp" fill priority={!compact} sizes={compact ? "(max-width: 600px) 200px, 350px" : "(max-width: 940px) 85vw, 800px"} alt="" className="mini-card-art" />}
    <div className="mini-card-brand"><FurlPayMark tone="current" size={36} /><span>FurlPay</span></div>
    <svg className="mini-contactless" width="36" height="40" viewBox="0 0 36 40" fill="none" aria-hidden="true"><path d="M9 16a9 9 0 010 8m6-13a18 18 0 010 18m6-24a29 29 0 010 30m6-35a39 39 0 010 40" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>
    <div className="mini-card-footer"><span>{last4 ? `••••  ${last4}` : "DESIGN PREVIEW"}</span>{network === "Mastercard" ? <span className="mini-mastercard" aria-label="Mastercard"><i /><i /></span> : network === "Visa" ? <strong>VISA</strong> : <Globe2 size={29} strokeWidth={1.2} />}</div>
  </div>;
}

export function CardCarousel() {
  const rail = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(1);
  const variants = ["electric", "world", "pearl"] as const;
  const scrollTo = (index: number, smooth = true) => {
    const element = rail.current; const child = element?.children[index] as HTMLElement | undefined;
    if (element && child) element.scrollTo({ left: child.offsetLeft - element.offsetLeft - (element.clientWidth - child.clientWidth) / 2, behavior: smooth && !window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "smooth" : "instant" });
  };
  useEffect(() => { scrollTo(1, false); }, []);
  return <section className="mini-carousel" aria-label="FurlPay card designs" aria-roledescription="carousel"><div className="mini-card-rail" ref={rail} onScroll={() => {
    const el = rail.current; if (!el) return;
    const center = el.scrollLeft + el.clientWidth / 2;
    let closest = 0; let distance = Infinity;
    Array.from(el.children).forEach((child, i) => { const item = child as HTMLElement; const d = Math.abs(item.offsetLeft - el.offsetLeft + item.clientWidth / 2 - center); if (d < distance) { distance = d; closest = i; } });
    setSelected(closest);
  }}>{variants.map((variant, index) => <div key={variant} className="mini-card-slide" role="group" aria-label={`${index + 1} of 3`}><PaymentCard variant={variant} /></div>)}</div><div className="mini-carousel-dots">{variants.map((variant, i) => <button key={variant} aria-label={`View ${variant} card design`} aria-pressed={selected === i} onClick={() => scrollTo(i)}><span /></button>)}</div></section>;
}
