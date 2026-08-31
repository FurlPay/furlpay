// ---------------------------------------------------------------------------
// The chat widget's conversation, persisted across page loads.
//
// A support conversation that resets when someone clicks a link is not a
// conversation. The widget lives on marketing pages, where moving between pages
// is the entire point, so persistence is what makes it usable at all rather
// than a nicety.
//
// ── SESSIONSTORAGE, NOT LOCALSTORAGE ───────────────────────────────────────
// Deliberate, and the opposite of what recentSearches and savedPlaces use.
// A support transcript is the most sensitive thing this app keeps in the
// browser: someone describing a failed payment types amounts, merchants, and
// often more. sessionStorage is scoped to the tab and cleared when it closes,
// which matches how long the conversation is actually useful. localStorage
// would leave a stranger's payment problem sitting in a shared browser
// indefinitely.
//
// ── WHAT IS NOT STORED ─────────────────────────────────────────────────────
// No email address, ever — the handoff form collects it, sends it, and forgets
// it. Persisting a contact address is the part of this data that would still be
// worth something to someone else weeks later.
//
// ── EVERYTHING HERE DISTRUSTS THE STORE ────────────────────────────────────
// Same posture as the other browser stores in this codebase: parse in a
// try/catch, validate field by field, drop anything that does not survive. A
// malformed turn here renders as a chat bubble, so the failure mode is a
// visitor reading text this app did not write.
// ---------------------------------------------------------------------------

const KEY = "furlpay.support.chat";

/**
 * How many turns are kept.
 *
 * The `/ask` route accepts at most 10 history turns and the mailbox handoff at
 * most 12 transcript entries, so keeping much more than that stores text
 * nothing will ever send. 24 leaves room to scroll back through a conversation
 * while staying the same order of magnitude as what is transmitted.
 */
const LIMIT = 24;

/** A citation the assistant returned. Rendered as a real link to a real page. */
export interface ChatSource {
  title: string;
  href: string;
}

export interface ChatMessage {
  from: "bot" | "user";
  text: string;
  /** Help-centre articles this answer was grounded in. Bot turns only. */
  sources?: ChatSource[];
  /** True when the assistant could not answer and a human should take over. */
  escalate?: boolean;
  /** Epoch ms. Used for ordering and for the "sent" affordance. */
  at: number;
}

function isSource(v: unknown): v is ChatSource {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.title === "string" && s.title.length > 0 && s.title.length <= 200 &&
    typeof s.href === "string" &&
    // Same-origin, root-relative only. A stored transcript is attacker-writable
    // in a shared browser, and rendering an arbitrary href would turn a chat
    // bubble into an open redirect — or a `javascript:` URL.
    //
    // THE SECOND CHARACTER IS THE WHOLE POINT. "starts with /" is not enough:
    // `//evil.example/verify` starts with a slash and is a PROTOCOL-RELATIVE
    // URL, which the browser resolves against another origin entirely. A
    // leading `/\` is normalised the same way by some browsers. Both are
    // excluded explicitly; backslash is absent from the class as well.
    /^\/(?![/\\])[A-Za-z0-9\-._~/]*$/.test(s.href) &&
    s.href.length <= 300
  );
}

function isMessage(v: unknown): v is ChatMessage {
  if (typeof v !== "object" || v === null) return false;
  const m = v as Record<string, unknown>;
  if (m.from !== "bot" && m.from !== "user") return false;
  if (typeof m.text !== "string" || m.text.length === 0 || m.text.length > 4000) return false;
  if (typeof m.at !== "number" || !Number.isFinite(m.at)) return false;
  if (m.sources !== undefined && (!Array.isArray(m.sources) || !m.sources.every(isSource))) {
    return false;
  }
  if (m.escalate !== undefined && typeof m.escalate !== "boolean") return false;
  return true;
}

/** Reads the transcript. Returns `[]` for every failure — never throws. */
export function readChat(): ChatMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isMessage).slice(-LIMIT);
  } catch {
    return [];
  }
}

/**
 * Replaces the stored transcript. Returns what was actually kept.
 *
 * Returning the trimmed list rather than nothing means the caller's in-memory
 * state and the store cannot disagree about what the conversation is.
 */
export function writeChat(messages: ChatMessage[]): ChatMessage[] {
  const kept = messages.filter(isMessage).slice(-LIMIT);
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(kept));
  } catch {
    // Quota, private mode, or a blocked store. The conversation is still right
    // in memory; it just will not survive a navigation.
  }
  return kept;
}

/** Forgets the conversation. Returns `[]` so callers can assign it directly. */
export function clearChat(): ChatMessage[] {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // If it cannot be removed it could not have been written.
  }
  return [];
}

/**
 * The shape `/api/support/ask` wants: at most 10 turns, roles not authors.
 *
 * The greeting is excluded. It is UI copy this app wrote, not something the
 * visitor said or the model produced, and feeding it back as history would ask
 * the model to treat its own furniture as context.
 */
export function toAskHistory(
  messages: ChatMessage[],
  greeting: string
): { role: "user" | "assistant"; content: string }[] {
  return messages
    .filter((m) => !(m.from === "bot" && m.text === greeting))
    .slice(-10)
    .map((m) => ({
      role: m.from === "user" ? ("user" as const) : ("assistant" as const),
      content: m.text.slice(0, 2000),
    }));
}

/** The shape `/api/support/message` wants for a human handoff. */
export function toTranscript(
  messages: ChatMessage[]
): { from: "user" | "bot"; text: string }[] {
  return messages.slice(-12).map((m) => ({ from: m.from, text: m.text.slice(0, 2000) }));
}
