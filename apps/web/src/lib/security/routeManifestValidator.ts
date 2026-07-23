// ---------------------------------------------------------------------------
// Route manifest validator — turns security/route-manifest.json from a document
// into an executable policy.
//
// THE PROBLEM THIS SOLVES. The manifest's original test checked that every
// route on disk appeared in the file, that nothing was stale, that the class
// names were spelled correctly, and that the counts matched. All four can pass
// while a route is classified as the opposite of what it does. That is not a
// hypothetical: every `ops/*` route calls `requireOpsAdmin()` and was labelled
// PUBLIC_INTENTIONAL, so the control that exists to notice a missing admin
// guard was blind to the most dangerous endpoint in the system — the one that
// pauses and resumes every payment rail.
//
// A completeness check tells you the map has a pin for every road. It does not
// tell you the pin is in the right place.
//
// HOW IT WORKS. Each route file is parsed with the TypeScript compiler and
// reduced to the set of functions it actually CALLS — not what it imports. An
// unused import satisfies nothing, and importing `requireUser` without invoking
// it is precisely the bug worth catching. Rules are then evaluated against that
// set.
//
// WHY AST AND NOT REGEX. A regex matches `requireUser` in a comment, in a
// string, in a variable name, and in code that was commented out during
// debugging. It also cannot see that `requireOpsAdmin` appears only inside an
// import statement. The compiler already answers all of this correctly.
//
// RULES ARE DATA. Adding "every money route must call an idempotency helper" or
// "every webhook must verify a signature" is a new entry in RULES, not new
// traversal logic. Scope is expressed by classification, and each rule carries
// the sentence a developer needs to fix it.
//
// KNOWN LIMIT, STATED PLAINLY. Analysis is per FILE, matching the manifest's
// per-route granularity: a call anywhere in the module satisfies a rule, so a
// file whose GET is public and whose POST is guarded reads as guarded. Splitting
// this would require per-export flow analysis and a per-method manifest. It also
// does not follow a handler re-exported from another module; ROUTES_WITHOUT_CODE
// records any such file so it cannot pass silently.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import ts from "typescript";

export const VALID_CLASSES = [
  "AUTHENTICATED_USER",
  "ADMIN_ONLY",
  "WEBHOOK_VERIFIED",
  "PUBLIC_INTENTIONAL",
  "DEVELOPMENT_ONLY",
  "INTERNAL_ONLY",
] as const;

export type Classification = (typeof VALID_CLASSES)[number];

/**
 * One security invariant.
 *
 * `requiresAnyCall` is a disjunction: a route satisfies the rule by calling any
 * one of the listed functions. That matters because "authenticated" is reached
 * through several doors — `requireUser` for a normal session, `requireRole` for
 * a privileged one, `requireOpsAdmin` for the ops console — and all of them
 * establish a principal.
 */
export interface RouteRule {
  id: string;
  /** Classifications this rule constrains. */
  appliesTo: Classification[];
  /** Satisfied when the route calls ANY of these. */
  requiresAnyCall: string[];
  /**
   * `error` fails CI outright and may never be waived.
   * `debt` fails CI too, but may be waived by an explicit entry in the
   * known-debt register — for gaps a coarser control already mitigates.
   */
  severity: "error" | "debt";
  /** Narrows the rule beyond classification, e.g. only routes exporting a GET. */
  appliesWhen?: (facts: RouteFacts) => boolean;
  /** What the rule protects, in one line — shown on failure. */
  reason: string;
  /** The concrete edit that fixes a violation. */
  fix: string;
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** True when the module exposes a reader (GET/HEAD) to the public. */
export const exportsReadHandler = (f: RouteFacts): boolean =>
  f.methods.has("GET") || f.methods.has("HEAD");

/** True when the module exposes only mutating handlers. */
export const exportsOnlyMutating = (f: RouteFacts): boolean =>
  f.methods.size > 0 && [...f.methods].every((m) => MUTATING.has(m));

/**
 * The enforced invariants.
 *
 * WEBHOOK_VERIFIED is deliberately absent for now: signature verification is
 * spelled differently per provider (Stripe, Sumsub, Marqeta and Persona each
 * have their own helper), so a `requiresAnyCall` list would be a guess. Adding
 * it means enumerating the real helpers, not loosening the rule — and it is a
 * one-entry change once that list is known.
 */
export const RULES: RouteRule[] = [
  {
    id: "authenticated-routes-resolve-a-principal",
    appliesTo: ["AUTHENTICATED_USER"],
    requiresAnyCall: ["requireUser", "requireRole", "requireOpsAdmin"],
    severity: "error",
    reason:
      "A route classified AUTHENTICATED_USER must resolve its principal through the shared " +
      "helper. requireUser() is not a convenience wrapper: it consults the cross-instance " +
      "revocation denylist, enforces MCP connector scopes, and rejects deleted accounts. " +
      "A hand-rolled verifySession() call skips all three.",
    fix: 'add `const auth = await requireUser(req); if (!auth.ok) return auth.res;` (from "@/lib/authz")',
  },
  {
    id: "admin-routes-check-a-role",
    appliesTo: ["ADMIN_ONLY"],
    requiresAnyCall: ["requireRole", "requireOpsAdmin"],
    severity: "error",
    reason:
      "ADMIN_ONLY routes reach privileged operations — refunds, env inspection, rail pause. " +
      "Authentication alone is not enough; the role has to be checked.",
    fix: 'add `await requireRole(req, "admin")` or `await requireOpsAdmin(req)`',
  },
  {
    // The middleware baseline is explicitly gated on MUTATING_METHODS, so a
    // public GET has NO flood control whatsoever unless the route adds it.
    // This is the one that cannot be waived.
    id: "public-readers-are-rate-limited",
    appliesTo: ["PUBLIC_INTENTIONAL"],
    appliesWhen: exportsReadHandler,
    requiresAnyCall: ["rateLimitOr429"],
    severity: "error",
    reason:
      "AGENTS.md rule 2. The middleware baseline only rate-limits mutating methods, so an " +
      "unauthenticated GET has no backstop at all — it can be scraped without limit.",
    fix: 'add `const limited = await rateLimitOr429(req, "<bucket>", { limit, windowMs }); if (limited) return limited;`',
  },
  {
    // Mutating public routes DO have the 150/min/IP middleware baseline. That
    // is real mitigation, so this is debt rather than an open door — but
    // AGENTS.md still wants a budget matched to the endpoint, because one
    // global bucket cannot distinguish a price check from an SMS send.
    id: "public-mutators-have-a-per-route-budget",
    appliesTo: ["PUBLIC_INTENTIONAL"],
    appliesWhen: exportsOnlyMutating,
    requiresAnyCall: ["rateLimitOr429"],
    severity: "debt",
    reason:
      "AGENTS.md rule 2. The middleware baseline (150 mutating req/min/IP) blunts flooding, " +
      "but a shared bucket cannot price an SMS send differently from a quote lookup.",
    fix: 'add a per-route `rateLimitOr429(req, "<bucket>", { limit, windowMs })` sized to the endpoint',
  },
];

export interface RouteFacts {
  /** Route id as the manifest spells it, e.g. "ops/controls". */
  route: string;
  file: string;
  /** Every function invoked anywhere in the module. */
  calls: Set<string>;
  /** HTTP methods the module exports as handlers. */
  methods: Set<string>;
  /** True when the file declares no HTTP handler we can see. */
  handlerless: boolean;
}

export interface Violation {
  route: string;
  file: string;
  classification: Classification;
  ruleId: string;
  severity: "error" | "debt";
  expected: string[];
  reason: string;
  fix: string;
}

const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

/**
 * Collect the names of every function CALLED in a module, plus whether it
 * declares an HTTP handler.
 *
 * Import statements are skipped on purpose: an import is an intention, a call
 * is a behaviour, and only the second one protects anything.
 */
export function analyzeRouteFile(file: string): {
  calls: Set<string>;
  methods: Set<string>;
  handlerless: boolean;
} {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TS
  );

  const calls = new Set<string>();
  const exportedHandlers = new Set<string>();

  const visit = (node: ts.Node): void => {
    // Never descend into imports — `import { requireUser }` is not a call.
    if (ts.isImportDeclaration(node)) return;

    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee)) {
        calls.add(callee.text);
      } else if (ts.isPropertyAccessExpression(callee)) {
        // `guards.requireUser(req)` counts as requireUser.
        calls.add(callee.name.text);
      }
    }

    // `export async function GET() {}`
    if (ts.isFunctionDeclaration(node) && node.name && HTTP_METHODS.has(node.name.text)) {
      if (node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
        exportedHandlers.add(node.name.text);
      }
    }

    // `export const GET = ...`
    if (ts.isVariableStatement(node)) {
      const exported = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      if (exported) {
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name) && HTTP_METHODS.has(decl.name.text)) {
            exportedHandlers.add(decl.name.text);
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);
  return { calls, methods: exportedHandlers, handlerless: exportedHandlers.size === 0 };
}

/** Evaluate every rule that applies to a route against what it actually calls. */
export function checkRoute(
  facts: RouteFacts,
  classification: Classification,
  rules: RouteRule[] = RULES
): Violation[] {
  const out: Violation[] = [];
  for (const rule of rules) {
    if (!rule.appliesTo.includes(classification)) continue;
    if (rule.appliesWhen && !rule.appliesWhen(facts)) continue;
    if (rule.requiresAnyCall.some((fn) => facts.calls.has(fn))) continue;
    out.push({
      route: facts.route,
      file: facts.file,
      classification,
      ruleId: rule.id,
      severity: rule.severity,
      expected: rule.requiresAnyCall,
      reason: rule.reason,
      fix: rule.fix,
    });
  }
  return out;
}

/** Recompute the manifest's self-reported totals from the classifications. */
export function computeCounts(routes: Record<string, string>): {
  total: number;
  counts: Record<string, number>;
} {
  const counts: Record<string, number> = {};
  for (const cls of Object.values(routes)) counts[cls] = (counts[cls] ?? 0) + 1;
  // Sorted so a regenerated manifest diffs cleanly rather than reordering.
  const sorted = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
  return { total: Object.keys(routes).length, counts: sorted };
}

/** The CI report. One block per violation, each independently actionable. */
export function formatReport(violations: Violation[], discovered: number): string {
  const lines: string[] = ["", "Security Manifest Verification", ""];
  lines.push(`  ${discovered} routes discovered`);
  if (violations.length === 0) {
    lines.push("  all classifications match their implementation", "", "PASS", "");
    return lines.join("\n");
  }
  lines.push(`  ${violations.length} classification(s) contradicted by the implementation`, "");
  for (const v of violations) {
    lines.push(
      `  ${v.severity === "error" ? "FAIL " : "DEBT "} ${v.route}`,
      `        file:           ${v.file}`,
      `        manifest:       ${v.classification}`,
      `        implementation: no call to ${v.expected.join("() / ")}()`,
      `        rule:           ${v.ruleId} (${v.severity})`,
      `        why:            ${v.reason}`,
      `        fix:            ${v.fix}`,
      ""
    );
  }
  lines.push("FAIL", "");
  return lines.join("\n");
}
