"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { SupportNavbar, TicketBreadcrumb } from "@/components/support/SupportChrome";
import { AIAssistant, ContactOptions } from "@/components/support/SupportSidebars";

// ---------------------------------------------------------------------------
// Create a support ticket.
//
// WHY THIS FILE DID NOT EXIST AND WHAT THAT BROKE. The navbar linked to
// /support/new, but the only route under /support was the dynamic [id]. Next.js
// therefore matched /support/new as a TICKET whose id is the literal string
// "new", the detail page fetched GET /api/support/tickets/new, that 404'd, and
// the user was shown "Could not load this ticket." The error message was
// correct about what happened and useless about why. Adding this static segment
// fixes it at the router: a static segment always wins over a dynamic sibling.
//
// WHAT THE BACKEND ACTUALLY STORES. POST /api/support/tickets accepts exactly
// category (a 6-value enum), subject (4-120), body (10-5000) and refs
// (correlationId, transactionId, txHash, bookingId, cardEventId). There is no
// priority, issueType, network or attachment field on SupportTicket.
//
// So: issue type and network are collected because they genuinely help a human
// triage, and are folded into the body text rather than posted as fields that
// would be dropped on the floor. Priority is NOT collected — a control that
// cannot affect anything is a promise to the user that nothing keeps, and
// "Urgent" is exactly the promise people would lean on.
// ---------------------------------------------------------------------------

/** Keys are TICKET_CATEGORIES verbatim; labels are for humans. */
const PRODUCTS = [
  { key: "stablecoins", label: "Wallet & Payments" },
  { key: "cards", label: "Virtual Cards" },
  { key: "travel", label: "Travel" },
  { key: "developers", label: "Developer / API" },
  { key: "kyc", label: "Account & Identity" },
  { key: "other", label: "Other" },
] as const;

const ISSUE_TYPES: Record<string, string[]> = {
  stablecoins: ["Deposit issue", "Withdrawal issue", "Payment failed", "Transaction pending", "Balance issue"],
  cards: ["Card activation", "Card payment", "Card declined", "Virtual card", "Card security"],
  travel: ["Hotel booking", "Flight booking", "Payment issue", "Refund", "Booking modification"],
  developers: ["API issue", "SDK issue", "Authentication", "Webhook", "x402", "Integration"],
  kyc: ["Verification pending", "Document rejected", "Tier upgrade", "Country restriction"],
  other: ["General question", "Feedback", "Something else"],
};

const NETWORKS = ["Ethereum", "Arbitrum", "Base", "Polygon", "Solana", "Other"];

/** Troubleshooting the assistant can actually answer, per issue. */
function suggestionsFor(product: string, issue: string): string[] {
  if (issue === "Transaction pending") {
    return ["What does pending mean?", "How many confirmations are needed?", "Which networks are supported?"];
  }
  if (product === "travel") return ["How do refunds work?", "Can I modify my booking?", "How do I book with crypto?"];
  if (product === "cards") return ["Why was my card declined?", "How do I get a virtual card?"];
  if (product === "developers") return ["How does x402 work?", "How do I authenticate API calls?"];
  return ["How do deposits and withdrawals work?", "What are the KYC tiers?"];
}

const FIELD =
  "w-full rounded-lg border border-white/[0.09] bg-white/[0.03] px-3.5 py-2.5 text-[13.5px] text-white placeholder:text-textSecondary transition-colors focus:border-neon/60 focus:outline-none";
const LABEL = "block text-[12.5px] font-medium text-white";

export default function NewTicketPage() {
  const router = useRouter();
  const [product, setProduct] = useState<string>("stablecoins");
  const [issue, setIssue] = useState<string>(ISSUE_TYPES.stablecoins[0]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [txHash, setTxHash] = useState("");
  const [network, setNetwork] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const issues = useMemo(() => ISSUE_TYPES[product] ?? ISSUE_TYPES.other, [product]);

  function validate(): boolean {
    const e: Record<string, string> = {};
    // Mirrors the server schema exactly, so the user is told here rather than
    // by a 400 after a round trip.
    if (subject.trim().length < 4) e.subject = "Give the ticket a subject of at least 4 characters.";
    else if (subject.trim().length > 120) e.subject = "Keep the subject under 120 characters.";
    if (body.trim().length < 10) e.body = "Please describe the issue — at least 10 characters.";
    else if (body.trim().length > 5000) e.body = "Please keep the description under 5000 characters.";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (submitting) return; // guards the double-submit
    setApiError(null);
    if (!validate()) return;

    setSubmitting(true);
    try {
      // Issue type and network are prepended to the body because the model has
      // no column for them. Losing them would make triage worse, and inventing
      // fields the API drops would be worse still.
      const preamble = [`Issue type: ${issue}`, network ? `Network: ${network}` : null]
        .filter(Boolean)
        .join("\n");

      const res = await fetch("/api/support/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: product,
          subject: subject.trim(),
          body: `${preamble}\n\n${body.trim()}`,
          refs: txHash.trim() ? { txHash: txHash.trim() } : {},
        }),
      });

      if (res.status === 401) {
        setApiError("Your session has expired. Sign in again and your draft will still be here.");
        return;
      }
      if (res.status === 429) {
        setApiError("You've created several tickets just now. Give it a minute and try again.");
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setApiError(data?.issues?.[0]?.message ?? "The ticket could not be created. Nothing was lost — try again.");
        return;
      }

      const data = await res.json();
      const id = data?.ticket?.id;
      if (!id) {
        setApiError("The ticket was created but we could not open it. Check your ticket list.");
        return;
      }
      router.push(`/support/${id}?created=1`);
    } catch {
      setApiError("We couldn't reach the support service. Nothing was lost — try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#080B0A] text-white">
      <SupportNavbar activeLabel="Tickets" />
      <TicketBreadcrumb
        items={[{ label: "Home", href: "/support" }, { label: "Tickets", href: "/support/tickets" }, { label: "New Ticket" }]}
      />

      <main className="mx-auto max-w-[1536px] px-6 pb-16 pt-2">
        <h1 className="text-[27px] font-bold tracking-tight text-white">Create a support ticket</h1>
        <p className="mt-1.5 text-[14px] text-[#C9CDCB]">
          Tell us what you need help with and our team will get back to you.
        </p>

        <div className="mt-6 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <form onSubmit={submit} noValidate className="rounded-2xl border border-white/[0.07] bg-[#101512] p-6">
            {apiError && (
              <p role="alert" className="mb-5 rounded-lg border border-white/15 bg-white/[0.05] px-4 py-3 text-[13px] text-white">
                {apiError}
              </p>
            )}

            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label htmlFor="product" className={LABEL}>Product / Service</label>
                <select
                  id="product"
                  value={product}
                  onChange={(e) => {
                    setProduct(e.target.value);
                    setIssue((ISSUE_TYPES[e.target.value] ?? ISSUE_TYPES.other)[0]);
                  }}
                  className={`${FIELD} mt-1.5`}
                >
                  {PRODUCTS.map((p) => (
                    <option key={p.key} value={p.key} className="bg-[#101512]">{p.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="issue" className={LABEL}>Issue type</label>
                <select id="issue" value={issue} onChange={(e) => setIssue(e.target.value)} className={`${FIELD} mt-1.5`}>
                  {issues.map((i) => (
                    <option key={i} value={i} className="bg-[#101512]">{i}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-5">
              <label htmlFor="subject" className={LABEL}>
                Subject <span className="text-neon">*</span>
              </label>
              <input
                id="subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                aria-invalid={Boolean(errors.subject)}
                aria-describedby={errors.subject ? "subject-err" : undefined}
                placeholder="Short summary of the issue"
                className={`${FIELD} mt-1.5 ${errors.subject ? "border-white/40" : ""}`}
              />
              {errors.subject && <p id="subject-err" className="mt-1.5 text-[12.5px] text-white/70">{errors.subject}</p>}
            </div>

            <div className="mt-5">
              <label htmlFor="body" className={LABEL}>
                Description <span className="text-neon">*</span>
              </label>
              <textarea
                id="body"
                rows={7}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                aria-invalid={Boolean(errors.body)}
                aria-describedby={errors.body ? "body-err" : undefined}
                placeholder="Describe the issue, what you expected to happen, and what happened instead."
                className={`${FIELD} mt-1.5 resize-y ${errors.body ? "border-white/40" : ""}`}
              />
              <div className="mt-1.5 flex items-center justify-between">
                {errors.body ? (
                  <p id="body-err" className="text-[12.5px] text-white/70">{errors.body}</p>
                ) : <span />}
                <span className="text-[11.5px] text-textSecondary">{body.trim().length}/5000</span>
              </div>
            </div>

            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <div>
                <label htmlFor="txhash" className={LABEL}>
                  Transaction hash / reference <span className="text-textSecondary">(optional)</span>
                </label>
                <input
                  id="txhash"
                  value={txHash}
                  onChange={(e) => setTxHash(e.target.value)}
                  placeholder="5xK…9d2f"
                  className={`${FIELD} mt-1.5 font-mono`}
                />
              </div>
              <div>
                <label htmlFor="network" className={LABEL}>
                  Network <span className="text-textSecondary">(optional)</span>
                </label>
                <select id="network" value={network} onChange={(e) => setNetwork(e.target.value)} className={`${FIELD} mt-1.5`}>
                  <option value="" className="bg-[#101512]">Not applicable</option>
                  {NETWORKS.map((n) => (
                    <option key={n} value={n} className="bg-[#101512]">{n}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-7 flex items-center justify-end gap-3 border-t border-white/[0.07] pt-5">
              <Link
                href="/support/tickets"
                className="rounded-lg border border-white/[0.09] px-4 py-2 text-[13.5px] text-white transition-colors hover:bg-white/[0.04]"
              >
                Cancel
              </Link>
              <button
                type="submit"
                disabled={submitting}
                className="rounded-lg bg-neon px-5 py-2 text-[13.5px] font-semibold text-black transition-colors hover:bg-neonDeep disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? "Creating…" : "Create ticket"}
              </button>
            </div>
          </form>

          <aside className="min-w-0">
            <p className="mb-3 rounded-xl border border-neon/25 bg-neon/[0.05] px-4 py-3 text-[13px] text-[#C9CDCB]">
              Before creating a ticket, the assistant can help you troubleshoot — it won&apos;t stop you
              submitting either way.
            </p>
            <AIAssistant
              ticketContext={`New ticket draft — product: ${PRODUCTS.find((p) => p.key === product)?.label}, issue: ${issue}`}
              suggestions={[...suggestionsFor(product, issue), "Talk to a human agent"]}
            />
            <ContactOptions />
          </aside>
        </div>
      </main>
    </div>
  );
}
