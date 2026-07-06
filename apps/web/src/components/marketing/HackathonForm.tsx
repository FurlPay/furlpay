"use client";

import { useState } from "react";
import { Check, Loader2, Sparkles } from "lucide-react";
import { TRACKS, type TrackId } from "@/lib/hackathon";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/\S+$/i;
const CHAINS = ["Arbitrum", "Base", "Solana", "Ethereum", "Other / multi-chain"];

const ONELINER_MAX = 120;
const DESC_MAX = 600;

const field =
  "w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-[14px] text-textPrimary placeholder:text-textSecondary focus:border-neon/50 focus:outline-none transition-colors";

export default function HackathonForm() {
  const [projectName, setProjectName] = useState("");
  const [teamName, setTeamName] = useState("");
  const [email, setEmail] = useState("");
  const [track, setTrack] = useState<TrackId>("agentic");
  const [oneLiner, setOneLiner] = useState("");
  const [description, setDescription] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [demoUrl, setDemoUrl] = useState("");
  const [chain, setChain] = useState(CHAINS[0]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setProjectName("");
    setTeamName("");
    setEmail("");
    setTrack("agentic");
    setOneLiner("");
    setDescription("");
    setRepoUrl("");
    setDemoUrl("");
    setChain(CHAINS[0]);
    setDone(false);
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (projectName.trim().length < 2 || teamName.trim().length < 2) {
      return setError("Add a project name and a team name.");
    }
    if (!EMAIL_RE.test(email.trim())) return setError("Enter a valid contact email.");
    if (oneLiner.trim().length < 10) return setError("Give us a one-liner (at least 10 characters).");
    if (description.trim().length < 20) return setError("Tell us a bit more (at least 20 characters).");
    if (repoUrl.trim() && !URL_RE.test(repoUrl.trim())) return setError("Repo link must be a valid http(s) URL.");
    if (demoUrl.trim() && !URL_RE.test(demoUrl.trim())) return setError("Demo link must be a valid http(s) URL.");

    setBusy(true);
    try {
      const res = await fetch("/api/hackathon/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectName, teamName, email, track, oneLiner, description,
          repoUrl, demoUrl, chain,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Something went wrong.");
      setDone(true);
      // Let the live gallery refresh itself.
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("hackathon:submitted"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="animate-[fadeIn_.3s_ease] rounded-2xl border border-neon/30 bg-neon/[0.06] p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-neon/20">
          <Check className="h-6 w-6 text-neon" />
        </div>
        <h3 className="text-lg font-bold text-textPrimary">You&apos;re in the gallery</h3>
        <p className="mx-auto mt-2 max-w-md text-[14px] text-textMuted">
          <strong className="text-white">{projectName || "Your project"}</strong> is submitted to the{" "}
          {TRACKS.find((t) => t.id === track)?.label} track. We review on a rolling basis and feature
          standout builds on furlpay.com and our socials.
        </p>
        <button onClick={reset} className="btn-outline mt-6 px-5 py-2.5 text-[14px]">
          Submit another
        </button>
      </div>
    );
  }

  const oneLinerLeft = ONELINER_MAX - oneLiner.length;
  const descLeft = DESC_MAX - description.length;

  return (
    <form onSubmit={submit} className="space-y-5">
      {/* Track selector — segmented pills */}
      <div>
        <label className="mb-2 block text-[13px] font-semibold text-textSecondary">Choose a track</label>
        <div className="flex flex-wrap gap-2">
          {TRACKS.map((t) => {
            const active = t.id === track;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTrack(t.id)}
                aria-pressed={active}
                title={t.blurb}
                className={`rounded-pill border px-4 py-2 text-[13px] font-semibold transition-all ${
                  active
                    ? "border-neon/50 bg-neon/15 text-neon"
                    : "border-white/10 bg-white/[0.02] text-textSecondary hover:border-white/20 hover:text-white"
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[12px] text-textMuted">{TRACKS.find((t) => t.id === track)?.blurb}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <input className={field} placeholder="Project name" value={projectName} onChange={(e) => setProjectName(e.target.value)} maxLength={80} />
        <input className={field} placeholder="Team / builder name" value={teamName} onChange={(e) => setTeamName(e.target.value)} maxLength={80} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <input className={field} type="email" placeholder="Contact email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <select className={field} value={chain} onChange={(e) => setChain(e.target.value)}>
          {CHAINS.map((c) => (
            <option key={c} value={c} className="bg-charcoal">{c}</option>
          ))}
        </select>
      </div>

      <div>
        <input
          className={field}
          placeholder="One-liner — what does it do?"
          value={oneLiner}
          onChange={(e) => setOneLiner(e.target.value.slice(0, ONELINER_MAX))}
        />
        <div className="mt-1 text-right text-[11px] text-textMuted">{oneLinerLeft} left</div>
      </div>

      <div>
        <textarea
          className={`${field} min-h-[120px] resize-y`}
          placeholder="How does it work? What did you build with FurlPay / x402 / Arbitrum?"
          value={description}
          onChange={(e) => setDescription(e.target.value.slice(0, DESC_MAX))}
        />
        <div className="mt-1 text-right text-[11px] text-textMuted">{descLeft} left</div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <input className={field} placeholder="GitHub / repo URL (optional)" value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} />
        <input className={field} placeholder="Live demo URL (optional)" value={demoUrl} onChange={(e) => setDemoUrl(e.target.value)} />
      </div>

      {error && <p role="alert" className="text-[13px] text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-pill bg-neon py-3.5 text-[15px] font-semibold text-black transition-transform hover:-translate-y-0.5 disabled:opacity-60 sm:w-auto sm:px-10"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        {busy ? "Submitting…" : "Submit your project"}
      </button>
      <p className="text-[12px] text-textSecondary">
        Ideas welcome too — you don&apos;t need a finished build to submit. We review on a rolling basis.
      </p>
    </form>
  );
}
