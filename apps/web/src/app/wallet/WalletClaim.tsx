"use client";

/*
 * FurlPay Wallet — interactive reservation experience.
 *
 * Behaviour mirrors the original launch page: a live wallet card that tilts to
 * the pointer, a debounced availability check against `/api/check`, and a
 * success view once a handle is reserved. Branding and palette are FurlPay's.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import HoloCard, { FurlIcon, handleSeed } from "@/components/card/HoloCard";

// Stable seed for the live claim card's holographic finish. Constant so the
// WebGL program is not rebuilt on every keystroke; the success card seeds from
// the reserved handle instead, for a per-name finish.
const BRAND_SEED = handleSeed("furlpay-wallet");

const HANDLE_PATTERN = /^[A-Za-z0-9-]+$/;
const MIN_LEN = 3;
const MAX_LEN = 32;
const HANDLE_DOMAIN = "furlpay.com";
const EDITION = "AUGUST / 2026";

// Chains FurlPay settles on today (grounded in the repo's chain registry +
// shipped logos in public/logos/chains). USDC is the settlement asset. This is
// FurlPay's own x402 support — NOT a claim of third-party partnerships.
const CHAINS: { slug: string; label: string; logo: boolean }[] = [
  { slug: "arbitrum", label: "Arbitrum", logo: true },
  { slug: "base", label: "Base", logo: false },
  { slug: "ethereum", label: "Ethereum", logo: true },
  { slug: "solana", label: "Solana", logo: true },
  { slug: "optimism", label: "Optimism", logo: true },
  { slug: "polygon", label: "Polygon", logo: true },
  { slug: "avalanche", label: "Avalanche", logo: true },
  { slug: "gnosis", label: "Gnosis", logo: true },
];

const FEATURES: { title: string; body: React.ReactNode; icon: React.ReactNode }[] = [
  {
    title: "Your identity",
    body: (
      <>
        A human-readable name — <b>name.{HANDLE_DOMAIN}</b> — that your account and its agents
        present when they pay.
      </>
    ),
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" />
      </svg>
    ),
  },
  {
    title: "Agent wallets",
    body: (
      <>Give each AI agent a wallet with hard spending limits and policies. It can pay — never overspend.</>
    ),
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <rect x="3" y="6" width="18" height="13" rx="3" />
        <path d="M16 12h3M3 10h18" />
      </svg>
    ),
  },
  {
    title: "x402 payments",
    body: (
      <>Pay per API call over HTTP with the open x402 standard. Settles in USDC in under a second.</>
    ),
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
      </svg>
    ),
  },
];

type Status = "idle" | "checking" | "available" | "taken" | "error";

interface CheckResponse {
  available: boolean;
  normalized?: string;
  error?: string;
}

/** Validate the availability payload the same way the original did: a boolean
 *  `available` is mandatory, `error` when present must be a string. */
function parseCheck(data: unknown): CheckResponse {
  if (!data || typeof data !== "object") {
    throw new Error("Availability response is not an object");
  }
  const d = data as Record<string, unknown>;
  if (typeof d.available !== "boolean") {
    throw new Error("Availability response is missing a boolean available field");
  }
  if (d.error !== undefined && typeof d.error !== "string") {
    throw new Error("Availability response has an invalid error field");
  }
  return {
    available: d.available,
    normalized: typeof d.normalized === "string" ? d.normalized : undefined,
    error: typeof d.error === "string" ? d.error : undefined,
  };
}

interface CardProps {
  displayName: string;
  seed: number;
  onPointerMove?: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerLeave?: () => void;
  cardRef?: React.Ref<HTMLDivElement>;
}

function WalletCard({ displayName, seed, onPointerMove, onPointerLeave, cardRef }: CardProps) {
  const handle = displayName || "yourname";
  return (
    <HoloCard
      seed={seed}
      brand="FurlPay Wallet"
      edition={EDITION}
      name={`@${handle}`}
      leftLabel="IDENTITY"
      leftValue="ACCOUNT & AGENT"
      rightLabel="ONE OF ONE"
      rightValue={`${handle}.${HANDLE_DOMAIN}`}
      cardRef={cardRef}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    />
  );
}

export default function WalletClaim({ initialReserved }: { initialReserved?: string }) {
  const router = useRouter();
  const [tag, setTag] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [normalized, setNormalized] = useState<string | null>(null);
  // Seeded from the server via ?reserved=<handle> when the consent flow
  // redirects back after a successful authorization — that flips the page to
  // the success card.
  const [reserved] = useState<string | null>(() => {
    const r = (initialReserved ?? "").trim().toLowerCase();
    return /^[a-z0-9-]{3,32}$/.test(r) ? r : null;
  });
  const [submitting, setSubmitting] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  // Bumps on every keystroke; a late-arriving check for an older value is
  // dropped by comparing against this, so results never land out of order.
  const requestSeq = useRef(0);

  // ── Debounced availability check ─────────────────────────────────────────
  useEffect(() => {
    const value = tag.trim();
    const seq = ++requestSeq.current;

    if (value.length === 0) {
      setStatus("idle");
      setMessage("");
      setNormalized(null);
      return;
    }
    if (!HANDLE_PATTERN.test(value)) {
      setStatus("error");
      setMessage("Letters, numbers and hyphens only.");
      setNormalized(null);
      return;
    }
    if (value.length < MIN_LEN) {
      setStatus("idle");
      setMessage(`At least ${MIN_LEN} characters.`);
      setNormalized(null);
      return;
    }

    setStatus("checking");
    setMessage("Checking availability…");

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const signal = AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(5000),
        ]);
        const res = await fetch(`/api/check?tag=${encodeURIComponent(value)}`, { signal });
        const parsed = parseCheck(await res.json());
        if (seq !== requestSeq.current) return; // superseded by a newer keystroke

        if (res.ok && parsed.available && parsed.normalized) {
          setNormalized(parsed.normalized);
          setStatus("available");
          setMessage(`@${parsed.normalized} is available`);
        } else {
          setNormalized(null);
          setStatus("taken");
          setMessage(parsed.error || `@${value} is taken`);
        }
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setNormalized(null);
        setStatus("error");
        const name = err instanceof Error ? err.name : "";
        setMessage(
          name === "TimeoutError" || name === "AbortError"
            ? "The availability check timed out. Try again."
            : "Could not check availability."
        );
      }
    }, 350);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [tag]);

  // ── Pointer tilt + parallax ──────────────────────────────────────────────
  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    card.style.setProperty("--ry", `${px * 10}deg`);
    card.style.setProperty("--rx", `${-py * 10}deg`);
    card.style.setProperty("--mx", `${px * 40}px`);
    card.style.setProperty("--my", `${py * 40}px`);
  }, []);

  const handlePointerLeave = useCallback(() => {
    const card = cardRef.current;
    if (!card) return;
    card.style.setProperty("--ry", "0deg");
    card.style.setProperty("--rx", "0deg");
    card.style.setProperty("--mx", "0px");
    card.style.setProperty("--my", "0px");
  }, []);

  function rejectShake() {
    const stage = stageRef.current;
    if (!stage) return;
    stage.classList.remove("is-rejected");
    // reflow so the animation can retrigger
    void stage.offsetWidth;
    stage.classList.add("is-rejected");
  }

  // ── Continue to authorization ────────────────────────────────────────────
  // Reserving a handle binds it to a FurlPay account, so "Choose your name"
  // hands off to the consent screen (which requires sign-in). The atomic
  // reserve+bind happens there, on Authorize.
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (status !== "available" || !normalized || submitting) {
      rejectShake();
      return;
    }
    setSubmitting(true);
    router.push(`/wallet/authorize?handle=${encodeURIComponent(normalized)}`);
  }

  const displayName = normalized ?? tag.trim();
  const canSubmit = status === "available" && !!normalized && !submitting;

  // ── Success view ─────────────────────────────────────────────────────────
  if (reserved) {
    const shareText = encodeURIComponent(
      `I just reserved @${reserved} on FurlPay Wallet — reserve yours at https://furlpay.com/wallet`
    );
    return (
      <main className="success-page">
        <nav aria-label="Main navigation" className="launch-nav">
          <Link aria-label="FurlPay Wallet home" className="wordmark" href="/">
            <FurlIcon />
            <span>FurlPay Wallet</span>
          </Link>
        </nav>
        <div className="success-hero">
          <div className="success-card-wrap">
            <div className="success-card-scene">
              <div className="success-card-float">
                <div className="success-card-orbit">
                  <HoloCard
                    surfaceClassName="success-card-face success-card-front"
                    seed={handleSeed(reserved)}
                    brand="FurlPay Wallet"
                    edition={EDITION}
                    name={`@${reserved}`}
                    leftLabel="IDENTITY"
                    leftValue="ACCOUNT & AGENT"
                    rightLabel="ONE OF ONE"
                    rightValue={`${reserved}.${HANDLE_DOMAIN}`}
                  />
                  <div className="success-card-face success-card-back">
                    <div aria-hidden="true" className="success-back-glow" />
                    <div className="success-back-logo">
                      <FurlIcon />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="success-copy">
            <h1>You&apos;re on the list.</h1>
            <p>
              <strong>@{reserved}</strong> is reserved for you. Come back at launch to
              claim{" "}
              <strong>
                {reserved}.{HANDLE_DOMAIN}
              </strong>
              .
            </p>
            <a
              className="share-x-button"
              href={`https://x.com/intent/post?text=${shareText}`}
              rel="noopener noreferrer"
              target="_blank"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              Share on X
            </a>
          </div>
        </div>
        <footer className="launch-footer">
          <span>Built on FurlPay&apos;s global network</span>
          <div>
            <Link href="/legal/privacy">Privacy</Link>
            <Link href="/legal/terms">Terms</Link>
          </div>
        </footer>
      </main>
    );
  }

  // ── Claim view ───────────────────────────────────────────────────────────
  return (
    <main className="launch-page">
      <div aria-hidden="true" className="ambient-grid" />
      <nav aria-label="Main navigation" className="launch-nav">
        <Link aria-label="FurlPay Wallet home" className="wordmark" href="/">
          <FurlIcon />
          <span>FurlPay Wallet</span>
        </Link>
        <Link className="nav-link" href="/products">
          Learn more <span aria-hidden="true">↗</span>
        </Link>
      </nav>
      <section className="launch-hero">
        <form className="claim-experience" onSubmit={handleSubmit}>
          <div className="wallet-card-stage" ref={stageRef}>
            <WalletCard
              displayName={displayName}
              seed={BRAND_SEED}
              cardRef={cardRef}
              onPointerMove={handlePointerMove}
              onPointerLeave={handlePointerLeave}
            />
          </div>
          <header className="hero-copy interactive-hero">
            <p className="hero-eyebrow">Agentic stablecoin payments</p>
            <h1>Reserve your FurlPay Wallet.</h1>
            <p>
              Claim the name your account and AI agents present when they pay across the web —
              settled in stablecoins over the open x402 standard.
            </p>
          </header>
          <div className="name-picker">
            <div className={`name-input-shell status-${status}`}>
              <span aria-hidden="true" className="name-at">
                @
              </span>
              <input
                aria-describedby="tag-message"
                aria-label="Choose your wallet name"
                autoCapitalize="none"
                autoComplete="off"
                id="tag"
                maxLength={MAX_LEN}
                minLength={MIN_LEN}
                pattern="[A-Za-z0-9-]+"
                placeholder="yourname"
                spellCheck={false}
                type="text"
                value={tag}
                onChange={(e) => setTag(e.target.value)}
              />
              <span aria-hidden="true" className="name-status">
                {status === "checking" ? (
                  <span className="status-spinner" />
                ) : status === "available" ? (
                  "✓"
                ) : status === "taken" || status === "error" ? (
                  "✕"
                ) : (
                  ""
                )}
              </span>
            </div>
          </div>
          <div className="claim-actions">
            <button className="claim-button" disabled={!canSubmit} type="submit">
              {submitting ? "Continuing…" : "Choose your name"}
              <span aria-hidden="true">↗</span>
            </button>
            <p
              className={`form-message status-${status}`}
              id="tag-message"
              role="status"
              aria-live="polite"
            >
              {message}
            </p>
            <p className="reservation-disclaimer">
              FurlPay reserves the right to reject wallet handle reservations for any
              reason.
            </p>
          </div>
        </form>
      </section>

      <section className="wallet-features" aria-label="What FurlPay Wallet gives you">
        {FEATURES.map((f) => (
          <article className="feature-card" key={f.title}>
            <div className="feature-icon">{f.icon}</div>
            <h3>{f.title}</h3>
            <p>{f.body}</p>
          </article>
        ))}
      </section>

      <section className="wallet-ecosystem" aria-label="Ecosystem">
        <p className="eco-eyebrow">Built on the open x402 standard</p>
        <h2 className="eco-title">The rails the web is standardizing on.</h2>
        <p className="eco-sub">
          Payments settle in USDC across every major chain — the same open, agentic-payment
          standard the industry is building on.
        </p>
        <ul className="eco-chains">
          {CHAINS.map((c) => (
            <li key={c.slug}>
              {c.logo ? (
                // eslint-disable-next-line @next/next/no-img-element -- static local chain logo
                <img src={`/logos/chains/${c.slug}.svg`} alt="" aria-hidden="true" />
              ) : (
                <span className="eco-chain-mark" aria-hidden="true">
                  {c.label.charAt(0)}
                </span>
              )}
              <span>{c.label}</span>
            </li>
          ))}
        </ul>
        <div className="eco-badges">
          <span className="eco-badge">
            <b>x402</b> pay-per-call
          </span>
          <span className="eco-badge">
            <b>USDC</b> settlement
          </span>
          <span className="eco-badge">Sub-second, near-zero fees</span>
        </div>
      </section>

      <footer className="launch-footer">
        <span>Built on FurlPay&apos;s global network</span>
        <div>
          <Link href="/legal/privacy">Privacy</Link>
          <Link href="/legal/terms">Terms</Link>
        </div>
      </footer>
    </main>
  );
}
