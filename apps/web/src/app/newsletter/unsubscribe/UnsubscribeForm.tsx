"use client";

import Link from "next/link";
import { FormEvent, useRef, useState } from "react";
import { CATEGORIES, type CategoryId } from "@/components/newsletter/categories";
import { useNewsletterSubscribe } from "@/components/newsletter/useNewsletterSubscribe";

export default function UnsubscribeForm() {
  const [email, setEmail] = useState("");
  const [selected, setSelected] = useState<CategoryId[]>([]);
  // Removing every topic is irreversible and one click used to do it. The
  // button now arms first, so a mis-click costs a second click, not a
  // subscription.
  const [armed, setArmed] = useState(false);
  const { status, message, unsubscribe, reset } = useNewsletterSubscribe();
  const emailRef = useRef<HTMLInputElement>(null);

  const toggle = (id: CategoryId) => {
    reset();
    setSelected((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  };

  const handleSelective = (e: FormEvent) => {
    e.preventDefault();
    if (status === "loading") return;
    if (selected.length === 0) {
      emailRef.current?.focus();
      return;
    }
    void unsubscribe(email, selected);
  };

  const handleAll = () => {
    if (status === "loading") return;
    if (!armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    void unsubscribe(email);
  };

  if (status === "success") {
    return (
      <div className="nl-confirmed" role="status">
        <p className="nl-confirmed-title">Done.</p>
        <p className="nl-confirmed-body">{message}</p>
        <div className="nl-confirmed-actions">
          <Link className="nav-link" href="/newsletter">
            Back to the newsletter <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="nl-panel">
      <form onSubmit={handleSelective}>
        <label className="nl-label" htmlFor="unsubscribe-email">
          Email address
        </label>
        <div className="name-input-shell nl-field-shell">
          <input
            aria-describedby="unsubscribe-message"
            autoComplete="email"
            id="unsubscribe-email"
            maxLength={254}
            onChange={(e) => {
              setEmail(e.target.value);
              setArmed(false);
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

        <div
          aria-labelledby="unsubscribe-topics-heading"
          className="nl-topics nl-topics-wide"
          role="group"
        >
          <p className="nl-topics-legend" id="unsubscribe-topics-heading">
            Remove specific topics
          </p>
          {CATEGORIES.map((cat) => {
            const on = selected.includes(cat.id);
            return (
              <button
                aria-pressed={on}
                className={`nl-topic${on ? " is-removing" : ""}`}
                key={cat.id}
                onClick={() => toggle(cat.id)}
                type="button"
              >
                <span aria-hidden="true" className="nl-topic-icon">
                  <cat.Icon />
                </span>
                <span className="nl-topic-text">
                  <span className="nl-topic-label">{cat.label}</span>
                </span>
                <span className="nl-topic-check">{on ? "remove" : ""}</span>
              </button>
            );
          })}
        </div>

        <button
          className="nl-btn"
          disabled={status === "loading" || selected.length === 0 || email.trim().length === 0}
          type="submit"
        >
          {status === "loading" ? "Processing…" : "Unsubscribe from selected"}
        </button>
      </form>

      <div className="nl-danger">
        <button
          className={`nl-danger-btn${armed ? " is-armed" : ""}`}
          disabled={status === "loading" || email.trim().length === 0}
          onClick={handleAll}
          type="button"
        >
          {armed ? "Confirm — remove me from everything" : "Unsubscribe from all emails"}
        </button>
        {armed && (
          <button className="nl-textlink" onClick={() => setArmed(false)} type="button">
            Cancel
          </button>
        )}
      </div>

      <p
        aria-live="polite"
        className={`form-message status-${status}`}
        id="unsubscribe-message"
        role="status"
      >
        {status === "error" ? message : ""}
      </p>
    </div>
  );
}
