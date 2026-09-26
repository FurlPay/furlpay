"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  calculateTransferComparison,
  ESTIMATE_DISCLOSURE,
  type Channel,
  type SendCurrencyMode,
} from "@/lib/calculators/bankFeeComparison";

// ---------------------------------------------------------------------------
// Interactive half of the transfer comparison.
//
// THE HONEST FRAMING IS THE PRODUCT. The obvious version of this page shows a
// big red "CommBank: $205" next to a green "FurlPay: $0.01" and lets the
// reader assume the $205 is a fee CommBank charges. Most of it is not a fee at
// all — it is an exchange-rate margin that the bank never quotes as a number,
// and the upfront fee online is genuinely $0.
//
// So the table SEPARATES the two columns and labels the margin as estimated.
// That is a weaker headline and a much stronger page: it is the difference
// between a comparison a bank's legal team can kill and one they cannot.
// ---------------------------------------------------------------------------

const AMOUNTS = [1_000, 5_000, 20_000];
const CURRENCIES = ["USD", "SGD", "EUR", "GBP"] as const;

/**
 * Indicative mid-market rates.
 *
 * PRESENTED AS INDICATIVE AND DATED, never as a live quote. A calculator that
 * showed a stale rate as if it were current would be making the same move this
 * page criticises banks for. A future revision should read these from the FX
 * service; until then the UI says plainly that they are indicative.
 */
const INDICATIVE_RATES: Record<string, number> = {
  USD: 0.67,
  SGD: 0.86,
  EUR: 0.62,
  GBP: 0.52,
};
const RATES_AS_OF = "2026-09-17";

function aud(n: number): string {
  return n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });
}

export default function FxComparisonClient() {
  const [amount, setAmount] = useState(5_000);
  const [toCurrency, setToCurrency] = useState<(typeof CURRENCIES)[number]>("USD");
  const [channel, setChannel] = useState<Channel>("online");
  const [mode, setMode] = useState<SendCurrencyMode>("foreign");

  const result = useMemo(() => {
    try {
      return calculateTransferComparison({
        amount,
        fromCurrency: "AUD",
        toCurrency,
        referenceRate: INDICATIVE_RATES[toCurrency],
        channel,
        sendCurrencyMode: mode,
      });
    } catch {
      return null;
    }
  }, [amount, toCurrency, channel, mode]);

  if (!result) return null;

  const cba = result.providers.find((p) => p.id === "cba");

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <h1 className="text-3xl font-semibold text-white">
        International transfer fee calculator
      </h1>
      <p className="mt-3 max-w-2xl text-sm text-textSecondary">
        What an Australian bank transfer actually costs, split into the fee they
        publish and the exchange-rate margin they don&apos;t — compared with
        sending the same money as a stablecoin.
      </p>

      {/* --- controls --------------------------------------------------- */}
      <div className="mt-8 grid gap-6 rounded-xl border border-white/10 bg-white/[0.02] p-6 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-textSecondary">
            Sending
          </span>
          <input
            type="number"
            min={1}
            max={1_000_000}
            value={amount}
            onChange={(e) => setAmount(Math.max(1, Number(e.target.value) || 1))}
            className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-lg text-white"
            aria-label="Amount to send in Australian dollars"
          />
          <div className="mt-2 flex gap-2">
            {AMOUNTS.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setAmount(a)}
                className={`rounded-md px-2 py-1 text-xs ${
                  amount === a ? "bg-neon text-black" : "bg-white/5 text-textSecondary"
                }`}
              >
                {aud(a)}
              </button>
            ))}
          </div>
        </label>

        <label className="block">
          <span className="text-xs uppercase tracking-wide text-textSecondary">
            Recipient receives
          </span>
          <select
            value={toCurrency}
            onChange={(e) => setToCurrency(e.target.value as (typeof CURRENCIES)[number])}
            className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-lg text-white"
            aria-label="Destination currency"
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {/* Both of these change the answer materially, so they are visible
                controls rather than assumptions buried in the model. */}
            <button
              type="button"
              onClick={() => setChannel(channel === "online" ? "branch" : "online")}
              className="rounded-md bg-white/5 px-2 py-1 text-textSecondary"
            >
              {channel === "online" ? "Online banking" : "In branch"}
            </button>
            <button
              type="button"
              onClick={() => setMode(mode === "foreign" ? "aud" : "foreign")}
              className="rounded-md bg-white/5 px-2 py-1 text-textSecondary"
            >
              {mode === "foreign" ? `Send in ${toCurrency}` : "Send in AUD"}
            </button>
          </div>
        </label>
      </div>

      {/* --- comparison table -------------------------------------------- */}
      <div className="mt-8 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-textSecondary">
            <tr className="border-b border-white/10">
              <th className="py-3 pr-4">Provider</th>
              <th className="py-3 pr-4">Upfront fee</th>
              <th className="py-3 pr-4">
                Exchange-rate margin
                <span className="ml-1 font-normal normal-case opacity-70">(estimated)</span>
              </th>
              <th className="py-3 pr-4">Total cost</th>
              <th className="py-3 pr-4">Recipient gets</th>
              <th className="py-3">Speed</th>
            </tr>
          </thead>
          <tbody>
            {result.providers.map((p) => (
              <tr key={p.id} className="border-b border-white/5">
                <td className="py-3 pr-4 font-medium text-white">{p.displayName}</td>
                <td className="py-3 pr-4 text-textSecondary">
                  {p.upfrontFee === 0 ? (
                    // Stated plainly. Hiding a genuine $0 to make the
                    // comparison look better is the exact dishonesty this page
                    // is arguing against.
                    <span className="text-white/70">Free</span>
                  ) : (
                    aud(p.upfrontFee)
                  )}
                </td>
                <td className="py-3 pr-4 text-textSecondary">
                  {p.fxMarginBps === 0 ? "—" : `${(p.fxMarginBps / 100).toFixed(2)}%`}
                  {p.fxSpreadFee > 0 && (
                    <span className="ml-2 opacity-70">{aud(p.fxSpreadFee)}</span>
                  )}
                </td>
                <td className="py-3 pr-4 text-white">{aud(p.totalFees)}</td>
                <td className="py-3 pr-4 text-textSecondary">
                  {p.recipientGets.toLocaleString("en-AU", {
                    style: "currency",
                    currency: result.receiveCurrency,
                  })}
                </td>
                <td className="py-3 text-textSecondary">{p.transferTime}</td>
              </tr>
            ))}

            <tr className="bg-neon/5">
              <td className="py-3 pr-4 font-semibold text-neon">FurlPay</td>
              <td className="py-3 pr-4 text-white">{aud(result.furlpay.upfrontFee)}</td>
              <td className="py-3 pr-4 text-white">0.00%</td>
              <td className="py-3 pr-4 font-semibold text-white">
                {aud(result.furlpay.totalFees)}
              </td>
              <td className="py-3 pr-4 text-white">
                {result.furlpay.recipientGets.toLocaleString("en-AU", {
                  style: "currency",
                  currency: result.receiveCurrency,
                })}
              </td>
              <td className="py-3 text-white">{result.furlpay.transferTime}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {cba && result.furlpay.savingsVsCba !== null && result.furlpay.savingsVsCba > 0 && (
        <p className="mt-6 text-sm text-white">
          On {aud(amount)} to {result.receiveCurrency}, that is{" "}
          <strong className="text-neon">{aud(result.furlpay.savingsVsCba)}</strong> less
          than {cba.displayName}
          {channel === "online" ? " online" : " in branch"} — almost all of it the
          exchange-rate margin rather than a fee.
        </p>
      )}

      <div className="mt-4">
        <Link
          href={`/wallet?amount=${amount}&currency=${result.receiveCurrency}`}
          className="inline-block rounded-lg bg-neon px-5 py-2.5 text-sm font-semibold text-black"
        >
          Send with no FX markup
        </Link>
      </div>

      {/* --- methodology -------------------------------------------------- */}
      <section className="mt-12 rounded-xl border border-white/10 bg-white/[0.02] p-6">
        <h2 className="text-sm font-semibold text-white">How these numbers are worked out</h2>
        <p className="mt-2 text-xs leading-relaxed text-textSecondary">{ESTIMATE_DISCLOSURE}</p>
        <ul className="mt-4 space-y-2 text-xs text-textSecondary">
          {result.providers.map((p) => (
            <li key={p.id}>
              <span className="text-white/80">{p.displayName}</span> — {p.notes[0]}{" "}
              <a
                href={p.sourceUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="text-neon hover:underline"
              >
                source
              </a>{" "}
              <span className="opacity-60">(checked {p.asOf})</span>
            </li>
          ))}
          <li>
            Mid-market rates are indicative, as of {RATES_AS_OF}, and are not a quote.
            Live rates move continuously.
          </li>
        </ul>
      </section>
    </div>
  );
}
