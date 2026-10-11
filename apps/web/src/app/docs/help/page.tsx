import Link from "next/link";
import { DocTitle, Lead, H2, P, DocPager } from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";
import { DOCS_NAV } from "@/lib/docs/nav";

export const metadata = docMeta("/docs/help");

// Index of the user-facing help center. The article list renders from the nav
// config so this page can never drift from the sidebar.
export default function HelpCenterPage() {
  const section = DOCS_NAV.find((s) => s.label === "Help Center");
  const articles = (section?.items ?? []).filter((i) => i.href !== "/docs/help");

  const groups: { title: string; hrefs: string[] }[] = [
    {
      title: "Onboarding & Security",
      hrefs: [
        "/docs/help/getting-started",
        "/docs/help/kyc-verification",
        "/docs/help/passkeys-biometrics",
        "/docs/help/privacy-gdpr",
      ],
    },
    {
      title: "Transactions & Stablecoins",
      hrefs: [
        "/docs/help/transaction-statuses",
        "/docs/help/gasless-transfers",
        "/docs/help/deposits-withdrawals",
      ],
    },
    {
      title: "Card availability",
      hrefs: [
        "/docs/help/managing-cards",
        "/docs/help/freeze-unfreeze",
        "/docs/help/declined-transactions",
      ],
    },
    {
      title: "Developers & x402",
      hrefs: ["/docs/help/sdk-integration", "/docs/help/x402-basics"],
    },
    {
      title: "Travel availability",
      hrefs: ["/docs/help/travel-booking", "/docs/help/travel-refunds"],
    },
  ];

  return (
    <article>
      <DocTitle eyebrow="Help Center">Help Center</DocTitle>
      <Lead>
        Self-service guidance for account security, payment status and product availability. Some
        older feature guides now explain that a service is still in development. Check the{" "}
        <Link href="/docs" className="text-neon">service availability overview</Link> before using
        any payment, card, banking or travel flow.
      </Lead>

      {groups.map((g) => (
        <section key={g.title}>
          <H2 id={g.title.toLowerCase().replace(/[^a-z]+/g, "-")}>{g.title}</H2>
          <div className="not-prose mt-4 grid gap-3 sm:grid-cols-2">
            {g.hrefs.map((href) => {
              const doc = articles.find((a) => a.href === href);
              if (!doc) return null;
              return (
                <Link
                  key={href}
                  href={href}
                  className="rounded-xl border border-white/8 p-4 transition-colors hover:border-neon/40"
                >
                  <p className="text-[14px] font-bold">{doc.title}</p>
                  <p className="mt-1 text-[13px] leading-relaxed text-textSecondary">{doc.desc}</p>
                </Link>
              );
            })}
          </div>
        </section>
      ))}

      <H2 id="still-stuck">Still stuck?</H2>
      <P>
        Open a ticket at <Link href="/support" className="text-neon">furlpay.com/support</Link>.
        Never include a recovery phrase, private key, one-time code or API secret. Support will
        never need those credentials.
      </P>

      <DocPager pathname="/docs/help" />
    </article>
  );
}
