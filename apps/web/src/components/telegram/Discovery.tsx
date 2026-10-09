"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowRight, BedDouble, ShoppingBag, ShoppingCart, Plane, Utensils, Gamepad2, TrainFront, Shirt, Fuel, Laptop, HeartPulse, GraduationCap, Ellipsis, Play, Globe2, CreditCard, Coins, ShieldCheck } from "lucide-react";
import { CardCarousel, PaymentCard } from "./PaymentCard";
import { DetailSheet, FeatureLink } from "./shared";

const categories = [
  { title: "Shopping", icon: ShoppingCart, color: "blue", description: "Explore the FurlPay Card for everyday purchases at eligible merchants." },
  { title: "Travel", icon: Plane, color: "cyan", description: "Discover flights and stays through FurlPay Travel. Availability and prices come from the booking provider." },
  { title: "Food & Dining", icon: Utensils, color: "orange", description: "From your morning coffee to dinner out, explore future card spending options." },
  { title: "Streaming", icon: Play, color: "pink", description: "Explore recurring online payments. Subscription support depends on the card program and merchant." },
  { title: "Gaming", icon: Gamepad2, color: "green", description: "Explore online entertainment spending with an eligible card." },
  { title: "Fashion", icon: Shirt, color: "violet", description: "Discover card options for shopping online and in-store." },
  { title: "Fuel", icon: Fuel, color: "red", description: "Fuel purchases can involve authorization holds. Issuer terms and merchant restrictions will apply." },
  { title: "Transport", icon: TrainFront, color: "cyan", description: "Explore everyday transport spending. Contactless acceptance depends on the card program and operator." },
  { title: "Software", icon: Laptop, color: "blue", description: "Explore payments for digital tools and services at supported merchants." },
  { title: "Health & Fitness", icon: HeartPulse, color: "pink", description: "Explore eligible health, wellness, and fitness spending." },
  { title: "Education", icon: GraduationCap, color: "violet", description: "Explore online learning and education spending with a supported payment method." },
  { title: "And more", icon: Ellipsis, color: "muted", description: "Card availability, eligible merchants, supported currencies, and limits will be published when the card program launches." },
];
const floaters = [{ label: "Flights", icon: Plane, color: "blue" }, { label: "Hotels", icon: BedDouble, color: "violet" }, { label: "Dining", icon: Utensils, color: "orange" }, { label: "Shopping", icon: ShoppingBag, color: "magenta" }, { label: "Games", icon: Gamepad2, color: "green" }, { label: "Transport", icon: TrainFront, color: "blue" }];

export default function Discovery() {
  const [category, setCategory] = useState<(typeof categories)[number] | null>(null);
  return <>
    <CardCarousel />
    <section className="mini-discovery-hero"><div><span className="mini-pill">FurlPay Cards</span><span className="mini-soon">Coming soon</span><h1>Pay globally with FurlPay</h1><p>A planned card for travel, subscriptions, and everyday spending.</p></div><Link className="mini-primary" href="/telegram/cards">Explore cards <ArrowRight size={21} /></Link></section>
    <section className="mini-everywhere"><div className="mini-everywhere-copy"><h2>Your money, <span>everywhere</span></h2><p>A new way to bring digital assets into everyday life.<br />Explore the future of spending with FurlPay.</p></div><div className="mini-orbit mini-orbit-one" /><div className="mini-orbit mini-orbit-two" /><div className="mini-orbit mini-orbit-three" />
      <div className="mini-phone" aria-hidden="true"><div className="mini-phone-island" /><div className="mini-phone-status"><span>FurlPay</span><span>••• ▰</span></div><PaymentCard compact /><div className="mini-phone-caption"><span>Made for your everyday.</span><strong>Built for everywhere.</strong></div><div className="mini-phone-line" /></div>
      {floaters.map(({ label, icon: Icon, color }, i) => <div className={`mini-floater mini-floater-${i} ${color}`} key={label} aria-hidden="true"><Icon /><span>{label}</span></div>)}
    </section>
    <section className="mini-possibilities"><h2>One card. More possibilities.</h2><p>A world of ways to use your FurlPay Card.</p><div className="mini-category-grid">{categories.map(item => <button className="mini-category" key={item.title} onClick={() => setCategory(item)}><item.icon className={`mini-color-${item.color}`} strokeWidth={2.2} /><span>{item.title}</span></button>)}</div>
      <div className="mini-feature-grid"><FeatureLink icon={Globe2} title="Online payments" description="Explore supported payment options." href="/telegram/pay" /><FeatureLink icon={Plane} title="Travel spending" description="Hotels, flights, and new horizons." href="/telegram/travel" /><FeatureLink icon={CreditCard} color="violet" title="Subscriptions" description="Explore recurring card payments." href="/telegram/cards?detail=subscriptions" /><FeatureLink icon={Coins} color="green" title="Stablecoin-powered" description="Get to know your digital assets." href="/telegram/wallet" /></div>
    </section>
    <div className="mini-disclosure"><ShieldCheck size={15} /><p>Card designs are a preview. Issuing and card spending are not yet available. Eligibility, region, and issuer terms will apply.</p></div>
    <Link href="/telegram/home" className="mini-text-link mini-discover-account">Go to your account <ArrowRight size={16} /></Link>
    {category && <DetailSheet title={category.title} close={() => setCategory(null)}><span className={`mini-detail-icon mini-color-${category.color}`}><category.icon size={42} /></span><p>{category.description}</p><div className="mini-notice">Card spending is not yet available. Category illustrations do not guarantee merchant acceptance.</div><Link href={category.title === "Travel" ? "/telegram/travel" : "/telegram/cards"} onClick={() => setCategory(null)} className="mini-primary">{category.title === "Travel" ? "Explore travel" : "Explore cards"}<ArrowRight size={17} /></Link></DetailSheet>}
  </>;
}
