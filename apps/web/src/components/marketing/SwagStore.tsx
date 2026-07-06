"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ShoppingBag, Plus, Minus, X, Check, Loader2, Coins,
  Shirt, Backpack, Laptop, GlassWater, Coffee, Sticker, type LucideIcon,
} from "lucide-react";
import { SWAG, type SwagItem, type SwagCategory, type SwagIconName } from "@/lib/swag";

// Map catalog icon keys → Lucide components (used for the tile fallback + cart).
const ICONS: Record<SwagIconName, LucideIcon> = {
  shirt: Shirt, backpack: Backpack, laptop: Laptop, bottle: GlassWater, mug: Coffee, sticker: Sticker,
};

function SwagIcon({ name, className }: { name: SwagIconName; className?: string }) {
  const Icon = ICONS[name];
  return <Icon className={className} aria-hidden />;
}

type Line = { slug: string; qty: number; size?: string };
type CartLine = { key: string; item: SwagItem; qty: number; size?: string };
type Filter = SwagCategory | "all";

// Categories that actually have items, in a stable order.
const CATS: Filter[] = [
  "all",
  ...(["Apparel", "Drinkware", "Accessories", "Stickers"] as SwagCategory[]).filter((c) =>
    SWAG.some((s) => s.category === c)
  ),
];
const CART_KEY = "furlpay-swag-cart-v2";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const field =
  "w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-[14px] text-textPrimary placeholder:text-textSecondary focus:border-neon/50 focus:outline-none transition-colors";

const keyOf = (slug: string, size?: string) => (size ? `${slug}::${size}` : slug);

export default function SwagStore() {
  const [filter, setFilter] = useState<Filter>("all");
  const [cart, setCart] = useState<Record<string, Line>>({});
  const [sizeSel, setSizeSel] = useState<Record<string, string>>({});
  const [broken, setBroken] = useState<Record<string, boolean>>({});
  const [open, setOpen] = useState(false);

  // checkout
  const [stage, setStage] = useState<"cart" | "form" | "done">("cart");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [wallet, setWallet] = useState("");
  const [line1, setLine1] = useState("");
  const [city, setCity] = useState("");
  const [postal, setPostal] = useState("");
  const [country, setCountry] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(CART_KEY);
      if (raw) setCart(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch { /* ignore */ }
  }, [cart]);

  const items = useMemo(
    () => (filter === "all" ? SWAG : SWAG.filter((s) => s.category === filter)),
    [filter]
  );

  const lines = useMemo<CartLine[]>(
    () =>
      Object.entries(cart)
        .map(([key, l]): CartLine | null => {
          const item = SWAG.find((s) => s.slug === l.slug);
          return item ? { key, item, qty: l.qty, size: l.size } : null;
        })
        .filter((x): x is CartLine => x !== null),
    [cart]
  );

  const count = lines.reduce((n, l) => n + l.qty, 0);
  const totalPoints = lines.reduce((n, l) => n + l.item.points * l.qty, 0);

  function add(item: SwagItem) {
    const size = item.sizes ? sizeSel[item.slug] ?? item.sizes[2] : undefined;
    const key = keyOf(item.slug, size);
    setCart((c) => ({ ...c, [key]: { slug: item.slug, qty: (c[key]?.qty ?? 0) + 1, size } }));
    setOpen(true);
    setStage("cart");
  }
  function bump(key: string, d: number) {
    setCart((c) => {
      const cur = c[key];
      if (!cur) return c;
      const qty = cur.qty + d;
      if (qty <= 0) { const n = { ...c }; delete n[key]; return n; }
      return { ...c, [key]: { ...cur, qty } };
    });
  }
  function removeLine(key: string) {
    setCart((c) => { const n = { ...c }; delete n[key]; return n; });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (name.trim().length < 2) return setError("Enter your name.");
    if (!EMAIL_RE.test(email.trim())) return setError("Enter a valid email — we send confirmation here.");
    if (line1.trim().length < 3 || !city.trim() || !postal.trim() || country.trim().length < 2) {
      return setError("Complete your shipping address.");
    }
    setBusy(true);
    try {
      const res = await fetch("/api/swag/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, email, wallet,
          address: { line1, city, postal, country },
          items: lines.map((l) => ({ slug: l.item.slug, qty: l.qty, size: l.size })),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(prettyError(data.error));
      setOrderId(data.orderId);
      setStage("done");
      setCart({});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {/* Category filter + cart button */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-2">
          {CATS.map((c) => (
            <button
              key={c}
              onClick={() => setFilter(c)}
              className={`rounded-pill border px-3 py-1.5 text-[13px] font-semibold transition-all ${
                filter === c ? "border-neon/50 bg-neon/15 text-neon" : "border-white/10 text-textSecondary hover:text-white"
              }`}
            >
              {c === "all" ? "All" : c}
            </button>
          ))}
        </div>
        <button
          onClick={() => { setOpen(true); setStage("cart"); }}
          className="ml-auto inline-flex items-center gap-2 rounded-pill border border-white/10 bg-white/[0.03] px-4 py-2 text-[13px] font-semibold hover:border-neon/30"
        >
          <ShoppingBag className="h-4 w-4" /> Cart
          {count > 0 && <span className="rounded-full bg-neon px-2 py-0.5 text-[11px] font-bold text-black">{count}</span>}
        </button>
      </div>

      {/* Product grid */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => {
          const showImg = item.image && !broken[item.slug];
          return (
            <div key={item.slug} className="flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02] transition-all hover:-translate-y-0.5 hover:border-neon/30">
              <div className="relative flex aspect-square items-center justify-center overflow-hidden bg-gradient-to-br from-white/[0.06] to-white/[0.01]">
                {showImg ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.image}
                    alt={item.name}
                    className="h-full w-full object-cover"
                    onError={() => setBroken((b) => ({ ...b, [item.slug]: true }))}
                  />
                ) : (
                  <SwagIcon name={item.icon} className="h-16 w-16 text-textSecondary/50" />
                )}
                {item.badge && (
                  <span className="absolute left-3 top-3 rounded-full bg-neon px-2 py-0.5 text-[10px] font-bold text-black">{item.badge}</span>
                )}
                <span className="absolute right-3 top-3 rounded-full border border-white/10 bg-black/40 px-2 py-0.5 text-[10px] font-semibold text-textSecondary backdrop-blur">{item.category}</span>
              </div>

              <div className="flex flex-1 flex-col p-5">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-[16px] font-bold">{item.name}</h3>
                  <span className="inline-flex shrink-0 items-center gap-1 text-[14px] font-bold text-neon">
                    <Coins className="h-3.5 w-3.5" />{item.points}
                  </span>
                </div>
                <p className="mt-1.5 flex-1 text-[13px] leading-relaxed text-textSecondary">{item.description}</p>
                <p className="mt-2 text-[11px] text-textMuted">Worth ≈ ${item.worthUsd}</p>

                {item.sizes && (
                  <select
                    className={`${field} mt-3 py-2`}
                    value={sizeSel[item.slug] ?? item.sizes[2]}
                    onChange={(e) => setSizeSel((s) => ({ ...s, [item.slug]: e.target.value }))}
                    aria-label={`Size for ${item.name}`}
                  >
                    {item.sizes.map((s) => <option key={s} value={s} className="bg-charcoal">Size {s}</option>)}
                  </select>
                )}

                <button
                  onClick={() => add(item)}
                  className="mt-4 inline-flex items-center justify-center gap-2 rounded-pill bg-neon py-2.5 text-[14px] font-semibold text-black transition-transform hover:-translate-y-0.5"
                >
                  <Plus className="h-4 w-4" /> Add to cart
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Cart / checkout slide-over */}
      {open && (
        <div className="fixed inset-0 z-[120]">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <aside className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col border-l border-white/10 bg-oled shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 p-5">
              <h3 className="text-[16px] font-bold">
                {stage === "done" ? "Redemption received" : stage === "form" ? "Shipping details" : `Your cart${count ? ` · ${count}` : ""}`}
              </h3>
              <button onClick={() => setOpen(false)} aria-label="Close" className="rounded-full p-1 text-textSecondary hover:text-white"><X className="h-5 w-5" /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {stage === "done" ? (
                <div className="text-center">
                  <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-neon/20"><Check className="h-6 w-6 text-neon" /></div>
                  <p className="text-[15px] font-bold">Request <span className="text-neon">{orderId}</span> is in.</p>
                  <p className="mx-auto mt-2 max-w-xs text-[13px] text-textMuted">
                    We&apos;ve emailed your redemption to <strong className="text-white">hello@furlpay.com</strong> and will verify
                    your points and confirm shipping to your address. No points are deducted until we confirm.
                  </p>
                </div>
              ) : lines.length === 0 ? (
                <p className="py-16 text-center text-[14px] text-textMuted">Your cart is empty. Add some swag →</p>
              ) : (
                <>
                  <ul className="space-y-3">
                    {lines.map((l) => (
                      <li key={l.key} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
                        <SwagIcon name={l.item.icon} className="h-6 w-6 shrink-0 text-textSecondary" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[14px] font-semibold">{l.item.name}</p>
                          <p className="text-[12px] text-textMuted">{l.size ? `Size ${l.size} · ` : ""}{l.item.points} pts each</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button onClick={() => bump(l.key, -1)} aria-label="Decrease" className="rounded-full border border-white/10 p-1 hover:border-white/30"><Minus className="h-3.5 w-3.5" /></button>
                          <span className="w-5 text-center text-[14px] tabular-nums">{l.qty}</span>
                          <button onClick={() => bump(l.key, 1)} aria-label="Increase" className="rounded-full border border-white/10 p-1 hover:border-white/30"><Plus className="h-3.5 w-3.5" /></button>
                          <button onClick={() => removeLine(l.key)} aria-label="Remove" className="ml-1 text-textMuted hover:text-red-400"><X className="h-4 w-4" /></button>
                        </div>
                      </li>
                    ))}
                  </ul>

                  {stage === "form" && (
                    <form onSubmit={submit} className="mt-5 space-y-3">
                      <p className="text-[12px] text-textMuted">We use these only to verify your points and ship your swag.</p>
                      <input className={field} placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
                      <input className={field} type="email" placeholder="Email (for confirmation)" value={email} onChange={(e) => setEmail(e.target.value)} />
                      <input className={field} placeholder="Wallet address (optional — for points verification)" value={wallet} onChange={(e) => setWallet(e.target.value)} />
                      <input className={field} placeholder="Address line" value={line1} onChange={(e) => setLine1(e.target.value)} />
                      <div className="grid grid-cols-2 gap-3">
                        <input className={field} placeholder="City" value={city} onChange={(e) => setCity(e.target.value)} />
                        <input className={field} placeholder="Postal code" value={postal} onChange={(e) => setPostal(e.target.value)} />
                      </div>
                      <input className={field} placeholder="Country" value={country} onChange={(e) => setCountry(e.target.value)} />
                      {error && <p role="alert" className="text-[13px] text-red-400">{error}</p>}
                      <button type="submit" disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-pill bg-neon py-3 text-[15px] font-semibold text-black disabled:opacity-60">
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        {busy ? "Submitting…" : `Redeem ${totalPoints} points`}
                      </button>
                    </form>
                  )}
                </>
              )}
            </div>

            {stage === "cart" && lines.length > 0 && (
              <div className="border-t border-white/10 p-5">
                <div className="mb-3 flex items-center justify-between text-[14px]">
                  <span className="text-textSecondary">Total</span>
                  <span className="inline-flex items-center gap-1 font-bold text-white"><Coins className="h-4 w-4 text-neon" />{totalPoints} points</span>
                </div>
                <button onClick={() => setStage("form")} className="w-full rounded-pill bg-neon py-3 text-[15px] font-semibold text-black">
                  Redeem with points
                </button>
                <p className="mt-2 text-center text-[11px] text-textMuted">Next: add your email &amp; shipping address.</p>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

function prettyError(code?: string): string {
  if (!code) return "Something went wrong.";
  if (code.startsWith("size_required")) return "Pick a size for each apparel item.";
  if (code.startsWith("unknown_item")) return "One of the items is no longer available.";
  return "Please check your details and try again.";
}
