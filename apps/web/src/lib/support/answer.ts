import { retrieveKb, type KbEntry } from "./kb";
import { trackCost } from "@/lib/costTracker";
import type { TicketCategory } from "@/lib/support";

// ---------------------------------------------------------------------------
// AI support answerer — the 2026 RAG deflection pattern on our own rails:
//   retrieve relevant help articles -> ground the model ONLY on them -> answer
//   with citations, and escalate to a human instead of guessing.
//
// Mock-by-default, like the co-pilot: with no ANTHROPIC_API_KEY it degrades to
// an EXTRACTIVE answer (the retrieved article's own text + links), so the whole
// flow still works end to end at zero cost. The model, when present, only
// rephrases grounded facts — it is instructed never to invent policy, and to
// hand off when the knowledge base doesn't cover the question.
// ---------------------------------------------------------------------------

export interface SupportSource {
  title: string;
  href: string;
}

export interface SupportAnswer {
  answer: string;
  sources: SupportSource[];
  /** true when the KB covered the question — false means "no relevant article". */
  grounded: boolean;
  /** true when the user should be offered a human handoff prominently. */
  escalate: boolean;
  /** Best-guess routing category for a handoff ticket. */
  suggestedCategory: TicketCategory;
}

export interface AskTurn {
  role: "user" | "assistant";
  content: string;
}

const MODEL = process.env.COPILOT_MODEL || "claude-haiku-4-5-20251001";
const FETCH_TIMEOUT_MS = 12_000;

const SYSTEM =
  "You are FurlPay's customer-support assistant. FurlPay is a stablecoin financial app (cards, deposits, KYC, travel, developer APIs). " +
  "Answer ONLY from the ARTICLES provided — they are FurlPay's official help center. " +
  "Rules: be concise (2-4 sentences); never invent fees, limits, timings or policy that is not in the ARTICLES; " +
  "never ask for or repeat a password, seed phrase, private key or full card number; " +
  "if the ARTICLES do not answer the question, say you'll connect them with a human and do not guess. " +
  "Do not claim you performed any account action — you can only explain and, if needed, open a support ticket.";

function sourcesFrom(hits: KbEntry[]): SupportSource[] {
  return hits.map((h) => ({ title: h.title, href: h.href }));
}

/** The extractive answer used with no model key (or on model failure). */
function extractiveAnswer(hits: KbEntry[]): string {
  const top = hits[0];
  const more = hits.length > 1 ? ` See also "${hits[1].title}".` : "";
  return `${top.content}${more}\n\nIf that doesn't resolve it, I can open a ticket and a human will follow up.`;
}

async function answerWithClaude(question: string, history: AskTurn[], hits: KbEntry[]): Promise<string> {
  const articles = hits
    .map((h, i) => `ARTICLE ${i + 1} — ${h.title} (${h.href}):\n${h.content}`)
    .join("\n\n");

  const body = {
    model: MODEL,
    max_tokens: 400,
    system: SYSTEM,
    messages: [
      ...history.slice(-6).map((m) => ({ role: m.role, content: m.content })),
      {
        role: "user" as const,
        content: `ARTICLES:\n${articles}\n\nQUESTION: ${question}\n\nAnswer from the ARTICLES only.`,
      },
    ],
  };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}`);
  const json = (await res.json()) as { content?: { text?: string }[] };
  const text = json.content?.map((c) => c.text ?? "").join("").trim();
  if (!text) throw new Error("empty");
  trackCost("anthropic", "support_answer");
  return text;
}

/**
 * Answer a support question with retrieval-grounded generation.
 * `question` is the latest user turn; `history` is prior context (optional).
 */
export async function answerSupportQuestion(question: string, history: AskTurn[] = []): Promise<SupportAnswer> {
  const q = question.trim();
  const hits = retrieveKb(q, 3);

  // No relevant article — do NOT let the model freelance. Hand off.
  if (hits.length === 0) {
    return {
      answer:
        "I don't have an article that covers that, so I'd rather not guess. I can open a support ticket and a human will follow up — want me to do that?",
      sources: [],
      grounded: false,
      escalate: true,
      suggestedCategory: "other",
    };
  }

  const sources = sourcesFrom(hits);
  const suggestedCategory = hits[0].category;

  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const answer = await answerWithClaude(q, history, hits);
      return { answer, sources, grounded: true, escalate: false, suggestedCategory };
    } catch {
      // fall through to extractive — a model outage must not break support
    }
  }

  return { answer: extractiveAnswer(hits), sources, grounded: true, escalate: false, suggestedCategory };
}
