"use client";

import { useCallback, useEffect, useState } from "react";
import { Github, ExternalLink, Loader2 } from "lucide-react";
import { TRACKS, trackLabel, type TrackId, type PublicSubmission } from "@/lib/hackathon";

type Filter = TrackId | "all";

const TRACK_COLOR: Record<TrackId, string> = {
  agentic: "#34C759",
  consumer: "#32ADE6",
  infra: "#007AFF",
  wildcard: "#FF9F0A",
};

export default function HackathonGallery() {
  const [filter, setFilter] = useState<Filter>("all");
  const [items, setItems] = useState<PublicSubmission[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = filter === "all" ? "" : `?track=${filter}`;
      const res = await fetch(`/api/hackathon/submissions${qs}`, { cache: "no-store" });
      const data = await res.json();
      setItems(Array.isArray(data.submissions) ? data.submissions : []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  // Refresh when the form reports a new submission.
  useEffect(() => {
    const onSubmit = () => load();
    window.addEventListener("hackathon:submitted", onSubmit);
    return () => window.removeEventListener("hackathon:submitted", onSubmit);
  }, [load]);

  return (
    <div>
      {/* Filter tabs */}
      <div className="mb-6 flex flex-wrap gap-2">
        {(["all", ...TRACKS.map((t) => t.id)] as Filter[]).map((f) => {
          const active = f === filter;
          const label = f === "all" ? "All" : trackLabel(f);
          return (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              aria-pressed={active}
              className={`rounded-pill border px-4 py-1.5 text-[13px] font-semibold transition-all ${
                active
                  ? "border-neon/50 bg-neon/15 text-neon"
                  : "border-white/10 bg-white/[0.02] text-textSecondary hover:border-white/20 hover:text-white"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-white/10 py-16 text-textMuted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading builds…
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/15 py-16 text-center">
          <p className="text-[15px] font-semibold text-white">No builds here yet.</p>
          <p className="mt-1 text-[13px] text-textMuted">
            Be the first to ship in this track — scroll up and submit your project.
          </p>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((s) => {
            const color = TRACK_COLOR[s.track] ?? "#34C759";
            return (
              <article
                key={s.id}
                style={{ ["--cat" as string]: color }}
                className="group flex flex-col rounded-2xl border border-white/10 bg-white/[0.02] p-5 transition-all hover:-translate-y-0.5 hover:border-[color:var(--cat)]"
              >
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span
                    className="rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                    style={{ color, backgroundColor: `${color}1a` }}
                  >
                    {trackLabel(s.track)}
                  </span>
                  {s.featured && (
                    <span className="rounded-full bg-neon px-2 py-0.5 text-[10px] font-bold text-black">FEATURED</span>
                  )}
                </div>
                <h3 className="text-[16px] font-bold text-white">{s.projectName}</h3>
                <p className="text-[12px] text-textMuted">by {s.teamName}{s.chain ? ` · ${s.chain}` : ""}</p>
                <p className="mt-2 flex-1 text-[13px] leading-relaxed text-textSecondary">{s.oneLiner}</p>
                {(s.repoUrl || s.demoUrl) && (
                  <div className="mt-4 flex gap-3 text-[12px]">
                    {s.repoUrl && (
                      <a href={s.repoUrl} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-textSecondary hover:text-neon">
                        <Github className="h-3.5 w-3.5" /> Repo
                      </a>
                    )}
                    {s.demoUrl && (
                      <a href={s.demoUrl} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-textSecondary hover:text-neon">
                        <ExternalLink className="h-3.5 w-3.5" /> Demo
                      </a>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
