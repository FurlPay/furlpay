"use client";

/*
 * Newsletter signup, built on the /wallet design language: the same holographic
 * card, the same panel/border/accent tokens and the same Inter + JetBrains Mono
 * pairing. The card is not decoration — it is the live preview of what the
 * reader is about to get: it takes their handle from the address they type,
 * counts the topics they picked, and flips to SUBSCRIBED when the request
 * lands.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check } from "lucide-react";
import HoloCard, { BRAND_ICON, handleSeed } from "@/components/card/HoloCard";
import { editionLabel } from "@/components/card/edition";
import { CATEGORIES, DEFAULT_CATEGORIES, type CategoryId } from "@/components/newsletter/categories";
import { useNewsletterSubscribe } from "@/components/newsletter/useNewsletterSubscribe";

const BRAND_SEED_SOURCE = "furlpay-newsletter";
/** Card-name budget. The line ellipsises anyway, but a 60-character local part
 *  would shrink to something unreadable first. */
const MAX_HANDLE_CHARS = 18;

/** Everything before the "@", which is the closest thing to a name we can show
 *  before someone has an account. Falls back to "you" while the field is empty
 *  or still being typed. */
function cardHandle(email: string): string {
  const local = email.trim().split("@")[0]?.replace(/[^A-Za-z0-9._-]/g, "");
  if (!local) return "you";
  return local.length > MAX_HANDLE_CHARS ? `${local.slice(0, MAX_HANDLE_CHARS)}…` : local;
}

function topicSummary(count: number): string {
  if (count === 0) return "NO TOPICS YET";
  if (count === CATEGORIES.length) return "EVERY TOPIC";
  return `${count} ${count === 1 ? "TOPIC" : "TOPICS"}`;
}

export default function NewsletterClaim({ initialEdition }: { initialEdition: string }) {
  const [email, setEmail] = useState("");
  const [categories, setCategories] = useState<CategoryId[]>(DEFAULT_CATEGORIES);
  const [subscribedAs, setSubscribedAs] = useState<string | null>(null);
  const { status, message, subscribe, reset } = useNewsletterSubscribe();

  const stageRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  // The edition is rendered on the server (build time for this static page) and
  // corrected on mount, so the label can never go stale without producing a
  // hydration mismatch on the first paint.
  const [edition, setEdition] = useState(initialEdition);
  useEffect(() => setEdition(editionLabel(new Date())), []);

  // Re-seeding the shader recompiles the WebGL program, so the finish follows
  // the address on a debounce rather than on every keystroke.
  const [seedSource, setSeedSource] = useState(BRAND_SEED_SOURCE);
  useEffect(() => {
    const local = email.trim().split("@")[0] ?? "";
    const timer = setTimeout(() => setSeedSource(local || BRAND_SEED_SOURCE), 450);
    return () => clearTimeout(timer);
  }, [email]);
  const seed = useMemo(() => handleSeed(seedSource), [seedSource]);

  const toggleCategory = (id: CategoryId) => {
    reset();
    setCategories((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  };

  // Same rejection cue as /wallet: the card shakes instead of the page jumping.
  const rejectShake = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    stage.classList.remove("is-rejected");
    void stage.offsetWidth; // reflow so the animation can retrigger
    stage.classList.add("is-rejected");
  }, []);

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (status === "loading") return;
    const address = email.trim();
    const ok = await subscribe(address, categories);
    if (ok) setSubscribedAs(address);
    else rejectShake();
  }

  function startOver() {
    setSubscribedAs(null);
    setEmail("");
    setCategories(DEFAULT_CATEGORIES);
    reset();
    // Focus lands after the input is back in the tree.
    requestAnimationFrame(() => emailRef.current?.focus());
  }

  const subscribed = subscribedAs !== null;
  const handle = cardHandle(subscribed ? subscribedAs : email);
  const canSubmit = email.trim().length > 0 && categories.length > 0 && status !== "loading";

  return (
    <form className="claim-experience" onSubmit={handleSubmit}>
      <div className="wallet-card-stage" ref={stageRef}>
        <HoloCard
          seed={seed}
          iconSrc={BRAND_ICON}
          brand="FurlPay Newsletter"
          edition={edition}
          name={`@${handle}`}
          leftLabel={subscribed ? "STATUS" : "SUBSCRIPTION"}
          leftValue={subscribed ? "SUBSCRIBED" : topicSummary(categories.length)}
          rightLabel="DELIVERED TO"
          rightValue={(subscribed ? subscribedAs : email.trim()) || "your inbox"}
          cardRef={cardRef}
          onPointerMove={handlePointerMove}
          onPointerLeave={handlePointerLeave}
        />
      </div>

      <header className="hero-copy interactive-hero">
        <p className="hero-eyebrow">Newsletter</p>
        <h1>Updates worth reading, from a team that ships.</h1>
        <p>
          Product launches, engineering deep-dives, security bulletins and a curated weekly
          digest. Choose exactly what you care about — nothing else is ever sent.
        </p>
      </header>

      {subscribed ? (
        <div className="nl-confirmed" role="status">
          <span aria-hidden="true" className="nl-confirmed-mark">
            <Check strokeWidth={2.4} />
          </span>
          <p className="nl-confirmed-title">{message}</p>
          <p className="nl-confirmed-body">
            <strong>{subscribedAs}</strong> will receive{" "}
            {categories.map((id) => CATEGORIES.find((c) => c.id === id)?.label).filter(Boolean).join(", ")}
            .
          </p>
          <div className="nl-confirmed-actions">
            <Link className="nav-link" href="/blog">
              Read the blog <span aria-hidden="true">↗</span>
            </Link>
            <button className="nl-textlink" onClick={startOver} type="button">
              Subscribe another address
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* A group + labelled heading rather than fieldset/legend: a <legend>
              is laid out by the fieldset algorithm, not as a grid item, so it
              escapes the two-column grid in Chrome. */}
          <div aria-labelledby="nl-topics-heading" className="nl-topics" role="group">
            <p className="nl-topics-legend" id="nl-topics-heading">
              Pick your topics
            </p>
            {CATEGORIES.map((cat) => {
              const on = categories.includes(cat.id);
              return (
                <button
                  aria-pressed={on}
                  className={`nl-topic${on ? " is-on" : ""}`}
                  key={cat.id}
                  onClick={() => toggleCategory(cat.id)}
                  type="button"
                >
                  <span aria-hidden="true" className="nl-topic-icon">
                    <cat.Icon />
                  </span>
                  <span className="nl-topic-text">
                    <span className="nl-topic-label">{cat.label}</span>
                    <span className="nl-topic-desc">{cat.desc}</span>
                  </span>
                  <span aria-hidden="true" className="nl-topic-check">
                    {on ? <Check strokeWidth={2.6} /> : null}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="name-picker nl-field">
            <div className={`name-input-shell status-${status}`}>
              <input
                aria-describedby="newsletter-message"
                aria-label="Email address"
                autoComplete="email"
                id="newsletter-email"
                maxLength={254}
                onChange={(e) => {
                  setEmail(e.target.value);
                  reset();
                }}
                placeholder="you@company.com"
                ref={emailRef}
                spellCheck={false}
                type="email"
                value={email}
              />
              <span aria-hidden="true" className="name-status">
                {status === "loading" ? <span className="status-spinner" /> : null}
              </span>
            </div>
          </div>

          <div className="claim-actions">
            <button className="claim-button" disabled={!canSubmit} type="submit">
              {status === "loading" ? "Subscribing…" : "Subscribe"}
              <span aria-hidden="true">↗</span>
            </button>
            <p
              aria-live="polite"
              className={`form-message status-${status}`}
              id="newsletter-message"
              role="status"
            >
              {status === "error" ? message : ""}
            </p>
            {/* This is the consent notice shown AT the point of consent, so it
                has to match what the route actually writes — address, topics,
                timestamp and the originating IP (see lib/newsletter.ts). The
                earlier wording said "nothing else" while omitting the IP, which
                the FAQ further down the page disclosed correctly. */}
            <p className="reservation-disclaimer">
              We store your address, your topic selection, a consent timestamp and the IP the
              consent came from — nothing else. One-click unsubscribe on every email.
            </p>
          </div>
        </>
      )}
    </form>
  );
}
