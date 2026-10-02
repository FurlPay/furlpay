"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  BadgePercent,
  BedDouble,
  Bot,
  Car,
  Check,
  CheckCircle2,
  Coins,
  CreditCard,
  Loader2,
  Lock,
  Plane,
  Receipt,
  ShieldCheck,
  Ticket,
  Timer,
  Wallet,
} from "lucide-react";
import { getJSON, HttpError, postJSON } from "@/lib/api";
import { Spinner } from "@/components/ui";
import { RATES, CASHBACK_RATE } from "@/lib/travel/data";
import EntryRequirementsCheck from "@/components/travel/EntryRequirementsCheck";
import { VisaMark } from "@/components/travel/checkout/PaymentNetworkMarks";

// ---------------------------------------------------------------------------
// Travel checkout.
//
// Everything on this page is either computed from the booking parameters with
// the same formula the server uses (quoteStay: 10% taxes, then cashback), read
// from the signed-in account, or stated as unavailable. Nothing is invented:
//
//   - No amount in the URL → no checkout (it used to fall back to $540).
//   - No traveller count is passed by any results page → none is shown (it used
//     to say "2 adults" / "1 adult" regardless).
//   - FurlPay balance is the account's real USDC balance (it used to be a fixed
//     "1,240.50 USDC").
//   - Credit / debit card: travel checkout has no card processor, so the option
//     is shown as not connected instead of advertising Visa/Mastercard/Amex.
//     The one-time virtual card IS a Visa card (lib/cards/rainAdapter.ts), so
//     the Visa mark appears there.
//   - The timer is a quote timer on this page. The server re-prices from the
//     subtotal when you book; nothing at the provider is held, so the page
//     never describes it as a held or guaranteed rate.
//   - Security lines state only what this code does.
// ---------------------------------------------------------------------------

type Method = "wallet" | "balance" | "vcard" | "card" | "agent";
type Kind = "stay" | "flight" | "activity" | "car";
type Booking = {
  id: string;
  authorization: {
    route: string;
    x402?: { proof: string; network: string };
    card?: { last4: string };
    cashbackUsd: number;
    rebate?: { developerUsd: number };
    simulated?: boolean;
  };
};

const QUOTE_SECONDS = 15 * 60;

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function parseKind(raw: string | null): Kind {
  return raw === "flight" || raw === "activity" || raw === "car" ? raw : "stay";
}

/** USDC available to the signed-in account, from its own balances. */
type BalanceState = { state: "loading" } | { state: "signed-out" } | { state: "error" } | { state: "ready"; usdc: number };

function useUsdcBalance(): BalanceState {
  const [b, setB] = useState<BalanceState>({ state: "loading" });
  useEffect(() => {
    let live = true;
    getJSON<{ tokenBalances?: { token: string; amount: number }[] }>("/api/overview")
      .then((o) => {
        if (!live) return;
        const usdc = (o.tokenBalances ?? []).filter((t) => t.token === "USDC").reduce((s, t) => s + t.amount, 0);
        setB({ state: "ready", usdc });
      })
      .catch((e: unknown) => {
        if (!live) return;
        setB({ state: e instanceof HttpError && e.status === 401 ? "signed-out" : "error" });
      });
    return () => {
      live = false;
    };
  }, []);
  return b;
}

function Checkout() {
  const params = useSearchParams();
  const kind = parseKind(params.get("kind"));
  const name = params.get("name") ?? "";
  const ref = params.get("ref") ?? "";
  const amountRaw = Number(params.get("amount"));
  const units = Math.max(0, Math.floor(Number(params.get("nights")) || 0));
  const img = params.get("img") ?? "";
  const carrier = params.get("carrier") ?? "";
  const meta = params.get("meta") ?? "";

  const [method, setMethod] = useState<Method>("wallet");
  const [agree, setAgree] = useState(false);
  const [quoteLeft, setQuoteLeft] = useState(QUOTE_SECONDS);
  const [booking, setBooking] = useState<Booking | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One idempotency key per checkout attempt: the server dedupes a retry
  // (double-click, timeout re-send) on it, so a booking happens at most once.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const balance = useUsdcBalance();

  useEffect(() => {
    const t = setInterval(() => setQuoteLeft((l) => (l > 0 ? l - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, []);

  if (!Number.isFinite(amountRaw) || amountRaw <= 0 || !name) {
    return (
      <div className="mx-auto max-w-md px-5 py-20 text-center">
        <Receipt className="mx-auto h-10 w-10 text-textSecondary" aria-hidden />
        <h1 className="mt-4 text-xl font-bold text-white">Nothing to check out</h1>
        <p className="mt-2 text-sm text-textSecondary">
          Choose a stay, flight, activity or car first; its price comes with it.
        </p>
        <Link href="/travel" className="mt-6 inline-flex rounded-xl bg-neon px-5 py-3 text-sm font-bold text-black transition hover:bg-neonDeep">
          Browse travel
        </Link>
      </div>
    );
  }

  const subtotal = amountRaw;
  // Same formula as the server's quoteStay(); the server recomputes and charges
  // its own figure, this only displays it.
  const taxes = Math.round(subtotal * 0.1 * 100) / 100;
  const cashback = Math.round((subtotal + taxes) * CASHBACK_RATE * 100) / 100;
  const total = Math.round((subtotal + taxes - cashback) * 100) / 100;
  const cashbackPct = Math.round(CASHBACK_RATE * 100);

  const quoteExpired = quoteLeft === 0;
  const mm = String(Math.floor(quoteLeft / 60)).padStart(2, "0");
  const ss = String(quoteLeft % 60).padStart(2, "0");

  const balanceSub =
    balance.state === "loading"
      ? "Checking your balance…"
      : balance.state === "signed-out"
        ? "Sign in to pay from your balance"
        : balance.state === "error"
          ? "Balance unavailable right now"
          : balance.usdc >= total
            ? `Available: ${balance.usdc.toLocaleString("en-US", { maximumFractionDigits: 2 })} USDC`
            : `Available: ${balance.usdc.toLocaleString("en-US", { maximumFractionDigits: 2 })} USDC — not enough for this booking`;
  const balanceUsable = balance.state === "ready" && balance.usdc >= total;

  const METHODS: {
    id: Method;
    Icon: typeof Wallet;
    title: string;
    sub: string;
    source: "travala" | "legacy";
    disabled?: boolean;
    badge?: React.ReactNode;
  }[] = [
    {
      id: "wallet",
      Icon: Wallet,
      title: "Crypto wallet",
      sub: "Phantom, Solflare or Coinbase Wallet. You approve the payment in your wallet.",
      source: "travala",
      badge: <MethodTag>x402 · Base</MethodTag>,
    },
    { id: "balance", Icon: Coins, title: "FurlPay balance", sub: balanceSub, source: "travala", disabled: !balanceUsable },
    {
      id: "vcard",
      Icon: CreditCard,
      title: "One-time virtual card",
      sub: "A single-use card locked to this merchant category and this amount.",
      source: "legacy",
      badge: <VisaMark label="Issued on Visa" />,
    },
    {
      id: "card",
      Icon: CreditCard,
      title: "Credit / debit card",
      sub: "Not connected yet: no card processor is attached to travel checkout.",
      source: "legacy",
      disabled: true,
    },
    {
      id: "agent",
      Icon: Bot,
      title: "AI agent authorization",
      sub: "Set a budget an AI agent may book within. Nothing is paid until a booking completes.",
      source: "travala",
      badge: <MethodTag>x402 · Base</MethodTag>,
    },
  ];
  const selected = METHODS.find((m) => m.id === method)!;
  const canPay = !busy && agree && !selected.disabled && !quoteExpired;

  async function pay() {
    if (!canPay) return;
    setBusy(true);
    setError(null);
    try {
      const res = await postJSON<{ booking?: Booking; error?: string; detail?: string; message?: string }>("/api/travel/book", {
        // The SUBTOTAL, not the total: the server computes taxes, cashback and
        // the total itself (quoteStay) and charges that.
        subtotalUsd: subtotal,
        source: selected.source,
        reference: ref,
        name,
        nights: units,
        method: selected.title,
        idempotencyKey,
      });
      if (res.ok && res.data.booking) {
        setBooking(res.data.booking);
        return;
      }
      setError(
        res.status === 503 && res.data.error === "not_available"
          ? "Booking isn't available yet: it is not connected to a live payment rail or travel provider. You were not charged."
          : (res.data.detail ?? res.data.message ?? "The booking could not be completed. You were not charged.")
      );
    } catch {
      setError("Could not reach FurlPay. You were not charged; check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (booking) {
    return (
      <div className="mx-auto max-w-md px-5 py-20 text-center">
        <CheckCircle2 className="mx-auto h-14 w-14 text-neon" aria-hidden />
        <h1 className="mt-4 text-2xl font-bold text-white">Booking confirmed</h1>
        <p className="mt-1 text-sm text-textSecondary">{name}</p>
        {booking.authorization.simulated && (
          <p className="mx-auto mt-3 max-w-sm rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-[12px] text-textSecondary">
            Development environment: this payment authorization is simulated. Nothing was charged.
          </p>
        )}
        <dl className="mt-6 space-y-2 rounded-card border border-white/10 bg-charcoal p-5 text-left text-sm">
          <SummaryRow label="Booking ID" value={booking.id} />
          <SummaryRow label="Total" value={usd(total)} />
          <SummaryRow label="Route" value={booking.authorization.route === "travala" ? "x402 · USDC on Base" : "Virtual card"} />
          {booking.authorization.x402 && (
            <SummaryRow
              label="Settlement"
              value={`${booking.authorization.x402.network} · ${booking.authorization.x402.proof.slice(0, 14)}…`}
            />
          )}
          {booking.authorization.card && <SummaryRow label="Card" value={`•••• ${booking.authorization.card.last4}`} />}
          <SummaryRow label="Cashback" value={`${usd(booking.authorization.cashbackUsd)} USDC`} tone="gain" />
        </dl>
        <div className="mt-6 flex justify-center gap-3">
          <Link href={`/travel/booking/${booking.id}`} className="rounded-xl bg-neon px-5 py-3 text-sm font-bold text-black transition hover:bg-neonDeep">
            View booking
          </Link>
          <Link href="/travel/my-trips" className="rounded-xl border border-white/15 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/[0.06]">
            My trips
          </Link>
        </div>
      </div>
    );
  }

  const LineIcon = kind === "flight" ? Plane : kind === "activity" ? Ticket : kind === "car" ? Car : BedDouble;
  const lineLabel =
    kind === "flight"
      ? "Fare"
      : kind === "activity"
        ? "Experience"
        : kind === "car"
          ? `Rental (${plural(units || 1, "day", "days")})`
          : `Room rate (${plural(units || 1, "night", "nights")})`;
  const metaLine =
    kind === "flight" ? meta : kind === "car" ? plural(units || 1, "day", "days") : kind === "stay" ? plural(units || 1, "night", "nights") : "";
  const backHref = kind === "flight" ? "/travel/flights" : kind === "stay" ? "/travel/stays" : "/travel";

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-24 pt-6 sm:px-6">
      <Link
        href={backHref}
        className="inline-flex items-center gap-1.5 rounded-lg py-1 text-sm text-textSecondary transition hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> Back to results
      </Link>
      <h1 className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-[28px]">Checkout</h1>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-8">
        {/* ── Booking summary ─────────────────────────────────────────────── */}
        <section aria-labelledby="summary-heading" className="overflow-hidden rounded-card border border-white/10 bg-charcoal lg:sticky lg:top-24">
          {kind === "stay" && img ? (
            <div className="relative h-36 w-full overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element -- remote listing photo */}
              <img src={img} alt="" className="absolute inset-0 h-full w-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
            </div>
          ) : null}

          <div className="p-5 sm:p-6">
            <h2 id="summary-heading" className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-textSecondary">
              <Receipt className="h-3.5 w-3.5" aria-hidden /> Booking summary
            </h2>

            <div className="mt-3 flex items-start gap-3">
              {kind === "flight" && img ? (
                <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element -- airline logo */}
                  <img src={img} alt={carrier ? `${carrier} logo` : ""} className="h-full w-full object-contain" />
                </span>
              ) : (
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-neon">
                  <LineIcon className="h-5 w-5" aria-hidden />
                </span>
              )}
              <div className="min-w-0">
                {kind === "flight" && carrier && <p className="truncate text-[13px] text-textSecondary">{carrier}</p>}
                <p className="break-words text-[17px] font-bold leading-snug text-white">{name}</p>
                {metaLine && <p className="mt-0.5 truncate text-[12.5px] text-textSecondary">{metaLine}</p>}
              </div>
            </div>

            <dl className="mt-5 space-y-2.5 border-t border-white/10 pt-4 text-[13.5px] tabular-nums">
              <SummaryRow label={lineLabel} value={usd(subtotal)} />
              <SummaryRow label="Taxes & fees (10%)" value={usd(taxes)} />
              <SummaryRow
                label={
                  <span className="inline-flex items-center gap-1.5">
                    <BadgePercent className="h-3.5 w-3.5" aria-hidden /> FurlPay cashback ({cashbackPct}%)
                  </span>
                }
                value={`−${usd(cashback)}`}
                tone="gain"
              />
            </dl>

            <div className="mt-4 flex items-baseline justify-between gap-3 border-t border-white/10 pt-4">
              <span className="text-[14px] font-semibold text-white">Total due</span>
              <span className="text-[22px] font-bold tabular-nums tracking-tight text-white">{usd(total)}</span>
            </div>
            <p className="mt-1.5 text-right text-[11.5px] leading-relaxed text-textMuted tabular-nums">
              Indicative: ≈ {total.toFixed(2)} USDC · {(total * RATES.XSGD).toFixed(2)} XSGD · {(total * RATES.SOL).toFixed(2)} SOL ·{" "}
              {(total * RATES.BTC).toFixed(5)} BTC
            </p>

            <p
              className={`mt-4 flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] ${
                quoteExpired ? "bg-loss/10 text-loss" : "bg-white/[0.04] text-textSecondary"
              }`}
              role={quoteExpired ? "alert" : undefined}
            >
              <Timer className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {quoteExpired ? (
                "This quote has expired. Refresh it to continue."
              ) : (
                <span>
                  Quote expires in <span className="font-semibold tabular-nums text-white">{mm}:{ss}</span>. The total is
                  re-checked by FurlPay when you book.
                </span>
              )}
            </p>
          </div>
        </section>

        {/* ── Payment ─────────────────────────────────────────────────────── */}
        <section aria-labelledby="payment-heading" className="min-w-0">
          <fieldset className="min-w-0">
            <legend id="payment-heading" className="mb-3 text-[15px] font-semibold text-white">
              Payment method
            </legend>
            <div className="space-y-2.5">
              {METHODS.map((m) => {
                const on = method === m.id;
                return (
                  <label
                    key={m.id}
                    className={`group relative flex items-center gap-3.5 rounded-xl border px-4 py-3.5 transition-colors ${
                      m.disabled
                        ? "cursor-not-allowed border-white/[0.06] bg-charcoal/60 opacity-60"
                        : on
                          ? "cursor-pointer border-neon bg-neon/[0.06]"
                          : "cursor-pointer border-white/10 bg-charcoal hover:border-white/25"
                    } has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-neon`}
                  >
                    <input
                      type="radio"
                      name="payment-method"
                      value={m.id}
                      checked={on}
                      disabled={m.disabled}
                      onChange={() => setMethod(m.id)}
                      className="sr-only"
                      aria-describedby={`pm-${m.id}-sub`}
                    />
                    <span
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                        on ? "bg-neon/15 text-neon" : "bg-white/[0.06] text-textSecondary"
                      }`}
                    >
                      <m.Icon className="h-[18px] w-[18px]" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-[14px] font-semibold text-white">{m.title}</span>
                        {m.badge}
                      </span>
                      <span id={`pm-${m.id}-sub`} className="mt-0.5 block text-[12px] leading-relaxed text-textSecondary">
                        {m.sub}
                      </span>
                    </span>
                    {/* Selected state is shown by the check as well as colour. */}
                    <span
                      aria-hidden
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                        on ? "border-neon bg-neon text-black" : "border-white/25"
                      }`}
                    >
                      {on && <Check className="h-3 w-3" strokeWidth={3} />}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="mt-5 flex items-start gap-3 rounded-xl border border-white/10 bg-charcoal px-4 py-3">
            <input
              id="terms"
              type="checkbox"
              checked={agree}
              onChange={(e) => setAgree(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-neon"
            />
            <label htmlFor="terms" className="text-[12.5px] leading-relaxed text-textSecondary">
              I agree to the{" "}
              <Link href="/legal/terms" className="font-medium text-white underline decoration-white/30 underline-offset-2 hover:decoration-white">
                travel terms
              </Link>{" "}
              and the cancellation policy for this booking.
            </label>
          </div>

          <button
            type="button"
            disabled={quoteExpired ? busy : !canPay}
            onClick={quoteExpired ? () => setQuoteLeft(QUOTE_SECONDS) : pay}
            aria-busy={busy || undefined}
            className="mt-4 flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-neon px-4 text-[15px] font-bold text-black transition-colors enabled:hover:bg-neonDeep enabled:active:bg-neonDeep focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neon disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> Authorizing…
              </>
            ) : quoteExpired ? (
              "Refresh quote"
            ) : (
              <>
                <Lock className="h-4 w-4" aria-hidden /> Complete booking · Pay {usd(total)}
              </>
            )}
          </button>
          {!busy && !quoteExpired && !canPay && (
            <p className="mt-2 text-center text-[12px] text-textMuted">
              {selected.disabled ? "Choose an available payment method." : !agree ? "Accept the travel terms to continue." : ""}
            </p>
          )}
          {error && (
            <p role="alert" className="mt-3 flex items-start gap-2 rounded-lg border border-loss/30 bg-loss/10 px-3 py-2.5 text-[12.5px] text-loss">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>{error}</span>
            </p>
          )}

          <ul className="mt-5 space-y-2 text-[12px] leading-relaxed text-textSecondary">
            <li className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neon" aria-hidden />
              FurlPay&apos;s server calculates the amount you pay; this page only displays it.
            </li>
            <li className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neon" aria-hidden />
              One booking per checkout: a retry or double click cannot book twice.
            </li>
          </ul>
        </section>
      </div>

      {/* Optional pre-trip entry check: does not gate payment, but surfaces
          visa/passport requirements where the traveller is committing. */}
      {kind === "flight" && (
        <details className="mt-6 rounded-card border border-white/10 bg-charcoal">
          <summary className="cursor-pointer px-5 py-4 text-sm font-semibold text-white">Check visa &amp; passport requirements</summary>
          <div className="px-3 pb-3">
            <EntryRequirementsCheck />
          </div>
        </details>
      )}
    </div>
  );
}

function MethodTag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-neon/25 bg-neon/[0.08] px-2 py-0.5 text-[10.5px] font-semibold text-neon">
      {children}
    </span>
  );
}

function SummaryRow({ label, value, tone }: { label: React.ReactNode; value: string; tone?: "gain" }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="min-w-0 text-textSecondary">{label}</dt>
      <dd className={`shrink-0 tabular-nums ${tone === "gain" ? "font-semibold text-neon" : "text-white"}`}>{value}</dd>
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <Checkout />
    </Suspense>
  );
}
