// ---------------------------------------------------------------------------
// Production guard for destructive operational scripts.
//
// WHY THIS EXISTS — a real near-miss, twice:
//   apps/web/.env.local points at Supabase project `iyarllmcednkbekweucd`,
//   which is PRODUCTION (furlpay.com runs on it). Every rollout document says
//   "apply to staging". A prior session recorded the same confusion in a note;
//   a note is not a control, and the mistake was about to repeat.
//
//   verify-ledger.mjs is DESTRUCTIVE by design: it places real buy and sell
//   orders and inserts corporate actions. Run against prod, that writes to
//   live user positions.
//
// So: refuse to run against a known production project unless an operator
// explicitly opts in, and make the target environment visible in the command
// rather than inherited from ambient config.
//
//   node script.mjs --env=staging        # loads .env.staging
//   node script.mjs                      # falls back to .env.local (guarded)
//   ALLOW_PRODUCTION_LEDGER_TESTS=true   # conscious override
// ---------------------------------------------------------------------------
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Supabase project refs that are PRODUCTION.
 *
 * Extend via PROD_PROJECT_REFS (comma-separated) rather than editing this —
 * a deployment that adds a prod project should not need a code change to be
 * protected.
 */
const PROD_REFS = new Set(
  ["iyarllmcednkbekweucd", ...(process.env.PROD_PROJECT_REFS || "").split(",")]
    .map((r) => r.trim())
    .filter(Boolean)
);

const OVERRIDE = "ALLOW_PRODUCTION_LEDGER_TESTS";

/** Parse `--env=staging` → ".env.staging"; default ".env.local". */
export function envFileFromArgs(argv = process.argv) {
  const flag = (argv.find((a) => a.startsWith("--env=")) || "").split("=")[1];
  return flag ? `.env.${flag}` : ".env.local";
}

/** Load an env file WITHOUT overwriting anything already exported, so an
 *  explicit `SUPABASE_URL=... node script` always wins over the file. */
export function loadEnvFile(fileName) {
  const file = join(WEB_ROOT, fileName);
  if (!existsSync(file)) return { loaded: false, file };
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return { loaded: true, file };
}

/** Supabase project ref from a project URL (https://<ref>.supabase.co). */
export function refFromUrl(url) {
  const m = /https?:\/\/([a-z0-9]+)\.supabase\.co/i.exec(url || "");
  return m ? m[1] : null;
}

/**
 * Abort unless it is safe to write to the configured project.
 *
 * FAILS CLOSED on several independent signals — one bad reading should not be
 * enough to reach production:
 *   - project ref appears in PROD_REFS
 *   - the URL is literally the production host
 *   - NODE_ENV / VERCEL_ENV says production
 *   - the ref cannot be determined at all (unknown target = unsafe target)
 *
 * @param {string} scriptName  shown in the refusal message
 * @param {{ destructive?: boolean }} opts  destructive scripts warn harder
 */
export function assertSafeTarget(scriptName, opts = {}) {
  const url = process.env.SUPABASE_URL || "";
  const ref = refFromUrl(url);
  const override = String(process.env[OVERRIDE] || "").toLowerCase() === "true";

  const signals = [];
  if (ref && PROD_REFS.has(ref)) signals.push(`project ref '${ref}' is a known PRODUCTION project`);
  if (/furlpay\.com/i.test(url)) signals.push("SUPABASE_URL points at the furlpay.com host");
  if (process.env.NODE_ENV === "production") signals.push("NODE_ENV=production");
  if (process.env.VERCEL_ENV === "production") signals.push("VERCEL_ENV=production");
  // Unknown target is an unsafe target: if the ref cannot be read, the guard
  // cannot prove this is not production.
  if (!ref) signals.push(`could not determine a project ref from SUPABASE_URL (${url || "unset"})`);

  if (!signals.length) {
    console.log(`  target: ${ref} ${opts.destructive ? "(destructive script)" : ""}`);
    return { ref, url };
  }

  if (override) {
    // The override alone is NOT sufficient. A single env var is too easy to
    // acquire by accident — inherited from a parent shell, left in a CI job
    // definition, copied from a runbook. Requiring the operator to ALSO name
    // the exact project means production can only be reached by someone who
    // already knows which project they are about to write to.
    //
    // Note this also closes the undeterminable-ref case for free: if `ref` is
    // null, no value of EXPECTED_PROJECT_REF can match it, so the override
    // cannot wave through a target the guard could not identify.
    const expected = (process.env.EXPECTED_PROJECT_REF || "").trim();
    if (!expected || expected !== ref) {
      console.error(
        `\nREFUSING TO RUN: ${scriptName}\n\n` +
          `  ${OVERRIDE}=true was set, but that is not enough on its own.\n` +
          `  Overriding a protected target requires BOTH:\n\n` +
          `      ${OVERRIDE}=true\n` +
          `      EXPECTED_PROJECT_REF=${ref || "<the project you intend>"}\n\n` +
          `  Currently EXPECTED_PROJECT_REF=${expected || "(unset)"} and the\n` +
          `  configured target is '${ref || "(undeterminable)"}'.\n\n` +
          `  Naming the project is the point: it cannot be inherited from an\n` +
          `  ambient shell or a stale CI definition by accident.\n`
      );
      process.exit(1);
    }

    const line = "=".repeat(41);
    console.warn(
      `\n${line}\n` +
        `PRODUCTION LEDGER OPERATION\n` +
        `Project: ${ref}\n` +
        (opts.destructive
          ? `Writes will modify live financial data.\n`
          : `This script writes to this project.\n`) +
        `${line}\n\n` +
        `Overridden despite:\n` +
        signals.map((s) => `  - ${s}`).join("\n") +
        `\n`
    );
    return { ref, url, overridden: true };
  }

  console.error(
    `\nREFUSING TO RUN: ${scriptName}\n\n` +
      `  This script performs WRITES against Supabase.\n` +
      `  Refusing because:\n` +
      signals.map((s) => `    - ${s}`).join("\n") +
      `\n\n  Target URL: ${url || "(unset)"}\n` +
      `\n  Point it at staging instead — the environment should be VISIBLE in\n` +
      `  the command, not inherited from .env.local:\n\n` +
      `      node ${scriptName} --env=staging\n\n` +
      `  or supply the target explicitly:\n\n` +
      `      SUPABASE_URL=https://<staging-ref>.supabase.co \\\n` +
      `      SUPABASE_SERVICE_ROLE_KEY=<staging key> \\\n` +
      `        node ${scriptName}\n\n` +
      `  If you genuinely intend to run against this project, make it a\n` +
      `  conscious decision:\n\n` +
      `      ${OVERRIDE}=true node ${scriptName}\n`
  );
  process.exit(1);
}

/**
 * Classify a Supabase key WITHOUT trusting the variable it arrived in.
 *
 * Two formats are in circulation and this repo has both — staging still issues
 * legacy JWTs, production uses the newer opaque keys:
 *   eyJ...            legacy JWT; the `role` claim is authoritative
 *   sb_secret_...      new-format secret (service-role equivalent)
 *   sb_publishable_... new-format publishable (anon equivalent)
 *
 * Returns "service_role" only when that is positively established. Anything
 * unrecognised is reported as such rather than assumed safe.
 */
export function serviceRoleKeyKind(key) {
  const k = String(key || "").trim();
  if (!k) return "empty";
  if (k.startsWith("sb_publishable_")) return "publishable (anon-equivalent)";
  if (k.startsWith("sb_secret_")) return "service_role";
  if (k.startsWith("eyJ")) {
    try {
      const body = k.split(".")[1];
      const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
      if (claims.role === "service_role") return "service_role";
      return `JWT with role='${claims.role ?? "(none)"}'`;
    } catch {
      return "malformed JWT";
    }
  }
  return "unrecognised key format";
}

/**
 * Confirm the CREDENTIALS actually belong to the project the URL names.
 *
 * The static guard above only inspects SUPABASE_URL. It cannot catch config
 * DRIFT — a `.env.staging` that names the staging host but carries production
 * credentials, or the reverse. Supabase's newer key format is not a JWT, so
 * the project cannot be decoded from the key offline; the only reliable check
 * is to ask the endpoint.
 *
 * One harmless authenticated read. A 401/403 means the key does not belong to
 * this project — refuse rather than discover it mid-write.
 *
 * Set EXPECTED_PROJECT_REF to pin the intended target explicitly; the guard
 * then refuses any other project even if it is not a known production ref.
 */
export async function verifyRemoteIdentity(scriptName, { ref, url }) {
  const expected = (process.env.EXPECTED_PROJECT_REF || "").trim();
  if (expected && expected !== ref) {
    console.error(
      `
REFUSING TO RUN: ${scriptName}

` +
        `  EXPECTED_PROJECT_REF=${expected}
` +
        `  but SUPABASE_URL resolves to '${ref}'.

` +
        `  The configured environment is not the one you said you intended.
`
    );
    process.exit(1);
  }

  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    console.error(`
REFUSING TO RUN: ${scriptName}
  SUPABASE_SERVICE_ROLE_KEY is unset.
`);
    process.exit(1);
  }

  // An ANON/publishable key is the dangerous case, because it does not fail —
  // RLS is enabled with zero policies, so every read returns `[]` and every
  // write is silently rejected. The backfill would report "0 accounts
  // processed" and exit 0, which is indistinguishable from a real run against
  // an empty database. Reject by key KIND, before that ambiguity can arise.
  const kind = serviceRoleKeyKind(key);
  if (kind !== "service_role") {
    console.error(
      `\nREFUSING TO RUN: ${scriptName}\n\n` +
        `  SUPABASE_SERVICE_ROLE_KEY does not hold a service-role key.\n` +
        `  Detected: ${kind}\n\n` +
        `  This would NOT fail loudly. RLS is enabled with zero policies, so a\n` +
        `  publishable/anon key reads zero rows and writes nothing — the run\n` +
        `  would report success having done nothing at all.\n\n` +
        `  Use the service_role key (Dashboard > Project Settings > API).\n`
    );
    process.exit(1);
  }

  let status = 0;
  try {
    // `users` exists in every environment (migration 0001) and limit=0 returns
    // no rows — this reads nothing and writes nothing.
    const res = await fetch(`${url}/rest/v1/users?select=id&limit=0`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15_000),
    });
    status = res.status;
  } catch (e) {
    console.error(`
REFUSING TO RUN: ${scriptName}
  Could not reach ${url}: ${e.message}
`);
    process.exit(1);
  }

  if (status === 401 || status === 403) {
    console.error(
      `
REFUSING TO RUN: ${scriptName}

` +
        `  The service-role key was REJECTED by ${ref} (HTTP ${status}).

` +
        `  The key almost certainly belongs to a DIFFERENT project than the URL
` +
        `  names — exactly the drift a URL-only check cannot see. Fix the pair
` +
        `  before running anything that writes.
`
    );
    process.exit(1);
  }

  console.log(`  identity: key accepted by ${ref} (HTTP ${status})`);
  return { ref, url, status };
}

/** Load the chosen env file and enforce the guard. Call FIRST, before any
 *  network I/O — a guard that runs after the first write is decoration. */
export async function bootstrapEnv(scriptName, opts = {}) {
  const fileName = envFileFromArgs();
  const { loaded, file } = loadEnvFile(fileName);
  console.log(`  env: ${fileName}${loaded ? "" : " (not found — using process env)"}`);
  if (fileName === ".env.local") {
    console.log(`       note: .env.local is the DEFAULT and may point at production.`);
  }
  const target = assertSafeTarget(scriptName, opts);
  // Static checks passed; now prove the credentials match the named project.
  await verifyRemoteIdentity(scriptName, target);
  return { ...target, envFile: file };
}
