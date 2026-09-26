"use client";

import { useState } from "react";
import { CheckCircle2, Copy, Image as ImageIcon, MoreVertical, Paperclip, Smile, X } from "lucide-react";
import { FurlPayMark } from "@/components/trips/FurlPayLogo";

// ---------------------------------------------------------------------------
// The ticket conversation. Reads the existing SupportMessage model
// (lib/support.ts): id, ticketId, author "user" | "agent" | "system", body,
// createdAt. Nothing here invents a field the API does not return.
// ---------------------------------------------------------------------------

export interface ThreadMessage {
  id: string;
  author: "user" | "agent" | "system";
  body: string;
  createdAt: string;
  authorName?: string;
}

/** Relative time, capped at a week — past that an exact date is more useful. */
export function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const secs = Math.floor((Date.now() - then) / 1000);
  if (secs < 60) return "less than a minute ago";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(then).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function TicketAlert({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div
      role="status"
      className="mb-5 flex items-center gap-3 rounded-xl border border-neon/30 bg-neon/[0.07] px-4 py-3"
    >
      <CheckCircle2 className="h-[18px] w-[18px] shrink-0 text-neon" />
      <p className="flex-1 text-[13.5px] text-white">{message}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="rounded p-1 text-textSecondary transition-colors hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-neon"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export function TicketHeader({
  subject,
  ticketId,
  status,
  createdAt,
  channel = "Web Portal",
}: {
  subject: string;
  ticketId: string;
  status: string;
  createdAt: string;
  channel?: string;
}) {
  return (
    <div className="border-b border-white/[0.07] px-6 py-5">
      <div className="flex items-start justify-between gap-4">
        <h2 className="text-[21px] font-semibold leading-snug text-white">
          {subject} <span className="text-textSecondary">#{ticketId}</span>
        </h2>
        <StatusPill status={status} />
      </div>
      <p className="mt-1.5 text-[12.5px] text-textSecondary">
        Created on {createdAt}
        <span className="mx-2">·</span>
        via {channel}
      </p>
    </div>
  );
}

/**
 * Status, as a worded pill.
 *
 * The palette allows one accent, so hue cannot carry the distinction between
 * `open`, `waiting_customer` and `in_progress` the way the old amber/sky pills
 * did. The label carries it instead, and the dot is neon only for states that
 * are actually live — a closed ticket gets a grey dot so "finished" is still
 * legible at a glance.
 */
export function StatusPill({ status }: { status: string }) {
  const LABELS: Record<string, string> = {
    open: "Open",
    waiting_support: "Waiting on support",
    waiting_customer: "Awaiting your reply",
    in_progress: "In progress",
    resolved: "Resolved",
    closed: "Closed",
  };
  const live = status !== "closed" && status !== "resolved";
  return (
    <span className="flex shrink-0 items-center gap-2 rounded-full border border-neon/30 bg-neon/[0.08] px-3 py-1 text-[12.5px] font-medium text-neon">
      <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-neon" : "bg-textSecondary"}`} />
      {LABELS[status] ?? status}
    </span>
  );
}

export function TicketActions({
  onReply,
  onClose,
  closing,
}: {
  onReply: () => void;
  onClose: () => void;
  closing?: boolean;
}) {
  const ghost =
    "rounded-lg border border-white/[0.09] px-3.5 py-1.5 text-[13px] text-white transition-colors hover:border-white/20 hover:bg-white/[0.04] disabled:opacity-50";
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onReply}
        className="rounded-lg bg-neon px-4 py-1.5 text-[13px] font-semibold text-black transition-colors hover:bg-neonDeep"
      >
        Reply
      </button>
      <button type="button" className={ghost}>
        Add people
      </button>
      <button type="button" onClick={onClose} disabled={closing} className={ghost}>
        {closing ? "Closing…" : "Close issue"}
      </button>
      <button
        type="button"
        aria-label="More actions"
        className="rounded-lg p-1.5 text-textSecondary transition-colors hover:text-white"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
    </div>
  );
}

/** A transaction hash is the one thing in these threads people retype. */
function BodyWithCopyableHashes({ body }: { body: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  return (
    <>
      {body.split("\n").map((line, i) => {
        const m = line.match(/^(.*?(?:hash|Hash)[:\s]+)([A-Za-z0-9.]{6,})(.*)$/);
        if (!m) {
          return (
            <p key={i} className={line.trim() ? "text-[13.5px] leading-[1.7] text-[#D4D8D6]" : "h-2"}>
              {line}
            </p>
          );
        }
        const [, prefix, hash, rest] = m;
        return (
          <p key={i} className="flex items-center gap-1.5 text-[13.5px] leading-[1.7] text-[#D4D8D6]">
            <span>
              {prefix}
              <span className="font-mono text-white">{hash}</span>
              {rest}
            </span>
            <button
              type="button"
              aria-label={copied === hash ? "Copied" : "Copy transaction hash"}
              onClick={() => {
                void navigator.clipboard?.writeText(hash);
                setCopied(hash);
                setTimeout(() => setCopied(null), 1500);
              }}
              className="rounded p-0.5 text-textSecondary transition-colors hover:text-neon"
            >
              {copied === hash ? <CheckCircle2 className="h-3.5 w-3.5 text-neon" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </p>
        );
      })}
    </>
  );
}

export function TicketMessage({
  message,
  customerName,
  actions,
}: {
  message: ThreadMessage;
  customerName: string;
  actions?: React.ReactNode;
}) {
  // Three authors, not two. The API emits a `system` note on ticket creation
  // ("Ticket received. A human follows up here and by email"), and branching
  // only on `agent` rendered that as the CUSTOMER — putting words in the user's
  // mouth, under their own name and avatar. Seen in the real API response, not
  // guessed from the type.
  const isAgent = message.author === "agent";
  const isSystem = message.author === "system";
  const name = isSystem
    ? "FurlPay"
    : isAgent
      ? "FurlPay Support"
      : (message.authorName ?? customerName);
  const badge = isSystem ? "System" : isAgent ? "Support" : "Customer";

  return (
    <article className="border-b border-white/[0.06] px-6 py-5 last:border-b-0">
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neon/15">
          {isAgent || isSystem ? (
            <FurlPayMark className="h-5 w-5" />
          ) : (
            <span className="text-[13px] font-semibold text-neon">{name.charAt(0).toUpperCase()}</span>
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-[14px] font-semibold text-white">{name}</span>
            <span className="text-[12px] text-textSecondary">{relativeTime(message.createdAt)}</span>
            <span className="rounded bg-neon/[0.12] px-2 py-0.5 text-[11px] font-medium text-neon">
              {badge}
            </span>
            {actions && <div className="ml-auto">{actions}</div>}
          </div>
          <div className="mt-2 space-y-0">
            <BodyWithCopyableHashes body={message.body} />
          </div>
        </div>
      </div>
    </article>
  );
}

export function ReplyComposer({
  onSend,
  sending,
}: {
  onSend: (body: string) => Promise<void> | void;
  sending?: boolean;
}) {
  const [value, setValue] = useState("");
  const canSend = value.trim().length > 0 && !sending;

  return (
    <form
      className="flex items-center gap-3 border-t border-white/[0.07] px-6 py-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!canSend) return;
        await onSend(value.trim());
        setValue("");
      }}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neon text-[13px] font-semibold text-black">
        A
      </span>
      <div className="flex flex-1 items-center gap-2 rounded-xl border border-white/[0.09] bg-white/[0.03] px-4 py-2.5 transition-colors focus-within:border-neon/60">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Add a reply..."
          aria-label="Add a reply"
          className="flex-1 bg-transparent text-[13.5px] text-white placeholder:text-textSecondary focus:outline-none"
        />
        {[Paperclip, ImageIcon, Smile].map((Icon, i) => (
          <button
            key={i}
            type="button"
            tabIndex={-1}
            aria-hidden
            className="rounded p-1 text-textSecondary transition-colors hover:text-white"
          >
            <Icon className="h-[17px] w-[17px]" />
          </button>
        ))}
      </div>
      <button
        type="submit"
        disabled={!canSend}
        className="shrink-0 rounded-lg bg-neon px-4 py-2 text-[13px] font-semibold text-black transition-colors hover:bg-neonDeep disabled:cursor-not-allowed disabled:opacity-40"
      >
        {sending ? "Sending…" : "Send reply"}
      </button>
    </form>
  );
}
