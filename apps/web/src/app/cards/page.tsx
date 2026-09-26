"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getJSON, sendJSON } from "@/lib/api";
import { PaymentCard, Transaction } from "@/lib/types";
import { PageHeader, Pill, Spinner, usd } from "@/components/ui";
import { EyeIcon, GearIcon, PlusIcon, SlidersIcon, SnowflakeIcon, LockIcon, CloseIcon } from "@/components/icons";
import Realistic3DCard from "@/components/Realistic3DCard";
import { authenticateFingerprint, isFingerprintAvailable } from "@/lib/passkey";
import TransactionList from "@/components/TransactionList";
import Modal from "@/components/Modal";

export default function CardsPage() {
  const [cards, setCards] = useState<PaymentCard[]>([]);
  // Distinguishes "not fetched yet" from "fetched, and you have none".
  //
  // `cards` starts as `[]`, so the old `if (!cards.length) return <Spinner />`
  // was true in BOTH states: a customer with no cards — which is every new
  // account, since emptyAccount() seeds `cards: []` — sat on a spinner forever,
  // with no card, no empty state and no way to issue one. Found by rendering the
  // page, not by a passing assertion.
  const [cardsLoaded, setCardsLoaded] = useState(false);
  const [active, setActive] = useState(0);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [modal, setModal] = useState<null | "view" | "limits" | "settings" | "escrow" | "issue">(null);
  const trackRef = useRef<HTMLDivElement>(null);

  // Device-wallet provisioning state. Kept at page level because the button
  // lives outside the modals.
  const [provisioning, setProvisioning] = useState(false);
  const [provisionError, setProvisionError] = useState<string | null>(null);

  // Promo dismissal persists per browser. Read lazily inside an effect rather
  // than in the initial state: this component also renders on the server, where
  // `localStorage` does not exist, and touching it during render would throw
  // (and, in some browsers with site data blocked, throws even on the client).
  const [promoDismissed, setPromoDismissed] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(PROMO_DISMISSED_KEY) === "1") setPromoDismissed(true);
    } catch {
      // Storage unavailable — show the banner. A dismissal we cannot remember
      // is a smaller failure than a crash on load.
    }
  }, []);

  const dismissPromo = useCallback(() => {
    setPromoDismissed(true);
    try {
      localStorage.setItem(PROMO_DISMISSED_KEY, "1");
    } catch {
      // Dismissed for this session only.
    }
  }, []);

  const loadCards = useCallback(async () => {
    try {
      const r = await getJSON<{ cards: PaymentCard[] }>("/api/cards");
      setCards(r.cards);
    } finally {
      // `finally`, so a failed fetch also leaves the spinner. Without it a
      // network error is indistinguishable from a slow one and the page hangs
      // on a spinner that will never resolve.
      setCardsLoaded(true);
    }
  }, []);

  useEffect(() => { loadCards(); }, [loadCards]);

  const card = cards[active];

  /**
   * Prove presence before the card flips to its reverse face.
   *
   * Uses the PASSKEY ceremony, not `/api/wallets/biometric-pay/*`. That endpoint
   * mints a proof bound to H(amount|asset|recipient|chain|nonce) for one specific
   * payment; driving it from a card view would mean inventing a payment intent
   * for something that is not a payment, prompting the user about a transfer they
   * are not making, and putting a card id in the recipient field. Viewing a card
   * is sensitive-data ACCESS, a different question from authorising a transfer.
   *
   * `authenticateFingerprint()` runs the WebAuthn assertion and the server
   * records a step-up against this session's jti (lib/stepup.ts), so the
   * re-authentication is server-observed rather than a client boolean.
   *
   * Returning false on ANY failure — refused, unsupported, or thrown — keeps the
   * card closed. A reveal must fail closed.
   */
  const requestCardStepUp = useCallback(async (): Promise<boolean> => {
    try {
      if (!(await isFingerprintAvailable())) return false;

      // BOUNDED. `navigator.credentials.get()` is not guaranteed to settle: if
      // the platform reports an authenticator but no prompt ever appears — the
      // exact behaviour observed in headless Chromium, and reachable on real
      // devices with a wedged biometric service — the promise hangs forever and
      // the card sits in "confirming your identity" with no way out.
      //
      // A timeout that resolves FALSE, never true: a ceremony that did not
      // finish has not proven anything, so the card stays closed. 60s is long
      // enough for a real person to find their finger and short enough that the
      // UI is never permanently stuck.
      let timer: ReturnType<typeof setTimeout> | undefined;
      let abandoned = false;

      // The ceremony is given its own rejection handler BEFORE the race. Once the
      // timeout wins, nothing is awaiting this promise any more — and a WebAuthn
      // call that rejects later (the user finally dismissing a stuck prompt) would
      // otherwise surface as an unhandled rejection, which Next.js reports as an
      // error overlay in dev and logs as a crash in production.
      //
      // It resolves FALSE rather than propagating: a ceremony whose result
      // arrives after we stopped waiting has not authorised anything.
      //
      // ABANDONMENT IS EXPLICIT, and this is the part that matters beyond the UI.
      // authenticateFingerprint() is not a local check — it POSTs the assertion to
      // /api/auth/passkey/authenticate, which calls recordStepUp(). So a ceremony
      // that completes after the timeout still grants a SERVER-SIDE step-up,
      // silently satisfying the wallet-link and account gates seconds after the
      // user was told their reveal had failed. The client cannot un-ring that
      // bell, but it can refuse to treat the result as its own answer and say
      // plainly that a stale approval happened.
      const ceremony = authenticateFingerprint()
        .then((ok) => {
          if (abandoned && ok && process.env.NODE_ENV !== "production") {
            // eslint-disable-next-line no-console
            console.warn(
              "Card reveal: passkey assertion completed after the 60s bound. " +
                "The card stays closed, but the server recorded a step-up for this session."
            );
          }
          return ok;
        })
        .catch(() => false);

      try {
        return await Promise.race([
          ceremony,
          new Promise<boolean>((resolve) => {
            timer = setTimeout(() => {
              abandoned = true;
              resolve(false);
            }, 60_000);
          }),
        ]);
      } finally {
        // Cleared on BOTH paths. Without this every successful reveal left a
        // 60-second timer pinned for no reason.
        if (timer) clearTimeout(timer);
      }
    } catch {
      return false;
    }
  }, []);

  const loadTxs = useCallback(async (cardId: string) => {
    const r = await getJSON<{ transactions: Transaction[] }>(`/api/transactions?cardId=${cardId}`);
    setTxs(r.transactions);
  }, []);

  useEffect(() => { if (card) loadTxs(card.id); }, [card, loadTxs]);

  function onScroll() {
    const el = trackRef.current;
    if (!el) return;
    const idx = Math.round(el.scrollLeft / el.clientWidth);
    if (idx !== active) setActive(idx);
  }

  /** Ask the issuer for a device-wallet provisioning payload. */
  const provision = useCallback(async (cardId: string) => {
    setProvisioning(true);
    setProvisionError(null);
    try {
      const res = await fetch(`/api/cards/lifecycle/${cardId}/provisioning`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: "apple" }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        detail?: string;
        deepLink?: string;
      };
      if (!res.ok) {
        setProvisionError(
          json.detail ?? json.message ?? json.error ?? `Provisioning unavailable (${res.status}).`,
        );
        return;
      }
      // A real issuer returns a push-provisioning payload the OS wallet
      // consumes. Until one is contracted there is nothing to hand off, so we
      // say so rather than pretending the card was added.
      if (json.deepLink) {
        window.location.href = json.deepLink;
        return;
      }
      setProvisionError(
        "The issuer returned no provisioning payload, so nothing was added to your device wallet.",
      );
    } catch (e) {
      setProvisionError(e instanceof Error ? e.message : "Network request failed");
    } finally {
      setProvisioning(false);
    }
  }, []);

  async function patchCard(patch: Partial<PaymentCard> & { id: string }) {
    // Canonical Marqeta-style controls endpoint (id→cardId, frozen→freeze).
    const { id, frozen, ...rest } = patch;
    const body: Record<string, unknown> = { cardId: id, ...rest };
    if (typeof frozen === "boolean") body.freeze = frozen;
    const r = await sendJSON<{ card: PaymentCard }>("/api/cards/settings", body);
    setCards((cs) => cs.map((c) => (c.id === r.card.id ? r.card : c)));
  }

  // Loading and empty are DIFFERENT states and must look different.
  if (!cardsLoaded) return <Spinner />;

  if (!cards.length) {
    return (
      <div className="px-5 py-10 text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-accent/40 text-accent">
          <PlusIcon />
        </span>
        <h2 className="mt-4 text-lg font-semibold text-white">No cards yet</h2>
        {/* Deliberately NOT "Issue a virtual card …". The claims linter caught
            that wording, and it was right: card issuance is not live in
            production, so promising it here would advertise a capability the
            user cannot actually get. The copy describes what a card would do and
            says plainly that it is not available yet. */}
        <p className="mx-auto mt-1.5 max-w-[340px] text-sm text-textSecondary">
          Cards let you spend your stablecoin balance online. Card ordering is not
          available yet — see what&apos;s planned.
        </p>
        <button
          type="button"
          onClick={() => setModal("issue")}
          className="mt-5 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
        >
          See card options
        </button>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Cards"
        right={
          <div className="flex items-center gap-2">
            <a
              href="/cards/approve"
              className="flex h-10 items-center rounded-full bg-white/[0.08] px-4 text-sm text-white/80"
            >
              Approvals
            </a>
            <button
              onClick={() => setModal("issue")}
              aria-label="Order a new card"
              className="tap flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.08]"
            >
              <PlusIcon className="h-5 w-5" />
            </button>
          </div>
        }
      />

      {/* Swipable carousel */}
      <div
        ref={trackRef}
        onScroll={onScroll}
        // max-w caps the TRACK, so each w-full slide and the card inside it end
        // at the same edge. Capping the card alone (max-w on the component) left
        // the slide wider than its contents and the next card peeked in and was
        // clipped mid-slide — visible in the browser at 1440x900.
        // NO px-5 here. Horizontal padding on the track shrinks the content box
        // that each basis-full slide resolves against (440px track - 40px = 400px
        // slides), which is exactly what left the next card peeking past the
        // edge. The gutter moves onto the slides instead, so a slide is a full
        // viewport wide and snap-center lands one card per page.
        className="no-scrollbar mx-auto flex max-w-[460px] snap-x snap-mandatory overflow-x-auto scroll-smooth"
      >
        {cards.map((c) => (
          // basis-full, not w-full: inside a flex row `w-full` resolves against
          // the track's CONTENT box (440px track − px-5 padding = 400px), so each
          // slide came out narrower than the scroll viewport and the next card
          // peeked in and sat clipped at the edge. Measured in the browser, not
          // guessed. basis-full makes a slide exactly one viewport wide, so
          // snap-center lands one card per page.
          <div key={c.id} className="shrink-0 basis-full snap-center px-5">
            {/* Realistic3DCard replaces the flat VisaCard: ISO 1.586:1 geometry,
                pointer-tracked tilt, and a 3D flip to the reverse face.

                NO CREDENTIAL PROPS ARE PASSED. cvv/fullPan/expiry stay undefined,
                so the flip shows a masked reverse — which is the honest state
                while no issuer is contracted. The real numbers come from
                `/api/cards/lifecycle/:id/reveal`, which mints a single-use grant
                the client exchanges directly with the issuer's PCI vault; FurlPay
                never holds the PAN, so there is nothing here to hand the
                component. ViewModal below owns that flow and reports 503 as
                "unavailable" rather than inventing a number. */}
            <Realistic3DCard card={c} onRevealRequest={requestCardStepUp} />
          </div>
        ))}
      </div>

      {/* Dots */}
      <div className="mt-3 flex justify-center gap-1.5">
        {cards.map((_, i) => (
          <span key={i} className={`h-1.5 rounded-full transition-all ${i === active ? "w-5 bg-accent" : "w-1.5 bg-white/25"}`} />
        ))}
      </div>

      {/* Circular action buttons */}
      <div className="mt-5 flex justify-around px-5">
        <CircleAction label="View" onClick={() => setModal("view")}><EyeIcon /></CircleAction>
        <CircleAction
          label={card.frozen ? "Unfreeze" : "Freeze"}
          active={card.frozen}
          onClick={() => patchCard({ id: card.id, frozen: !card.frozen })}
        >
          <SnowflakeIcon />
        </CircleAction>
        <CircleAction label="Limits" onClick={() => setModal("limits")}><SlidersIcon /></CircleAction>
        <CircleAction label="Settings" onClick={() => setModal("settings")}><GearIcon /></CircleAction>
      </div>

      {/* Push provisioning. Calls the real endpoint; when no issuer is
          contracted it answers 503 and that is what the user is told, rather
          than a spinner that resolves into nothing. */}
      <div className="mt-6 px-5">
        <button
          onClick={() => provision(card.id)}
          disabled={provisioning}
          className="tap flex w-full items-center justify-center gap-2 rounded-pill border border-surfaceMuted bg-surface py-3.5 font-medium disabled:opacity-50"
        >
          {provisioning ? "Preparing…" : " Add to Apple / Google Wallet"}
        </button>
        {provisionError && (
          <p className="mt-2 rounded-xl border border-white/10 bg-loss/[0.08] px-3 py-2 text-[12.5px] leading-relaxed text-loss">
            {provisionError}
          </p>
        )}
      </div>

      {/* Tier promo banner — dismissible, and the dismissal sticks. A close
          button that does nothing trains people to ignore the control. */}
      {!promoDismissed && (
        <div className="mt-4 px-5">
          <div className="flex items-center justify-between rounded-xl p-4"
            style={{ background: "linear-gradient(135deg,#1C0F35 0%,#0F0922 100%)" }}>
            <div className="flex items-center gap-3">
              <span className="rounded-md bg-white px-2 py-0.5 text-[11px] font-bold text-black">PRO</span>
              <p className="text-[13px] font-medium">3% cashback with Apple Pay & Google Pay</p>
            </div>
            <button
              onClick={dismissPromo}
              aria-label="Dismiss"
              className="tap text-textSecondary"
            >
              <CloseIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Daily limit usage + escrow trigger */}
      <div className="mt-6 grid grid-cols-2 gap-3 px-5">
        <div className="surface-card p-4">
          <p className="text-[12px] text-textSecondary">Daily spent</p>
          <p className="mt-1 font-bold">{usd(card.limits.dailySpent)} <span className="text-textSecondary">/ {usd(card.limits.daily)}</span></p>
          <div className="mt-2 h-1.5 rounded-full bg-white/10">
            <div className="h-1.5 rounded-full bg-accent" style={{ width: `${Math.min(100, (card.limits.dailySpent / card.limits.daily) * 100)}%` }} />
          </div>
        </div>
        <button onClick={() => setModal("escrow")} className="surface-card p-4 text-left">
          <p className="text-[12px] text-textSecondary">Pre-auth holds</p>
          <p className="mt-1 font-bold text-accent">Escrow center →</p>
          <p className="mt-2 text-[11px] text-textMuted">Hotel & rental holds</p>
        </button>
      </div>

      {/* Card transactions */}
      <section className="mt-8">
        <h2 className="mb-2 px-5 text-lg font-bold">Transactions</h2>
        <TransactionList items={txs} />
      </section>

      {modal === "view" && <ViewModal card={card} onClose={() => setModal(null)} />}
      {modal === "limits" && <LimitsModal card={card} onSave={patchCard} onClose={() => setModal(null)} />}
      {modal === "settings" && <SettingsModal card={card} onSave={patchCard} onClose={() => setModal(null)} />}
      {modal === "escrow" && <EscrowModal cardId={card.id} onClose={() => setModal(null)} onDone={() => loadTxs(card.id)} />}
      {modal === "issue" && <IssueCardModal onClose={() => setModal(null)} onOrdered={loadCards} />}
    </>
  );
}

/** Per-browser key for the dismissed tier promo. */
const PROMO_DISMISSED_KEY = "furlpay.cards.promoDismissed";

function CircleAction({ label, children, onClick, active }: { label: string; children: React.ReactNode; onClick: () => void; active?: boolean }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-2">
      <span className={`flex h-14 w-14 items-center justify-center rounded-full ${active ? "bg-accent text-white" : "bg-white/[0.08] text-white"}`}>
        {children}
      </span>
      <span className="action-label">{label}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Card details.
//
// WHAT THIS USED TO DO: a 700ms setTimeout, then it rendered
// `4111 5522 8834 {last4}`, expiry `09 / 29`, CVV `284` — a hardcoded test PAN
// presented to the user as THEIR card number, behind a "biometric" gate that
// authenticated nothing. Someone could copy those digits down believing they
// had their card.
//
// WHAT IT DOES NOW: asks the real endpoint. `/api/cards/lifecycle/:id/reveal`
// mints a single-use, 60-second grant that the client exchanges directly with
// the issuer's PCI vault — FurlPay never holds the PAN, so there is nothing
// here to leak. That endpoint is gated by `cardIssuerOr503()`, and no issuer is
// contracted, so today it answers 503. That answer is rendered as
// "unavailable", which is the truth. An honest empty state beats a convincing
// fake number.
// ---------------------------------------------------------------------------
type RevealState =
  | { kind: "locked" }
  | { kind: "requesting" }
  | { kind: "granted"; expiresAt: string }
  | { kind: "unavailable"; detail: string };

function ViewModal({ card, onClose }: { card: PaymentCard; onClose: () => void }) {
  const [state, setState] = useState<RevealState>({ kind: "locked" });

  async function reveal() {
    setState({ kind: "requesting" });
    try {
      const res = await fetch(`/api/cards/lifecycle/${card.id}/reveal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = (await res.json().catch(() => ({}))) as {
        grant?: { expiresAt?: string };
        expiresAt?: string;
        error?: string;
        message?: string;
        detail?: string;
      };
      if (!res.ok) {
        setState({
          kind: "unavailable",
          detail:
            json.detail ?? json.message ?? json.error ?? `Reveal is unavailable (${res.status}).`,
        });
        return;
      }
      setState({
        kind: "granted",
        expiresAt: json.grant?.expiresAt ?? json.expiresAt ?? new Date(Date.now() + 60_000).toISOString(),
      });
    } catch (e) {
      setState({
        kind: "unavailable",
        detail: e instanceof Error ? e.message : "Network request failed",
      });
    }
  }

  return (
    <Modal open title="Card details" onClose={onClose}>
      {state.kind === "locked" || state.kind === "requesting" ? (
        <div className="py-4 text-center">
          <LockIcon className="mx-auto mb-3 h-10 w-10 text-accent" />
          <p className="mb-5 text-[13px] text-textSecondary">
            Revealing full card details requires re-authentication.
          </p>
          <button
            onClick={reveal}
            disabled={state.kind === "requesting"}
            className="tap w-full rounded-pill bg-accent py-3.5 font-semibold disabled:opacity-50"
          >
            {state.kind === "requesting" ? "Authenticating…" : "Authenticate to reveal"}
          </button>
        </div>
      ) : state.kind === "unavailable" ? (
        <div className="space-y-3">
          <div className="rounded-xl border border-white/10 bg-loss/[0.08] p-4">
            <p className="text-[13px] font-semibold text-loss">Card details unavailable</p>
            <p className="mt-2 text-[12.5px] leading-relaxed text-textSecondary">{state.detail}</p>
          </div>
          <p className="text-[12px] leading-relaxed text-textMuted">
            FurlPay never stores your card number — it lives in the issuer&apos;s PCI vault and is
            fetched with a single-use grant. Until an issuer is contracted there is no vault to
            fetch from, so nothing is shown here rather than a placeholder.
          </p>
          <Field label="Last 4" value={`•••• ${card.last4}`} mono />
          <Field label="Network" value={card.network} />
        </div>
      ) : (
        <div className="space-y-3">
          {/* A grant exists. The digits come from the PCI vault exchange, never
              from this app's state — so there is nothing to render here until
              that exchange runs against a real issuer. */}
          <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
            <p className="text-[13px] font-semibold">Reveal grant issued</p>
            <p className="mt-2 text-[12.5px] leading-relaxed text-textSecondary">
              Single-use, expires {new Date(state.expiresAt).toLocaleTimeString()}. The card number
              is fetched straight from the issuer&apos;s PCI vault with this grant.
            </p>
          </div>
          <Field label="Last 4" value={`•••• ${card.last4}`} mono />
          <Field label="Network" value={card.network} />
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Order a card. Reads the real product list — which carries per-product refusal
// reasons, so "Metal — requires Pro" is shown up front rather than discovered
// at submit time — and posts to the real order endpoint.
// ---------------------------------------------------------------------------
interface CardProductRow {
  id: string;
  name: string;
  feeUsd: number;
  description: string;
  available?: boolean;
  reason?: string;
}

function IssueCardModal({ onClose, onOrdered }: { onClose: () => void; onOrdered: () => void }) {
  const [products, setProducts] = useState<CardProductRow[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getJSON<{ products: CardProductRow[] }>("/api/cards/products")
      .then((r) => {
        if (cancelled) return;
        setProducts(r.products);
        setSelected(r.products.find((p) => p.available !== false)?.id ?? null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load card products");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/cards/order", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Ordering charges an issuance fee, so a retry after a timeout must
          // not produce two cards. The route is idempotent per key.
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ productId: selected, label: label.trim() || "My card" }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        detail?: string;
      };
      if (!res.ok) {
        setError(json.detail ?? json.message ?? json.error ?? `Order failed (${res.status}).`);
        return;
      }
      onOrdered();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title="Order a card" onClose={onClose}>
      {!products && !error && (
        <p className="py-6 text-center text-[13px] text-textSecondary">Loading…</p>
      )}

      {products && (
        <div className="space-y-2">
          {products.map((p) => {
            const disabled = p.available === false;
            const active = selected === p.id;
            return (
              <button
                key={p.id}
                disabled={disabled}
                onClick={() => setSelected(p.id)}
                className={`tap w-full rounded-xl border p-4 text-left transition-colors ${
                  active ? "border-accent bg-accent/[0.08]" : "border-surfaceMuted bg-surface"
                } ${disabled ? "cursor-not-allowed opacity-45" : ""}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[15px] font-semibold">{p.name}</span>
                  <span className="font-mono text-[13px]">
                    {p.feeUsd === 0 ? "Free" : `$${p.feeUsd.toFixed(2)}`}
                  </span>
                </div>
                <p className="mt-1 text-[12.5px] leading-relaxed text-textSecondary">
                  {p.description}
                </p>
                {disabled && p.reason && <p className="mt-1.5 text-[11.5px] text-accent">{p.reason}</p>}
              </button>
            );
          })}

          <label className="block pt-2">
            <span className="text-[12px] text-textSecondary">Card label</span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="My card"
              maxLength={32}
              className="mt-1 w-full rounded-xl border border-surfaceMuted bg-surface px-3 py-2.5 text-[14px] outline-none focus:border-accent"
            />
          </label>
        </div>
      )}

      {error && (
        <div className="mt-3 rounded-xl border border-white/10 bg-loss/[0.08] p-3">
          <p className="text-[12.5px] leading-relaxed text-loss">{error}</p>
        </div>
      )}

      <button
        onClick={submit}
        disabled={busy || !selected}
        className="tap mt-4 w-full rounded-pill bg-accent py-3.5 font-semibold disabled:opacity-50"
      >
        {busy ? "Ordering…" : "Order card"}
      </button>
    </Modal>
  );
}

function LimitsModal({ card, onSave, onClose }: { card: PaymentCard; onSave: (p: Partial<PaymentCard> & { id: string }) => void; onClose: () => void }) {
  const [perPurchase, setPer] = useState(card.limits.perPurchase);
  const [daily, setDaily] = useState(card.limits.daily);
  return (
    <Modal open title="Spending limits" onClose={onClose}>
      <SliderRow label="Per-purchase limit" value={perPurchase} max={10000} onChange={setPer} />
      <SliderRow label="Daily limit" value={daily} max={20000} onChange={setDaily} />
      <button
        onClick={() => { onSave({ id: card.id, limits: { ...card.limits, perPurchase, daily } }); onClose(); }}
        className="mt-4 w-full rounded-pill bg-accent py-3.5 font-semibold"
      >
        Save limits
      </button>
    </Modal>
  );
}

function SettingsModal({ card, onSave, onClose }: { card: PaymentCard; onSave: (p: Partial<PaymentCard> & { id: string }) => void; onClose: () => void }) {
  const [channels, setChannels] = useState(card.channels);
  const [currency, setCurrency] = useState(card.settlementCurrency);
  const toggle = (k: keyof typeof channels) => setChannels((c) => ({ ...c, [k]: !c[k] }));
  return (
    <Modal open title="Card settings" onClose={onClose}>
      <div className="space-y-2">
        <ToggleRow label="Online transactions" on={channels.online} onClick={() => toggle("online")} />
        <ToggleRow label="Offline (POS) transactions" on={channels.offline} onClick={() => toggle("offline")} />
        <ToggleRow label="ATM withdrawals" on={channels.atm} onClick={() => toggle("atm")} />
      </div>
      <div className="mt-4">
        <label className="mb-1 block text-[12px] text-textSecondary">Settlement currency</label>
        <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-full rounded-2xl bg-surface px-4 py-3 font-semibold outline-none">
          {["USD", "EUR", "GBP", "INR"].map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>
      <button
        onClick={() => { onSave({ id: card.id, channels, settlementCurrency: currency }); onClose(); }}
        className="mt-4 w-full rounded-pill bg-accent py-3.5 font-semibold"
      >
        Save settings
      </button>
    </Modal>
  );
}

function EscrowModal({ cardId, onClose, onDone }: { cardId: string; onClose: () => void; onDone: () => void }) {
  const [holds, setHolds] = useState<any[]>([]);
  const [merchant, setMerchant] = useState("Marriott Hotels");
  const [amount, setAmount] = useState("150");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await getJSON<{ holds: any[] }>("/api/escrow");
      setHolds(r.holds);
    } catch {
      setError("Couldn't load holds.");
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function run(op: () => Promise<unknown>, failMsg: string) {
    setBusy(true);
    setError(null);
    try {
      await op();
      await load();
      onDone();
    } catch {
      setError(failMsg);
    } finally {
      setBusy(false);
    }
  }
  const create = () =>
    run(
      () => sendJSON("/api/escrow", { action: "create", cardId, merchant, amount: Number(amount) }),
      "Couldn't create the hold. Try again."
    );
  const capture = (id: string, authorized: number) =>
    run(
      () => sendJSON("/api/escrow", { action: "capture", id, finalAmount: Math.round(authorized * 0.8 * 100) / 100 }),
      "Couldn't capture the hold. Try again."
    );
  const release = (id: string) =>
    run(() => sendJSON("/api/escrow", { action: "release", id }), "Couldn't release the hold. Try again.");

  return (
    <Modal open title="Pre-authorization escrow" onClose={onClose}>
      <p className="mb-4 text-[13px] text-textSecondary">
        Exact hold amount is locked in a time-locked escrow contract (max 7 days), not your whole Safe.
      </p>
      <div className="mb-3 flex gap-2">
        <input value={merchant} onChange={(e) => setMerchant(e.target.value)} className="flex-1 rounded-2xl bg-surface px-4 py-3 text-sm outline-none" />
        <input type="number" min={0} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-24 rounded-2xl bg-surface px-4 py-3 text-sm outline-none" />
      </div>
      {error && <p className="mb-3 rounded-2xl bg-loss/15 p-3 text-[13px] text-loss">{error}</p>}
      <button onClick={create} disabled={busy || !merchant.trim() || !(Number(amount) > 0)} className="mb-4 w-full rounded-pill bg-accent py-3 font-semibold disabled:opacity-50">
        {busy ? "Working…" : "Create hold"}
      </button>

      <div className="max-h-64 space-y-2 overflow-y-auto">
        {holds.map((h) => (
          <div key={h.id} className="rounded-2xl bg-white/[0.04] p-3">
            <div className="flex items-center justify-between">
              <p className="font-semibold">{h.merchant}</p>
              <Pill tone={h.status === "held" ? "accent" : "muted"}>{h.status}</Pill>
            </div>
            <p className="mt-1 text-[13px] text-textSecondary">
              Auth {usd(h.authorizedAmount)}
              {h.capturedAmount != null && ` · captured ${usd(h.capturedAmount)}`}
            </p>
            {h.status === "held" && (
              <div className="mt-2 flex gap-2">
                <button onClick={() => capture(h.id, h.authorizedAmount)} disabled={busy} className="flex-1 rounded-pill bg-white/10 py-2 text-[13px] font-semibold disabled:opacity-50">Capture 80%</button>
                <button onClick={() => release(h.id)} disabled={busy} className="flex-1 rounded-pill bg-white/10 py-2 text-[13px] font-semibold disabled:opacity-50">Release</button>
              </div>
            )}
          </div>
        ))}
        {!holds.length && <p className="py-4 text-center text-sm text-textSecondary">No active holds.</p>}
      </div>
    </Modal>
  );
}

// --- small shared bits ---
function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-2xl bg-surface px-4 py-3">
      <p className="text-[11px] text-textSecondary">{label}</p>
      <p className={`mt-0.5 ${mono ? "font-mono tracking-wide" : "font-semibold"}`}>{value}</p>
    </div>
  );
}

function SliderRow({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (n: number) => void }) {
  return (
    <div className="mb-4">
      <div className="mb-1 flex justify-between">
        <span className="text-[13px] text-textSecondary">{label}</span>
        <span className="font-semibold">{usd(value)}</span>
      </div>
      <input type="range" min={100} max={max} step={100} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[#FF3B30]" />
    </div>
  );
}

function ToggleRow({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center justify-between rounded-2xl bg-surface px-4 py-3">
      <span className="text-[14px]">{label}</span>
      <span className={`relative h-6 w-11 rounded-full transition-colors ${on ? "bg-accent" : "bg-white/15"}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
      </span>
    </button>
  );
}
