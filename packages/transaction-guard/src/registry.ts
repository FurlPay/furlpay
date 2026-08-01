import { GuardRejection } from "./rejection.js";

// ---------------------------------------------------------------------------
// The action allowlist: turning a proposal into an executable request, or
// refusing it.
//
// THE PROBLEM. An LLM — your co-pilot, a voice assistant, an MCP tool, or a
// prompt-injected response pretending to be one — may PROPOSE an action. It
// must never define executable authority. The naive integration takes
// `{ endpoint, method, body }` from the model and calls it, which is a remote
// code execution primitive wearing a JSON hat.
//
// THE SHAPE THAT WORKS. Every confirmable action is declared here with its
// exact id, endpoint, method and field schema. The request that actually goes
// out is REBUILT FROM THE REGISTRY:
//
//   • a field the model sent that is not declared is DROPPED
//   • a field whose type, range, pattern or enum disagrees REJECTS the action
//   • an endpoint or method that disagrees REJECTS the action
//   • `constants` are set by the registry and cannot be overridden
//
// Rejection happens BEFORE any confirmation is shown. A user must never be
// asked to approve something the app has already decided it will not send.
//
// WHY THIS IS WORTH A LIBRARY. We ran this same registry on three platforms —
// TypeScript, Kotlin and Swift — and they drifted. The Swift copy ended up with
// different field names, a 4× higher spending ceiling, and no pattern
// constraints at all, so an AI-proposed payment could carry any string as its
// recipient. Everything still compiled and every test passed, because each
// platform tested its own copy against itself. One implementation, imported
// everywhere, is the actual fix.
// ---------------------------------------------------------------------------

export type FieldType = "string" | "number" | "boolean";

export interface FieldSpec {
  type: FieldType;
  /** Label for a confirmation card; omit for fields not worth showing. */
  label?: string;
  /** Render as currency in the confirmation card. */
  currency?: boolean;
  /** Exact-match allowlist for enum-like strings. */
  oneOf?: readonly string[];
  /** Regex the string must match IN FULL. */
  pattern?: RegExp;
  /** Inclusive bounds for numbers. */
  min?: number;
  max?: number;
  optional?: boolean;
}

export interface ActionSpec {
  id: string;
  title: string;
  /** Path or route key, exactly as your client will call it. */
  endpoint: string;
  method?: string;
  /** Disabled actions are rejected even when otherwise well-formed. */
  enabled?: boolean;
  /** Declaration order is confirmation-card render order. */
  fields: Record<string, FieldSpec>;
  /**
   * Values the registry ALWAYS sets, whatever was proposed.
   *
   * For discriminators that decide whether money moves — a `execute: true` flag
   * on a route that also serves quotes — this is the difference between the app
   * deciding and the model deciding.
   */
  constants?: Record<string, unknown>;
}

/** An untrusted proposal, from a model or any other unprivileged source. */
export interface Proposal {
  action?: string;
  endpoint?: string;
  method?: string;
  body?: Record<string, unknown> | null;
}

export interface ConfirmationDetail {
  label: string;
  value: string;
}

export interface ResolvedAction {
  spec: ActionSpec;
  /** From the registry, never the proposal. */
  endpoint: string;
  method: string;
  /** Rebuilt from declared fields only. */
  body: Record<string, unknown>;
  /** Field-by-field, for the confirmation UI to render. */
  details: ConfirmationDetail[];
  /** The currency amount that will actually be sent, if any. */
  amount: number | null;
}

export interface RegistryOptions {
  /** Global ceiling applied to every currency field. */
  maxAmount?: number;
  /** Formats a currency value for the confirmation card. */
  formatAmount?: (value: number) => string;
}

/**
 * An allowlist of actions a model may propose.
 *
 * Construct once at startup; `resolve` is pure and safe to call concurrently.
 */
export class ActionRegistry {
  private readonly byId: Map<string, ActionSpec>;
  private readonly options: RegistryOptions;

  constructor(actions: readonly ActionSpec[], options: RegistryOptions = {}) {
    this.byId = new Map(actions.map((a) => [a.id, a]));
    this.options = options;
  }

  get actions(): ActionSpec[] {
    return [...this.byId.values()];
  }

  /**
   * Validates a proposal and rebuilds it from the registry.
   *
   * @throws GuardRejection — before any confirmation UI is shown.
   */
  resolve(proposal: Proposal): ResolvedAction {
    const id = proposal?.action?.trim();
    if (!id) {
      throw new GuardRejection("unknown_action", "No action was named.");
    }

    // The id selects the spec. The endpoint NEVER does — inferring a spec from
    // a proposed endpoint would let a crafted endpoint pick its own validator.
    const spec = this.byId.get(id);
    if (!spec) {
      throw new GuardRejection("unknown_action", `Unknown action "${id}".`);
    }
    if (spec.enabled === false) {
      throw new GuardRejection("action_disabled", `The "${spec.title}" action is disabled.`);
    }

    const method = spec.method ?? "POST";
    if (proposal.endpoint !== undefined && normalize(proposal.endpoint) !== normalize(spec.endpoint)) {
      throw new GuardRejection(
        "endpoint_mismatch",
        `Endpoint doesn't match "${spec.id}" — refusing to execute.`
      );
    }
    if ((proposal.method ?? method).toUpperCase() !== method.toUpperCase()) {
      throw new GuardRejection(
        "method_mismatch",
        `Method doesn't match "${spec.id}" — refusing to execute.`
      );
    }

    const proposed = proposal.body;
    if (proposed === null || proposed === undefined || typeof proposed !== "object" || Array.isArray(proposed)) {
      throw new GuardRejection("malformed_body", "Malformed action body.");
    }

    const body: Record<string, unknown> = {};
    const details: ConfirmationDetail[] = [];
    let amount: number | null = null;

    for (const [key, field] of Object.entries(spec.fields)) {
      const raw = (proposed as Record<string, unknown>)[key];

      if (raw === undefined || raw === null) {
        if (field.optional) continue;
        throw new GuardRejection("missing_field", `Missing "${key}".`);
      }

      // Strict types: a string "50" where a number is declared is the wrong
      // type, not a number to coerce. Coercion is how "1e9" becomes a billion.
      if (typeof raw !== field.type) {
        throw new GuardRejection("invalid_field", `Invalid "${key}".`);
      }

      if (field.type === "number") {
        const n = raw as number;
        if (!Number.isFinite(n)) {
          throw new GuardRejection("invalid_field", `Invalid "${key}".`);
        }
        if (field.min !== undefined && n < field.min) {
          throw new GuardRejection("amount_out_of_range", `"${key}" is below the minimum.`);
        }
        const ceiling = Math.min(field.max ?? Infinity, this.options.maxAmount ?? Infinity);
        if (n > ceiling) {
          throw new GuardRejection(
            "amount_out_of_range",
            `That amount is above the limit — use the full flow instead.`
          );
        }
        if (field.currency) amount = n;
      }

      if (field.type === "string") {
        const s = raw as string;
        // Exact match, not case-insensitive: forwarding a differently-cased
        // value than the one compared would send something the server's own
        // enum rejects.
        if (field.oneOf && !field.oneOf.includes(s)) {
          throw new GuardRejection("invalid_field", `Unsupported "${key}" value.`);
        }
        if (field.pattern && !fullMatch(field.pattern, s)) {
          throw new GuardRejection("invalid_field", `Invalid "${key}" value.`);
        }
      }

      body[key] = raw;
      if (field.label) {
        details.push({
          label: field.label,
          value:
            field.type === "number" && field.currency
              ? (this.options.formatAmount ?? defaultFormat)(raw as number)
              : String(raw),
        });
      }
    }

    // Constants last, so nothing validated above can have shadowed one.
    Object.assign(body, spec.constants ?? {});

    return { spec, endpoint: spec.endpoint, method, body, details, amount };
  }
}

/**
 * Anchors a pattern so a partial match cannot pass.
 *
 * `/^0x[0-9a-f]{40}$/.test(x)` is already anchored, but a consumer may supply
 * `/[a-z]+/` and expect it to constrain the whole value. Comparing the matched
 * span to the input makes that assumption true either way.
 */
function fullMatch(pattern: RegExp, value: string): boolean {
  const match = value.match(pattern);
  return match !== null && match[0] === value;
}

/** Tolerates a leading slash or an `/api` prefix; trusts neither to select. */
function normalize(endpoint: string): string {
  let path = endpoint.trim().toLowerCase();
  const scheme = path.indexOf("://");
  if (scheme !== -1) {
    const afterHost = path.indexOf("/", scheme + 3);
    path = afterHost === -1 ? "/" : path.slice(afterHost);
  }
  if (path.startsWith("/api/")) path = path.slice(4);
  if (!path.startsWith("/")) path = "/" + path;
  while (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return path;
}

function defaultFormat(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
