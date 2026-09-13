import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import LandingChrome from "@/components/landing/LandingChrome";
import JsonLd from "@/components/JsonLd";
import { breadcrumb } from "@/lib/seo/schema";
import { seoMetadata } from "@/lib/seo/meta";
import CopyField from "@/components/token/CopyField";
import FurlChainState from "@/components/token/FurlChainState";
import FurlBalanceLookup from "@/components/token/FurlBalanceLookup";
import { furlPaymentsEnabled } from "@/lib/actions/solana";
import {
  FURL_MINT,
  FURL_SYMBOL,
  FURL_NAME,
  FURL_DECIMALS,
  FURL_TOTAL_SUPPLY,
  FURL_TOKEN_PROGRAM,
  FURL_METADATA_URI,
  FURL_IMAGE_URI,
  FURL_EXPLORER,
  FURL_EXPLORER_SOLANA,
  FURL_DEPLOYER,
  FURL_DEPLOYER_EXPLORER,
  FURL_ALLOCATIONS,
  FURL_LAUNCHED_AT,
  furlAllocationAmount,
} from "@/lib/token/furl";

// ---------------------------------------------------------------------------
// /token — the FURL reference page.
//
// THE RULE THIS PAGE IS WRITTEN UNDER: every claim is either a fact a reader can
// verify on-chain in one click, or it is labelled as not built yet. A token page
// is the single document people use to decide whether to hold the thing, and the
// genre is full of pages that imply a peg, a treasury and a listing that do not
// exist. So:
//
//   - Supply, decimals, authorities and concentration are READ FROM THE CHAIN
//     (FurlChainState) rather than typed here, and render "unavailable" when the
//     RPC cannot be reached instead of falling back to flattering constants.
//   - The allocation table is labelled a MODEL, because 100% of supply is in one
//     account today. The page says so, in its own section, with the address.
//   - There is no price, no market cap, no FDV, no holder count, no "partners",
//     no audit badge. None of those exist yet, and an empty chart with a
//     confident number under it is the oldest lie in the category.
//   - "Stablecoin" appears only as positioning, never as a live property: there
//     is no peg, no reserve and no redemption, and the page states that twice.
// ---------------------------------------------------------------------------

export const metadata: Metadata = {
  ...seoMetadata({
    title: "FURL Token",
    ogTitle: "FURL — the FurlPay payment token",
    description:
      "FURL is FurlPay's Solana payment token: Token-2022, 6 decimals, 1,000,000,000 fixed supply. Mint address, live on-chain state, allocation model, utility, and the risks — including that FURL has no peg, reserves, or redemption.",
    path: "/token",
  }),
};

/** Utility, split by what is ACTUALLY SHIPPED versus what is not. A reader
 *  deciding whether FURL is useful needs the line between the two to be the
 *  first thing they see, not a footnote under six feature cards. */
const UTILITY_LIVE: { title: string; body: string; href?: string }[] = [
  {
    title: "Solana Actions / Blinks checkout",
    body:
      "The pay endpoint builds a real Token-2022 transferChecked for FURL, creates the merchant's token account if it is missing, and applies the platform fee in the same token. Same code path as USDC and SOL — FURL is a parameter, not a fork.",
    href: "/docs/tokens/furl",
  },
  {
    title: "Balance reads across the app",
    body:
      "FURL balances are read from both token programs, so a Token-2022 holding is never reported as zero. An unreadable RPC renders as 'unavailable', never as an empty balance.",
  },
  {
    title: "Public verification surface",
    body:
      "This page plus /api/token/furl serve the mint, live authorities and concentration as JSON, so anyone — including an aggregator — can check FurlPay's claims without asking us.",
  },
];

const UTILITY_NOT_LIVE: { title: string; body: string }[] = [
  {
    title: "Fee discounts for paying in FURL",
    body:
      "Not implemented. It only makes sense once FURL has a market price to discount against, and pricing a discount off a token with no liquidity would be arbitrary.",
  },
  {
    title: "Rewards paid in FURL",
    body:
      "Not implemented. The rewards engine settles in supported assets today; FURL payouts wait on the treasury moving to a multisig, since rewards would be funded from it.",
  },
  {
    title: "Travel bookings priced in FURL",
    body:
      "Not implemented. Travel settles in USDC, which is reserve-backed by its issuer. Quoting a flight in an unpegged token would move price risk onto the traveller between booking and settlement.",
  },
  {
    title: "Exchange or DEX trading",
    body:
      "No liquidity pool exists. FURL is not listed anywhere, there is no market price, and no venue quotes it. Anyone telling you otherwise is not describing this token.",
  },
];

const RISKS: { title: string; body: string }[] = [
  {
    title: "No peg, no reserves, no redemption",
    body:
      "FURL is a fixed-supply token on Solana. Nothing backs it, nothing redeems it, and no mechanism defends a price. FurlPay does not promise to buy it back at any price.",
  },
  {
    title: "No market price",
    body:
      "With no liquidity pool, FURL has no price. Any figure you see quoted for it today is not derived from a market.",
  },
  {
    title: "Supply is concentrated in one key",
    body:
      "100% of FURL sits in a single token account controlled by one keypair. A compromise of that key is a total loss of the treasury, and nothing on-chain prevents that account from selling or moving everything.",
  },
  {
    title: "Mint authority has not been revoked",
    body:
      "More FURL can technically be minted until the authority is revoked. The 1B cap is published intent, not yet a runtime guarantee. The live panel above shows the current state.",
  },
  {
    title: "Not an investment, not a security offering",
    body:
      "FURL is a payment and ecosystem token. It is not offered as an investment, carries no profit expectation, no dividend, no governance right and no claim on FurlPay's revenue or assets.",
  },
  {
    title: "Regulatory exposure",
    body:
      "Token rules differ by jurisdiction and are changing. FURL is not a MiCA e-money token and is not registered with any financial regulator. Availability may change.",
  },
];

export default function TokenPage() {
  const paymentsEnabled = furlPaymentsEnabled();
  const rawSupply = (BigInt(FURL_TOTAL_SUPPLY) * 10n ** BigInt(FURL_DECIMALS)).toString();

  return (
    <div className="min-h-screen bg-oled">
      <LandingChrome />
      <JsonLd
        data={breadcrumb([
          { name: "Home", path: "/" },
          { name: "FURL token", path: "/token" },
        ])}
      />

      <main className="section pb-24 pt-14">
        {/* ---- Hero ---------------------------------------------------- */}
        <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="section-eyebrow">FURL token</p>
            <h1 className="section-title mt-3">
              The payment token behind <span className="text-neon">FurlPay</span>.
            </h1>
            <p className="section-lede mt-4">
              {FURL_SYMBOL} is a Token-2022 mint on Solana with {FURL_DECIMALS} decimals and a fixed{" "}
              {FURL_TOTAL_SUPPLY.toLocaleString("en-US")} supply, launched {FURL_LAUNCHED_AT}. This
              page is the reference: the address, what the chain says about it right now, where the
              supply sits, what it does, and what it does not do.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <a
                href={FURL_EXPLORER}
                target="_blank"
                rel="noreferrer"
                className="btn-green px-5 py-2.5 text-[14px]"
              >
                View on Solscan
              </a>
              <a
                href={FURL_METADATA_URI}
                target="_blank"
                rel="noreferrer"
                className="btn-outline px-5 py-2.5 text-[14px]"
              >
                Token metadata
              </a>
            </div>
          </div>

          <div className="surface w-full shrink-0 p-6 lg:max-w-[340px]">
            <div className="flex items-center gap-3">
              {/* The same icon the on-chain metadata points at, served from our
                  own origin for page performance. The Arweave original is
                  linked below so the two can be compared. */}
              <Image
                src="/furl/icon-256.png"
                alt="FURL token icon"
                width={48}
                height={48}
                className="rounded-full border border-white/10"
              />
              <div>
                <p className="text-[17px] font-bold leading-tight">{FURL_NAME}</p>
                <p className="font-mono text-[12px] text-textMuted">{FURL_SYMBOL}</p>
              </div>
            </div>
            <dl className="mt-5 space-y-2.5 text-[13px]">
              {[
                ["Chain", "Solana mainnet"],
                ["Standard", "Token-2022"],
                ["Decimals", String(FURL_DECIMALS)],
                ["Total supply", `${FURL_TOTAL_SUPPLY.toLocaleString("en-US")} FURL`],
                ["Raw supply", rawSupply],
                ["Launched", FURL_LAUNCHED_AT],
              ].map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-3">
                  <dt className="text-textSecondary">{k}</dt>
                  <dd className="min-w-0 break-all text-right font-mono text-[12px]">{v}</dd>
                </div>
              ))}
            </dl>
            <span
              className={`mt-5 inline-block rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${
                paymentsEnabled ? "bg-neon/15 text-neon" : "bg-white/[0.06] text-textSecondary"
              }`}
            >
              {paymentsEnabled ? "FURL checkout live" : "FURL checkout not enabled"}
            </span>
          </div>
        </div>

        {/* ---- Addresses ----------------------------------------------- */}
        <section className="mt-16">
          <h2 className="text-[26px] font-bold tracking-tighter">Addresses</h2>
          <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-textSecondary">
            Check the mint address character by character before sending anything. A token that
            copies this name, symbol and icon with a different mint is trivial to create, and a
            transfer to the wrong mint cannot be reversed.
          </p>
          <div className="mt-6 grid gap-5 lg:grid-cols-2">
            <div className="surface space-y-5 p-6">
              <CopyField label="FURL mint" value={FURL_MINT} hint="Token-2022 mint" />
              <CopyField
                label="Token program"
                value={FURL_TOKEN_PROGRAM}
                hint="Token-2022, not legacy SPL"
              />
              <p className="text-[12.5px] leading-relaxed text-textSecondary">
                FURL is a <span className="text-textPrimary">Token-2022</span> mint. Integrations
                that assume the legacy SPL Token program will derive the wrong associated token
                account and silently report a zero balance.
              </p>
            </div>
            <div className="surface space-y-5 p-6">
              <CopyField
                label="Current holding account owner"
                value={FURL_DEPLOYER}
                hint="Deployer wallet"
              />
              <div className="flex flex-wrap gap-2">
                {[
                  { label: "Solscan (token)", href: FURL_EXPLORER },
                  { label: "Solana Explorer", href: FURL_EXPLORER_SOLANA },
                  { label: "Deployer account", href: FURL_DEPLOYER_EXPLORER },
                  { label: "Metadata JSON (Arweave)", href: FURL_METADATA_URI },
                  { label: "Icon (Arweave)", href: FURL_IMAGE_URI },
                ].map((l) => (
                  <a
                    key={l.label}
                    href={l.href}
                    target="_blank"
                    rel="noreferrer"
                    className="tech-chip hover:border-neon/40 hover:text-neon"
                  >
                    {l.label}
                  </a>
                ))}
              </div>
              <p className="text-[12.5px] leading-relaxed text-textSecondary">
                Metadata and the icon are stored permanently on Arweave (via Irys), so FURL&apos;s
                identity resolves even if furlpay.com is gone. Arweave data cannot be edited — which
                is the point for a token people are asked to hold.
              </p>
            </div>
          </div>
        </section>

        {/* ---- Live chain state ---------------------------------------- */}
        <section className="mt-16">
          <h2 className="text-[26px] font-bold tracking-tighter">Live on-chain state</h2>
          <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-textSecondary">
            Read from Solana when this page loads, not written into it. If a node cannot be reached
            you will see &quot;unavailable&quot; rather than a number we remembered.
          </p>
          <div className="mt-6">
            <FurlChainState />
          </div>
        </section>

        {/* ---- Allocation model ---------------------------------------- */}
        <section className="mt-16">
          <h2 className="text-[26px] font-bold tracking-tighter">Allocation model</h2>
          <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-textSecondary">
            How the 1,000,000,000 FURL is intended to be divided. Read the next section before
            treating this as the current state: every allocation was minted to the{" "}
            <span className="text-textPrimary">same</span> account, so none of these buckets exists
            as a separate wallet yet.
          </p>
          <div className="mt-6 surface overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-[13.5px]">
                <thead>
                  <tr className="border-b border-white/[0.08] text-[11px] uppercase tracking-[0.12em] text-textMuted">
                    <th className="px-5 py-3 font-semibold">Allocation</th>
                    <th className="px-5 py-3 font-semibold">Share</th>
                    <th className="px-5 py-3 font-semibold">FURL</th>
                    <th className="px-5 py-3 font-semibold">Wallet today</th>
                  </tr>
                </thead>
                <tbody>
                  {FURL_ALLOCATIONS.map((a) => (
                    <tr key={a.key} className="border-b border-white/[0.05] last:border-0">
                      <td className="px-5 py-3.5">
                        <span className="font-semibold">{a.label}</span>
                        <span className="mt-1 block h-1 max-w-[200px] rounded-full bg-white/[0.08]">
                          <span
                            className="block h-1 rounded-full bg-neon"
                            style={{ width: `${a.percent}%` }}
                          />
                        </span>
                      </td>
                      <td className="px-5 py-3.5 font-mono">{a.percent}%</td>
                      <td className="px-5 py-3.5 font-mono">
                        {furlAllocationAmount(a.percent).toLocaleString("en-US")}
                      </td>
                      <td className="px-5 py-3.5 font-mono text-[12px] text-textSecondary">
                        deployer
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-white/[0.02]">
                    <td className="px-5 py-3.5 font-semibold">Total</td>
                    <td className="px-5 py-3.5 font-mono">100%</td>
                    <td className="px-5 py-3.5 font-mono">
                      {FURL_TOTAL_SUPPLY.toLocaleString("en-US")}
                    </td>
                    <td className="px-5 py-3.5" />
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* ---- Actual distribution state ------------------------------- */}
        <section className="mt-16">
          <h2 className="text-[26px] font-bold tracking-tighter">
            Where the supply actually is
          </h2>
          <div className="mt-6 rounded-card border border-accent/30 bg-accent/[0.05] p-6">
            <p className="text-[15px] font-bold text-accent">
              100% of FURL is held by one account, controlled by one key.
            </p>
            <div className="mt-4 space-y-3 text-[13.5px] leading-relaxed text-textSecondary">
              <p>
                All six allocations were minted to the same owner at launch, which means they landed
                in a single Token-2022 associated token account. There is no community wallet, no
                treasury multisig and no vesting contract yet — those are planned, not live.
              </p>
              <p>
                <span className="text-textPrimary">What that means for you:</span> nothing on-chain
                stops that account from moving or selling the entire supply, and a compromise of its
                key would be a total loss. Circulating supply outside the deployer is effectively
                zero.
              </p>
              <p>
                <span className="text-textPrimary">What we are doing about it:</span> the next step
                is separated multisig wallets (Squads) per allocation and a published migration, so
                the buckets above become verifiable addresses instead of a table. Until that ships,
                this warning stays on the page.
              </p>
            </div>
            <a
              href={FURL_DEPLOYER_EXPLORER}
              target="_blank"
              rel="noreferrer"
              className="btn-outline mt-5 inline-flex px-5 py-2.5 text-[13px]"
            >
              Verify the holding account
            </a>
          </div>
        </section>

        {/* ---- Utility ------------------------------------------------- */}
        <section className="mt-16">
          <h2 className="text-[26px] font-bold tracking-tighter">What FURL does today</h2>
          <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-textSecondary">
            Shipped in this repository and callable now.
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {UTILITY_LIVE.map((u) => (
              <div key={u.title} className="surface surface-lift p-6">
                <span className="rounded-full bg-neon/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-neon">
                  Live
                </span>
                <h3 className="mt-3 text-[16px] font-bold">{u.title}</h3>
                <p className="mt-2 text-[13.5px] leading-relaxed text-textSecondary">{u.body}</p>
                {u.href && (
                  <Link href={u.href} className="mt-3 inline-block text-[13px] text-neon">
                    Docs →
                  </Link>
                )}
              </div>
            ))}
          </div>

          <h3 className="mt-10 text-[18px] font-bold">Not built yet</h3>
          <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-textSecondary">
            Listed because a token page that only shows the roadmap reads as if the roadmap shipped.
          </p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {UTILITY_NOT_LIVE.map((u) => (
              <div key={u.title} className="surface p-6">
                <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-textSecondary">
                  Not live
                </span>
                <h4 className="mt-3 text-[15px] font-bold">{u.title}</h4>
                <p className="mt-2 text-[13.5px] leading-relaxed text-textSecondary">{u.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ---- Paying with FURL ---------------------------------------- */}
        <section className="mt-16">
          <h2 className="text-[26px] font-bold tracking-tighter">Paying with FURL</h2>
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <div className="surface p-6">
              <p className="text-[15px] font-bold">How a FURL payment is built</p>
              <ol className="mt-4 space-y-3 text-[13.5px] leading-relaxed text-textSecondary">
                <li>
                  <span className="font-mono text-[12px] text-neon">1.</span> The order is priced in
                  USD. FURL has no oracle, so the token amount is derived from an explicitly
                  configured FURL price — and if none is configured, FURL checkout is not offered at
                  all rather than guessing a rate.
                </li>
                <li>
                  <span className="font-mono text-[12px] text-neon">2.</span> The merchant&apos;s
                  Token-2022 account is created if missing (idempotent, payer funds the rent), so a
                  first payment to a fresh merchant does not fail.
                </li>
                <li>
                  <span className="font-mono text-[12px] text-neon">3.</span> Transfer goes out as{" "}
                  <span className="font-mono text-[12px]">transferChecked</span>, which makes the
                  runtime verify the mint and the {FURL_DECIMALS} decimals — a wrong-mint or
                  wrong-scale transfer fails on-chain instead of moving the wrong amount.
                </li>
                <li>
                  <span className="font-mono text-[12px] text-neon">4.</span> The platform fee, if
                  any, moves in the same token in the same transaction.
                </li>
              </ol>
            </div>
            <FurlBalanceLookup />
          </div>
          {!paymentsEnabled && (
            <p className="mt-4 rounded-lg border border-white/10 bg-white/[0.02] p-4 text-[13px] leading-relaxed text-textSecondary">
              FURL checkout is currently <span className="text-textPrimary">disabled</span> on this
              deployment because no FURL price is configured. SOL and USDC checkout are unaffected.
              This is deliberate: offering a FURL price we invented would be the misleading part, not
              the missing option.
            </p>
          )}
        </section>

        {/* ---- What FURL is not --------------------------------------- */}
        <section className="mt-16">
          <h2 className="text-[26px] font-bold tracking-tighter">What FURL is not</h2>
          <div className="mt-6 rounded-card border border-white/10 bg-white/[0.02] p-6">
            <p className="text-[14px] leading-relaxed text-textSecondary">
              FurlPay describes FURL as its ecosystem payment currency,{" "}
              <span className="text-textPrimary">intended</span> to operate as a stablecoin. That is
              positioning, not a property of the token. Concretely, as of today:
            </p>
            <ul className="mt-4 space-y-2 text-[13.5px] leading-relaxed text-textSecondary">
              {[
                "FURL is NOT pegged to the US dollar or to anything else.",
                "FURL is NOT backed by reserves. No cash, treasuries or collateral stand behind it.",
                "FURL is NOT redeemable. FurlPay will not exchange it for $1, or for any amount.",
                "FURL is NOT a guaranteed, risk-free or yield-bearing instrument.",
                "FURL is NOT audited by a third party, and no attestation exists.",
                "FURL is NOT listed on any exchange, and has no market price.",
              ].map((line) => (
                <li key={line} className="flex gap-2">
                  <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-[13.5px] leading-relaxed text-textSecondary">
              A dollar-denominated stablecoin is <span className="text-textPrimary">more</span>{" "}
              regulated than a utility token, not less: it needs reserves, redemption, attestations
              and, in the EU, e-money-token authorisation under MiCA. FurlPay settles payments in{" "}
              <span className="text-textPrimary">USDC</span> precisely because USDC has that
              infrastructure and FURL does not.
            </p>
          </div>
        </section>

        {/* ---- Risks --------------------------------------------------- */}
        <section className="mt-16">
          <h2 className="text-[26px] font-bold tracking-tighter">Risk disclosure</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {RISKS.map((r) => (
              <div key={r.title} className="surface p-6">
                <h3 className="text-[15px] font-bold">{r.title}</h3>
                <p className="mt-2 text-[13.5px] leading-relaxed text-textSecondary">{r.body}</p>
              </div>
            ))}
          </div>
          <p className="mt-6 max-w-3xl text-[13px] leading-relaxed text-textMuted">
            Nothing on this page is financial, investment, tax or legal advice, and nothing here is
            an offer to sell or a solicitation to buy any asset. Digital assets can lose all of their
            value. Do your own research and only interact with the mint address published above.
          </p>
        </section>

        {/* ---- Machine-readable -------------------------------------- */}
        <section className="mt-16">
          <h2 className="text-[26px] font-bold tracking-tighter">For integrators</h2>
          <div className="mt-6 surface p-6">
            <p className="text-[13.5px] leading-relaxed text-textSecondary">
              Everything on this page is available as JSON, including the live authority state and
              the disclosures, so a wallet or aggregator never has to scrape the HTML.
            </p>
            <div className="mt-4 space-y-2">
              <code className="block select-all break-all rounded-lg border border-white/10 bg-black/40 px-3 py-2.5 font-mono text-[12.5px]">
                GET /api/token/furl
              </code>
              <code className="block select-all break-all rounded-lg border border-white/10 bg-black/40 px-3 py-2.5 font-mono text-[12.5px]">
                GET /api/token/furl/balance?owner=&lt;solana address&gt;
              </code>
            </div>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link href="/docs/tokens/furl" className="btn-green px-5 py-2.5 text-[14px]">
                FURL integration docs
              </Link>
              <Link href="/trust" className="btn-outline px-5 py-2.5 text-[14px]">
                Trust &amp; security
              </Link>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
