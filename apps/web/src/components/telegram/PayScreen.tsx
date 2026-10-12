"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, ArrowLeft, Send, Globe2, CreditCard, ShieldCheck, ExternalLink, Clock3, ScanLine } from "lucide-react";
import Select, { type SelectClasses } from "@/components/form/Select";
import { useMiniApp } from "./TelegramProvider";
import { addressFromQr, checkoutPath, TransferDraftSchema, type TransferDraft } from "@/lib/telegram-mini-app/contracts";
import { PAYMENT_LINKS_AVAILABLE } from "@/lib/telegram-mini-app/config";
import { PageHeading, DetailSheet } from "./shared";

const NETWORKS = [
  { value: "arbitrum", label: "Arbitrum One" },
  { value: "base", label: "Base" },
  { value: "ethereum", label: "Ethereum" },
];

// The shared Select in the mini app's blue palette. Its list is portalled out
// of .fp-mini, so it is styled with utilities rather than the scoped CSS.
const MINI_SELECT: SelectClasses = {
  trigger:
    "flex min-h-[50px] w-full items-center gap-2 rounded-[11px] border border-[#334661] bg-[#0c121d] px-[13px] text-left text-base text-white transition-colors hover:border-[#4a6286] focus-visible:border-[#2689fc] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2689fc]/30 aria-expanded:border-[#2689fc]",
  value: "min-w-0 flex-1 truncate",
  placeholder: "text-[#8d9cb3]",
  chevron: "h-4 w-4 shrink-0 text-[#8d9cb3] transition-transform duration-150 data-[open=true]:rotate-180",
  icon: "inline-flex shrink-0 text-[#65adff]",
  list: "z-[70] overflow-y-auto rounded-xl border border-[#2a3d5c] bg-[#0f1622] p-1 text-[15px] text-white shadow-[0_18px_44px_rgba(0,0,0,0.6)] transition-opacity duration-100 data-[open=false]:pointer-events-none data-[open=false]:opacity-0",
  option:
    "flex min-h-[44px] cursor-pointer select-none items-center justify-between gap-3 rounded-lg px-3 py-2 text-[#cfdaed] transition-colors data-[active=true]:bg-[#16243a] data-[active=true]:text-white aria-selected:bg-[#133761] aria-selected:font-semibold aria-selected:text-white [&>svg]:text-[#65adff]",
};

export default function PayScreen() {
  const { app, haptic } = useMiniApp();
  const [method, setMethod] = useState<"send" | "online">("send");
  const [draft, setDraft] = useState<TransferDraft>({ amount: "", destination: "", chain: "arbitrum" });
  const [review, setReview] = useState<TransferDraft | null>(null);
  const [paymentLink, setPaymentLink] = useState("");
  const [checkout, setCheckout] = useState<string | null>(null);
  const [error, setError] = useState("");

  const reviewTransfer = useCallback(() => {
    const parsed = TransferDraftSchema.safeParse(draft);
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    setError("");
    setReview(Object.freeze({ ...parsed.data }));
    haptic();
  }, [draft, haptic]);

  // Telegram's own camera scanner (Bot API 6.4+), offered only where it
  // exists. It fills in the recipient and nothing else: the address is then
  // validated and reviewed exactly like a typed one.
  const canScan = Boolean(app?.showScanQrPopup && app.isVersionAtLeast("6.4"));
  const scanRecipient = useCallback(() => {
    if (!app?.showScanQrPopup) return;
    app.showScanQrPopup({ text: "Scan the recipient's wallet QR code" }, (text) => {
      const address = addressFromQr(text);
      if (address) {
        setDraft((d) => ({ ...d, destination: address }));
        setError("");
        haptic();
      } else {
        setError("That QR code is not an EVM wallet address.");
      }
      return true;
    });
  }, [app, haptic]);

  // Telegram's native MainButton mirrors "Review transfer" while the form is
  // showing. It only opens the review — it never signs or submits anything.
  useEffect(() => {
    if (!app || method !== "send" || review) return;
    app.MainButton.setParams({ text: "Review transfer", color: "#147bff", text_color: "#ffffff", is_active: true, is_visible: true });
    app.MainButton.onClick(reviewTransfer);
    app.MainButton.show();
    return () => { app.MainButton.offClick(reviewTransfer); app.MainButton.hide(); };
  }, [app, method, review, reviewTransfer]);

  return (
    <div className="mini-screen">
      <PageHeading eyebrow="FurlPay Pay" title="Make your next move." description="Choose how you’d like to pay." />
      <div className="mini-payment-methods">
        <button aria-pressed={method === "send"} onClick={() => { setMethod("send"); setError(""); }}>
          <Send /><strong>Send assets</strong><small>Review a transfer</small>
        </button>
        <button aria-pressed={method === "online"} onClick={() => { setMethod("online"); setError(""); }}>
          <Globe2 /><strong>Pay online</strong><small>{PAYMENT_LINKS_AVAILABLE ? "Open a payment link" : "Coming soon"}</small>
        </button>
        <Link href="/telegram/cards">
          <CreditCard /><strong>FurlPay Card</strong><small>Explore card availability</small>
        </Link>
      </div>

      {method === "send" ? (
        <section className="mini-panel mini-payment-form">
          <div className="mini-between"><h2>{review ? "Review transfer" : "Send USDC"}</h2><span className="mini-status">Preview</span></div>
          {!review ? (
            <form onSubmit={(e) => { e.preventDefault(); reviewTransfer(); }} noValidate>
              <p className="mini-subtle">Prepare and review the details. Transfers from the mini app are not yet enabled.</p>
              <div className="mini-field">
                <span id="mini-network-label">Network</span>
                <Select labelId="mini-network-label" value={draft.chain} options={NETWORKS} classes={MINI_SELECT}
                  onValueChange={(v) => setDraft({ ...draft, chain: v as TransferDraft["chain"] })} />
              </div>
              <label>Recipient wallet
                <input autoComplete="off" spellCheck={false} placeholder="0x…" value={draft.destination} onChange={(e) => setDraft({ ...draft, destination: e.target.value })} />
              </label>
              {canScan && (
                <button type="button" className="mini-text-link" onClick={scanRecipient}>
                  <ScanLine size={16} /> Scan a wallet QR code
                </button>
              )}
              <label>Amount
                <div className="mini-amount-input">
                  <input inputMode="decimal" autoComplete="off" placeholder="0.00" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} />
                  <span>USDC</span>
                </div>
              </label>
              {error && <p role="alert" className="mini-error">{error}</p>}
              <button className="mini-primary" type="submit">Review transfer <ArrowRight size={18} /></button>
              <p className="mini-note"><ShieldCheck size={14} /> No funds move when you review.</p>
            </form>
          ) : (
            <>
              <dl className="mini-detail-list">
                <div><dt>Recipient</dt><dd>{review.destination}</dd></div>
                <div><dt>Amount</dt><dd>{review.amount} USDC</dd></div>
                <div><dt>Network</dt><dd>{NETWORKS.find((n) => n.value === review.chain)?.label ?? review.chain}</dd></div>
                <div><dt>Network fee</dt><dd>Quote unavailable</dd></div>
                <div><dt>Total</dt><dd>Awaiting a live quote</dd></div>
              </dl>
              <div className="mini-notice"><ShieldCheck size={21} /><span>Transfers are not enabled on this deployment. No payment has been submitted. A live quote, wallet authorization, and final confirmation are required before funds can move.</span></div>
              <button className="mini-primary" disabled>Transfer unavailable</button>
              <button className="mini-text-link" onClick={() => setReview(null)}><ArrowLeft size={16} /> Edit transfer</button>
            </>
          )}
        </section>
      ) : PAYMENT_LINKS_AVAILABLE ? (
        <section className="mini-panel mini-payment-form">
          <h2>Have a FurlPay payment link?</h2>
          <p className="mini-subtle">Review the merchant, amount, network, and payment conditions in secure checkout before authorizing anything.</p>
          <form onSubmit={(e) => {
            e.preventDefault();
            const path = checkoutPath(paymentLink.trim());
            if (!path) { setError("Enter a valid furlpay.com/p/ payment link."); return; }
            setError("");
            setCheckout(path);
          }}>
            <label>Payment link<input type="text" inputMode="url" autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="https://furlpay.com/p/…" value={paymentLink} onChange={(e) => setPaymentLink(e.target.value)} /></label>
            {error && <p className="mini-error" role="alert">{error}</p>}
            <button className="mini-primary" type="submit">Review payment link <ArrowRight size={18} /></button>
          </form>
        </section>
      ) : (
        <section className="mini-panel mini-payment-form">
          <h2>Pay with a FurlPay link</h2>
          <div className="mini-unavailable" role="status">
            <Clock3 size={18} />
            <span>Merchant payment links aren’t available yet. When they launch, you’ll review the merchant, amount and network in secure checkout before anything is authorized.</span>
          </div>
        </section>
      )}

      <Link href="/telegram/activity" className="mini-text-link">View payment activity <ArrowRight size={16} /></Link>
      {checkout && (
        <DetailSheet title="Continue to secure checkout" close={() => setCheckout(null)}>
          <p>You’re opening a payment request on furlpay.com. Confirm that you recognize the merchant and verify the amount on the next screen.</p>
          <p className="mini-address">https://furlpay.com{checkout}</p>
          <div className="mini-notice">Opening a link does not authorize or complete a payment.</div>
          <Link className="mini-primary" href={checkout}>Continue to checkout <ExternalLink size={17} /></Link>
        </DetailSheet>
      )}
    </div>
  );
}
