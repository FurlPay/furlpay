// ---------------------------------------------------------------------------
// Co-pilot action allowlist.
//
// The /api/chat co-pilot returns `requiresConfirmation` objects carrying an
// endpoint + method + body. The client must NOT execute those blindly: AI
// output (or a compromised/prompt-injected response) may propose an action,
// but it must never define arbitrary executable authority. Every confirmable
// action is declared here — exact action id, exact endpoint, exact method,
// exact body schema — and anything that doesn't match is rejected before the
// biometric prompt is ever shown.
//
// The confirmation UI renders the structured fields from this registry (what
// will actually be sent), never only the server's free-form summary text.
// ---------------------------------------------------------------------------

/** Shape the server returns in `requiresConfirmation`. */
export interface Confirmation {
  action?: string;
  endpoint: string;
  method?: string;
  body?: Record<string, unknown>;
  summary: string;
  amountUsd?: number;
}

type FieldType = "string" | "number" | "boolean";

interface FieldSpec {
  type: FieldType;
  /** Label in the confirmation card; omit for fields not worth showing. */
  label?: string;
  /** Render as USD currency. */
  usd?: boolean;
  /** Allowed values (exact match) for enum-like strings. */
  oneOf?: readonly string[];
  /** Regex the (string) value must match. */
  pattern?: RegExp;
  /** Bounds for numbers. */
  min?: number;
  max?: number;
  optional?: boolean;
}

export interface ActionSpec {
  id: string;
  title: string;
  /** Path as passed to lib/api (no /api prefix). */
  endpoint: string;
  method: "POST";
  /** Disabled actions are rejected even if otherwise well-formed. */
  enabled: boolean;
  fields: Record<string, FieldSpec>;
}

const EVM_ADDR = /^0x[0-9a-fA-F]{40}$/;
const STABLE = ["USDC", "USDT", "EURC", "PYUSD", "DAI"] as const;
const CHAINS = ["arbitrum", "base", "polygon", "ethereum", "solana"] as const;
// Per-action USD ceiling — a co-pilot confirmation is a convenience path, not
// the place for outsized transfers. Anything bigger goes through the full flow.
const MAX_ACTION_USD = 25_000;

const REGISTRY: Record<string, ActionSpec> = {
  card_control: {
    id: "card_control",
    title: "Card control",
    endpoint: "/cards/settings",
    method: "POST",
    enabled: true,
    fields: {
      cardId: { type: "string", label: "Card", pattern: /^[\w-]{1,64}$/ },
      freeze: { type: "boolean", label: "Freeze" },
    },
  },
  earn_deposit: {
    id: "earn_deposit",
    title: "Deposit into Earn",
    endpoint: "/earn/deposit",
    method: "POST",
    enabled: true,
    fields: {
      token: { type: "string", label: "Token", oneOf: STABLE },
      amountUsd: { type: "number", label: "Amount", usd: true, min: 0.01, max: MAX_ACTION_USD },
    },
  },
  schedule_dca: {
    id: "schedule_dca",
    title: "Recurring investment",
    endpoint: "/investing/schedule",
    method: "POST",
    enabled: true,
    fields: {
      symbol: { type: "string", label: "Asset", pattern: /^[A-Z0-9.]{1,12}$/ },
      side: { type: "string", label: "Side", oneOf: ["buy", "sell"] },
      notional: { type: "number", label: "Amount", usd: true, min: 1, max: MAX_ACTION_USD },
      cadence: { type: "string", label: "Every", oneOf: ["day", "week", "month"] },
    },
  },
  place_order: {
    id: "place_order",
    title: "Investment order",
    endpoint: "/investing/order",
    method: "POST",
    enabled: true,
    fields: {
      symbol: { type: "string", label: "Asset", pattern: /^[A-Z0-9.]{1,12}$/ },
      side: { type: "string", label: "Side", oneOf: ["buy", "sell"] },
      notional: { type: "number", label: "Amount", usd: true, min: 1, max: MAX_ACTION_USD },
    },
  },
  execute_swap: {
    id: "execute_swap",
    title: "Swap",
    endpoint: "/swaps",
    method: "POST",
    enabled: true,
    fields: {
      fromToken: { type: "string", label: "From", oneOf: STABLE },
      toToken: { type: "string", label: "To", oneOf: STABLE },
      fromChain: { type: "string", label: "Chain", oneOf: CHAINS },
      toChain: { type: "string", label: "To chain", oneOf: CHAINS, optional: true },
      amountIn: { type: "number", label: "Amount", usd: true, min: 0.01, max: MAX_ACTION_USD },
    },
  },
  send_payment: {
    id: "send_payment",
    title: "Send payment",
    endpoint: "/payments/create",
    method: "POST",
    enabled: true,
    fields: {
      amount: { type: "number", label: "Amount", usd: true, min: 0.01, max: MAX_ACTION_USD },
      recipient: { type: "string", label: "Recipient", pattern: EVM_ADDR },
      sourceChain: { type: "string", label: "Chain", oneOf: CHAINS },
    },
  },
  create_support_ticket: {
    id: "create_support_ticket",
    title: "Open a support ticket",
    endpoint: "/support/tickets",
    method: "POST",
    enabled: true,
    fields: {
      category: {
        type: "string",
        label: "Category",
        oneOf: ["stablecoins", "cards", "kyc", "travel", "developers", "other"],
      },
      subject: { type: "string", label: "Subject", pattern: /^[\s\S]{4,120}$/ },
      body: { type: "string", pattern: /^[\s\S]{1,5000}$/ },
    },
  },
};

export interface ConfirmationDetail {
  label: string;
  value: string;
}

export type ResolvedConfirmation =
  | {
      ok: true;
      spec: ActionSpec;
      /** Exactly what will be sent — from the registry, never the raw payload. */
      endpoint: string;
      method: "POST";
      body: Record<string, unknown>;
      details: ConfirmationDetail[];
    }
  | { ok: false; reason: string };

function normalizeEndpoint(e: string): string {
  return e.replace(/^\/api(?=\/)/, "");
}

/**
 * Validate a server confirmation against the allowlist. Returns the executable
 * request rebuilt FROM THE REGISTRY (allowed fields only) — extra keys the
 * server sent are dropped, and any mismatch rejects the whole action.
 */
export function resolveConfirmation(c: Confirmation): ResolvedConfirmation {
  const spec = c.action ? REGISTRY[c.action] : undefined;
  if (!spec) return { ok: false, reason: `Unknown co-pilot action "${c.action ?? "(none)"}".` };
  if (!spec.enabled) return { ok: false, reason: `The "${spec.title}" action is currently disabled.` };

  if (normalizeEndpoint(c.endpoint ?? "") !== spec.endpoint) {
    return { ok: false, reason: `Endpoint mismatch for "${spec.id}" — refusing to execute.` };
  }
  if ((c.method ?? "POST") !== spec.method) {
    return { ok: false, reason: `Method mismatch for "${spec.id}" — refusing to execute.` };
  }
  const raw = c.body;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "Malformed confirmation body." };
  }

  const body: Record<string, unknown> = {};
  const details: ConfirmationDetail[] = [];
  for (const [key, field] of Object.entries(spec.fields)) {
    const value = (raw as Record<string, unknown>)[key];
    if (value === undefined || value === null) {
      if (field.optional) continue;
      return { ok: false, reason: `Missing "${key}" in the ${spec.title.toLowerCase()} details.` };
    }
    if (typeof value !== field.type) {
      return { ok: false, reason: `Invalid "${key}" in the ${spec.title.toLowerCase()} details.` };
    }
    if (field.type === "number") {
      const n = value as number;
      if (!Number.isFinite(n)) return { ok: false, reason: `Invalid "${key}" amount.` };
      if (field.min !== undefined && n < field.min) return { ok: false, reason: `"${key}" is below the minimum.` };
      if (field.max !== undefined && n > field.max) {
        return { ok: false, reason: `That amount is above the co-pilot limit — use the full flow instead.` };
      }
    }
    if (field.type === "string") {
      const s = value as string;
      if (field.oneOf && !field.oneOf.includes(s)) return { ok: false, reason: `Unsupported "${key}" value.` };
      if (field.pattern && !field.pattern.test(s)) return { ok: false, reason: `Invalid "${key}" value.` };
    }
    body[key] = value;
    if (field.label) {
      details.push({
        label: field.label,
        value: field.usd
          ? `$${(value as number).toLocaleString("en-US", { maximumFractionDigits: 2 })}`
          : String(value),
      });
    }
  }

  return { ok: true, spec, endpoint: spec.endpoint, method: spec.method, body, details };
}
