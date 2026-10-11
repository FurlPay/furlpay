import type { ReactNode } from "react";

// One empty / unavailable / failed state for every travel results page, so
// "nothing to show" always reads as intentional: what happened, why, and what
// the visitor can do next. It never invents listings or prices to fill space.

export const EMPTY_ACTION_PRIMARY =
  "inline-flex h-10 items-center justify-center gap-2 rounded-full bg-neon px-5 text-[13px] font-bold text-black transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neon";
export const EMPTY_ACTION_SECONDARY =
  "inline-flex h-10 items-center justify-center gap-2 rounded-full border border-white/[0.12] bg-white/[0.04] px-5 text-[13px] font-semibold text-white transition-colors hover:border-white/[0.24] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neon";

export default function EmptyState({
  icon, title, children, actions, role,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  /** "alert" for a failure the visitor should notice; default is a status. */
  role?: "status" | "alert";
}) {
  return (
    <div role={role ?? "status"} className="flex flex-col items-center rounded-2xl border border-dashed border-white/[0.10] bg-white/[0.015] px-6 py-14 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full border border-neon/25 bg-neon/10 text-neon" aria-hidden>
        {icon}
      </span>
      <p className="mt-4 text-[16px] font-semibold text-white">{title}</p>
      {children && <div className="mx-auto mt-1.5 max-w-md text-[13.5px] leading-relaxed text-white/60">{children}</div>}
      {actions && <div className="mt-5 flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  );
}
