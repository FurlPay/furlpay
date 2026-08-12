import { Check, Minus, X } from "lucide-react";
import Reveal from "./Reveal";

/*
 * Category comparison — not a vendor takedown.
 *
 * The columns are product CATEGORIES ("traditional financial APIs",
 * "crypto-only APIs"), never named competitors, because a named-vendor matrix
 * ages into a factual error the moment that vendor ships the row you marked
 * absent. "Partial" exists so the table can be honest where the category is
 * genuinely mixed, and the footnote says so out loud.
 */

type Level = "yes" | "partial" | "no";

const ROWS: { label: string; furlpay: Level; traditional: Level; crypto: Level }[] = [
  { label: "Stablecoin payments", furlpay: "yes", traditional: "partial", crypto: "yes" },
  { label: "Global accounts", furlpay: "yes", traditional: "yes", crypto: "no" },
  { label: "Cards", furlpay: "yes", traditional: "yes", crypto: "partial" },
  { label: "AI agent payments", furlpay: "yes", traditional: "no", crypto: "partial" },
  { label: "Crypto checkout", furlpay: "yes", traditional: "no", crypto: "yes" },
  { label: "Programmable payments", furlpay: "yes", traditional: "partial", crypto: "yes" },
  { label: "One API for all of it", furlpay: "yes", traditional: "no", crypto: "no" },
];

function Cell({
  level,
  strong,
  className = "",
}: {
  level: Level;
  strong?: boolean;
  className?: string;
}) {
  const label = level === "yes" ? "Yes" : level === "partial" ? "Partial" : "No";
  return (
    <td className={`px-4 py-3.5 text-center sm:px-6 ${className}`.trim()}>
      <span className="sr-only">{label}</span>
      {level === "yes" ? (
        <Check
          aria-hidden
          className={`mx-auto h-[18px] w-[18px] ${strong ? "text-neon" : "text-textSecondary"}`}
        />
      ) : level === "partial" ? (
        <Minus aria-hidden className="mx-auto h-[18px] w-[18px] text-amber-400/80" />
      ) : (
        <X aria-hidden className="mx-auto h-[18px] w-[18px] text-white/20" />
      )}
    </td>
  );
}

export default function WhySection() {
  return (
    <section className="section section-y" id="why" aria-labelledby="why-title">
      <Reveal>
        <p className="section-eyebrow">Why FurlPay</p>
        <h2 className="section-title mt-3 max-w-3xl" id="why-title">
          One API where you would otherwise need three.
        </h2>
        <p className="section-lede mt-4">
          Traditional financial APIs do accounts and cards. Crypto APIs do stablecoins. Building
          a product that needs both usually means integrating both, and then reconciling them.
        </p>
      </Reveal>

      <Reveal delay={60}>
        {/* The table scrolls inside its own container so the page body never does. */}
        <div className="mt-10 overflow-x-auto rounded-card border border-white/[0.08]">
          <table className="w-full min-w-[560px] border-collapse text-[14px]">
            <caption className="sr-only">
              Capability comparison between FurlPay, traditional financial APIs and crypto-only APIs
            </caption>
            <thead>
              <tr className="border-b border-white/[0.08]">
                <th className="px-4 py-4 text-left text-[13px] font-semibold text-textSecondary sm:px-6" scope="col">
                  Capability
                </th>
                <th className="bg-neon/[0.05] px-4 py-4 text-center text-[13px] font-bold text-neon sm:px-6" scope="col">
                  FurlPay
                </th>
                <th className="px-4 py-4 text-center text-[13px] font-semibold text-textSecondary sm:px-6" scope="col">
                  Traditional financial APIs
                </th>
                <th className="px-4 py-4 text-center text-[13px] font-semibold text-textSecondary sm:px-6" scope="col">
                  Crypto-only APIs
                </th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.label} className="border-b border-white/[0.05] last:border-0">
                  <th
                    className="px-4 py-3.5 text-left text-[14px] font-medium text-white sm:px-6"
                    scope="row"
                  >
                    {row.label}
                  </th>
                  <Cell className="bg-neon/[0.05]" level={row.furlpay} strong />
                  <Cell level={row.traditional} />
                  <Cell level={row.crypto} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Reveal>

      <p className="mt-4 max-w-3xl text-[12px] leading-relaxed text-textMuted">
        Compares product categories, not named vendors — individual products vary, and several are
        adding capabilities. “Partial” means the category is mixed rather than absent.
      </p>
    </section>
  );
}
