"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Bot,
  Check,
  Copy,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import LandingChrome from "@/components/landing/LandingChrome";

// ---------------------------------------------------------------------------
// The credential control plane.
//
// EVERY VALUE ON THIS PAGE COMES FROM THE SERVER. There are no placeholder
// keys, no sample secrets and no invented "last used" times — a fabricated
// credential on a security page teaches the reader to distrust the real ones,
// and a fake sk_live_ with a copy button next to it is an invitation to paste
// something that will never work into something that matters.
//
// Two different primitives share this page because an operator arrives with
// one question — "what can act on my account?" — and the page is honest that
// the answer has two shapes:
//
//   API keys    a bearer secret. Whoever holds it is the caller.
//   Agent keys  an Ed25519 SIGNING key. FurlPay holds only the public half,
//               so there is no secret to leak, and every request carries a
//               signature over its own body. Authority is bounded by a spend
//               policy, not by a scope list.
// ---------------------------------------------------------------------------

const SCOPE_GROUPS: { resource: string; scopes: { id: ApiScope; action: string }[] }[] = [
  { resource: "Payments", scopes: [{ id: "payments:read", action: "Read" }, { id: "payments:create", action: "Create" }] },
  { resource: "Transfers", scopes: [{ id: "transfers:read", action: "Read" }, { id: "transfers:create", action: "Create" }] },
  { resource: "Wallets", scopes: [{ id: "wallets:read", action: "Read" }] },
  { resource: "Transactions", scopes: [{ id: "transactions:read", action: "Read" }] },
  { resource: "Cards", scopes: [{ id: "cards:read", action: "Read" }, { id: "cards:freeze", action: "Freeze" }] },
  { resource: "Agents", scopes: [{ id: "agents:read", action: "Read" }, { id: "agents:manage", action: "Manage" }] },
  { resource: "Webhooks", scopes: [{ id: "webhooks:read", action: "Read" }, { id: "webhooks:manage", action: "Manage" }] },
  { resource: "Ledger", scopes: [{ id: "ledger:read", action: "Read" }] },
];

type ApiScope =
  | "payments:read" | "payments:create" | "transfers:read" | "transfers:create"
  | "wallets:read" | "transactions:read" | "cards:read" | "cards:freeze"
  | "agents:read" | "agents:manage" | "webhooks:read" | "webhooks:manage" | "ledger:read";

interface ApiKey {
  keyId: string;
  name: string;
  prefix: "sk" | "pk" | "rk";
  environment: "test" | "live";
  masked: string;
  scopes: ApiScope[];
  status: "active" | "revoked" | "expired";
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  lastUsedRoute: string | null;
  ipAllowlist: string[];
  originAllowlist: string[];
  rotationGraceUntil: string | null;
  rotatedAt: string | null;
}

interface AgentKey {
  keyId: string;
  name: string;
  status: "active" | "revoked";
  createdAt: string;
  policy: {
    perTxLimitUsd: number;
    dailyBudgetUsd: number;
    allowedCategories: string[];
    expiresAt?: string;
  };
}

interface Finding {
  severity: "warn" | "info";
  code: string;
  message: string;
  keyId?: string;
}

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n % 1 === 0 ? 0 : 2 });

function relative(iso: string | null): string {
  if (!iso) return "Never";
  const delta = Date.now() - Date.parse(iso);
  if (delta < 60_000) return "Just now";
  const mins = Math.floor(delta / 60_000);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const dateOnly = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export default function KeysPage() {
  const [env, setEnv] = useState<"test" | "live">("test");
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [agentKeys, setAgentKeys] = useState<AgentKey[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "revoked" | "expired">("all");
  const [creating, setCreating] = useState(false);
  const [issued, setIssued] = useState<{ secret: string; key: ApiKey; rotated?: boolean } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/developer/keys", { cache: "no-store" });
      if (res.status === 401) {
        setNeedsAuth(true);
        setKeys([]);
        return;
      }
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data = await res.json();
      setKeys(data.keys ?? []);
      setAgentKeys(data.agentKeys ?? []);
      setFindings(data.findings ?? []);
    } catch (e) {
      // A load failure says so. Falling back to sample rows here would be
      // indistinguishable from real credentials on exactly the page where
      // that confusion is most expensive.
      setError((e as Error).message);
      setKeys([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const envKeys = useMemo(() => (keys ?? []).filter((k) => k.environment === env), [keys, env]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return envKeys.filter((k) => {
      if (statusFilter !== "all" && k.status !== statusFilter) return false;
      if (!q) return true;
      return (
        k.name.toLowerCase().includes(q) ||
        k.masked.toLowerCase().includes(q) ||
        k.prefix.includes(q)
      );
    });
  }, [envKeys, query, statusFilter]);

  const counts = useMemo(
    () => ({
      active: envKeys.filter((k) => k.status === "active").length,
      restricted: envKeys.filter((k) => k.prefix === "rk" && k.status === "active").length,
      agent: agentKeys.filter((a) => a.status === "active").length,
      revoked: envKeys.filter((k) => k.status === "revoked").length,
    }),
    [envKeys, agentKeys]
  );

  const lastActivity = useMemo(() => {
    const stamps = envKeys.map((k) => k.lastUsedAt).filter((v): v is string => Boolean(v));
    if (stamps.length === 0) return null;
    return stamps.sort((a, b) => Date.parse(b) - Date.parse(a))[0];
  }, [envKeys]);

  async function revoke(keyId: string, name: string) {
    if (!confirm(`Revoke "${name}"?\n\nThis immediately stops the credential from authenticating with FurlPay. It cannot be undone.`)) return;
    const res = await fetch(`/api/developer/keys/${keyId}`, { method: "DELETE" });
    if (res.ok) void load();
    else setError("Could not revoke that key.");
  }

  async function rotate(key: ApiKey) {
    const choice = prompt(
      `Rotate "${key.name}"?\n\nA new secret is issued now. Choose how long the CURRENT secret keeps working so you can deploy without downtime.\n\nEnter: 0 (immediately), 1 (1 hour), 24 (24 hours), or 168 (7 days)`,
      "24"
    );
    if (choice === null) return;
    const hours = Number(choice);
    const map: Record<number, number> = { 0: 0, 1: 3_600, 24: 86_400, 168: 604_800 };
    if (!(hours in map)) {
      setError("Rotation cancelled: grace period must be 0, 1, 24 or 168 hours.");
      return;
    }
    const res = await fetch(`/api/developer/keys/${key.keyId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "rotate", graceSeconds: map[hours] }),
    });
    if (!res.ok) {
      setError("Could not rotate that key.");
      return;
    }
    const data = await res.json();
    setIssued({ secret: data.secret, key: data.key, rotated: true });
    void load();
  }

  return (
    <div className="min-h-screen bg-oled">
      <LandingChrome />
      <main className="section pb-24 pt-12">
        <Header env={env} setEnv={setEnv} onCreate={() => setCreating(true)} />

        {env === "live" && (
          <div className="mt-5 flex items-start gap-3 rounded-2xl border border-amber-400/25 bg-amber-400/[0.06] px-4 py-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden />
            <p className="text-[13px] text-amber-100/90">
              <strong className="font-semibold text-amber-200">Live mode.</strong> Credentials created here
              reach real financial infrastructure and move real money.
            </p>
          </div>
        )}

        {needsAuth && <SignInNotice />}
        {error && <ErrorNotice message={error} onRetry={() => void load()} />}

        {!needsAuth && (
          <>
            <SecurityStatus
              loading={keys === null}
              counts={counts}
              lastActivity={lastActivity}
              findings={findings}
            />

            <AgentKeySection keys={agentKeys} />

            <section className="mt-12">
              <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-[18px] font-bold tracking-tight">API keys</h2>
                  <p className="mt-0.5 max-w-2xl text-[13px] text-textSecondary">
                    Bearer credentials for your own servers and clients. Whoever holds the secret is the caller,
                    so scope them narrowly and rotate them on a schedule.
                  </p>
                </div>
              </div>

              <Filters
                query={query}
                setQuery={setQuery}
                statusFilter={statusFilter}
                setStatusFilter={setStatusFilter}
                total={envKeys.length}
                shown={visible.length}
              />

              <KeyList
                loading={keys === null}
                keys={visible}
                anyInEnv={envKeys.length > 0}
                env={env}
                onCreate={() => setCreating(true)}
                onRevoke={revoke}
                onRotate={rotate}
              />
            </section>

            <PrefixLegend />
          </>
        )}
      </main>

      {creating && (
        <CreateKeyModal
          env={env}
          onClose={() => setCreating(false)}
          onCreated={(secret, key) => {
            setCreating(false);
            setIssued({ secret, key });
            void load();
          }}
        />
      )}

      {issued && <RevealSecretModal issued={issued} onClose={() => setIssued(null)} />}
    </div>
  );
}

// ── header ─────────────────────────────────────────────────────────────────

function Header({
  env,
  setEnv,
  onCreate,
}: {
  env: "test" | "live";
  setEnv: (e: "test" | "live") => void;
  onCreate: () => void;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-[30px] font-extrabold tracking-tighter sm:text-[38px]">API keys</h1>
        <p className="mt-1 max-w-2xl text-[14px] text-textSecondary">
          Secure credentials and programmable authorization for your applications and AI agents.
        </p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
          <Link href="/docs/quickstart" className="text-neon hover:underline">Documentation</Link>
          <Link href="/docs/architecture/authentication" className="text-neon hover:underline">Security guide</Link>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label="Environment"
          className="flex rounded-pill border border-white/10 bg-white/[0.03] p-1 text-[13px] font-semibold"
        >
          {(["test", "live"] as const).map((e) => (
            <button
              key={e}
              onClick={() => setEnv(e)}
              aria-pressed={env === e}
              className={`tap rounded-pill px-4 py-1.5 transition ${
                env === e
                  ? e === "live"
                    ? "bg-amber-400/20 text-amber-200"
                    : "bg-white/[0.08] text-white"
                  : "text-textSecondary hover:text-white"
              }`}
            >
              {e === "test" ? "Sandbox" : "Live"}
            </button>
          ))}
        </div>
        <button onClick={onCreate} className="tap btn-green px-4 py-2 text-[13px]">
          + Create key
        </button>
      </div>
    </div>
  );
}

// ── security status ────────────────────────────────────────────────────────

function SecurityStatus({
  loading,
  counts,
  lastActivity,
  findings,
}: {
  loading: boolean;
  counts: { active: number; restricted: number; agent: number; revoked: number };
  lastActivity: string | null;
  findings: Finding[];
}) {
  const warnings = findings.filter((f) => f.severity === "warn");
  const healthy = warnings.length === 0;

  return (
    <section className="mt-8 grid gap-4 lg:grid-cols-[1fr_1.4fr]">
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-textMuted">API security</h2>
          {!loading && (
            <span className={`inline-flex items-center gap-1.5 text-[13px] font-semibold ${healthy ? "text-neon" : "text-amber-300"}`}>
              {/* Shape as well as colour: status must survive a monochrome
                  screen and the ~8% of readers with colour-vision deficiency. */}
              {healthy ? <ShieldCheck className="h-4 w-4" aria-hidden /> : <AlertTriangle className="h-4 w-4" aria-hidden />}
              {healthy ? "Healthy" : `${warnings.length} to review`}
            </span>
          )}
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2">
          {[
            ["Active", counts.active],
            ["Restricted", counts.restricted],
            ["Agent", counts.agent],
            ["Revoked", counts.revoked],
          ].map(([label, value]) => (
            <div key={label as string} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
              <dt className="text-[11px] uppercase tracking-wide text-textMuted">{label}</dt>
              <dd className="mt-0.5 text-[20px] font-bold tabular-nums">{loading ? "—" : value}</dd>
            </div>
          ))}
        </dl>

        <p className="mt-4 text-[12px] text-textMuted">
          Last key activity: <span className="text-textSecondary">{loading ? "—" : relative(lastActivity)}</span>
        </p>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-textMuted">
          Security recommendations
        </h2>
        {loading ? (
          <p className="mt-3 text-[13px] text-textMuted">Checking…</p>
        ) : findings.length === 0 ? (
          <p className="mt-3 text-[13px] text-textSecondary">
            Nothing to address. Recommendations appear here only when they are true of a key you actually hold.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {findings.map((f, i) => (
              <li key={`${f.code}-${f.keyId ?? i}`} className="flex items-start gap-2.5 text-[13px]">
                <span
                  className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${f.severity === "warn" ? "bg-amber-400" : "bg-white/30"}`}
                  aria-hidden
                />
                <span className="text-textSecondary">
                  <span className="sr-only">{f.severity === "warn" ? "Warning: " : "Note: "}</span>
                  {f.message}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

// ── agent keys: the hero ───────────────────────────────────────────────────

function AgentKeySection({ keys }: { keys: AgentKey[] }) {
  const active = keys.filter((k) => k.status === "active");

  return (
    <section className="mt-12">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-[18px] font-bold tracking-tight">
            <Bot className="h-5 w-5 text-neon" aria-hidden />
            Agent keys
          </h2>
          <p className="mt-1 max-w-2xl text-[13px] text-textSecondary">
            Give an AI agent programmable financial authority without giving it unrestricted access to your
            account. An agent key is an Ed25519 <strong className="font-semibold text-white/90">signing</strong> key —
            FurlPay stores only the public half, so there is no bearer secret to leak.
          </p>
        </div>
        <Link href="/developer/agents" className="tap shrink-0 rounded-pill border border-white/15 px-4 py-2 text-[13px] font-semibold text-white">
          Agent console
        </Link>
      </div>

      <AuthorityChain />

      {active.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-white/12 px-5 py-10 text-center">
          <p className="text-[14px] font-semibold text-white/90">No agent keys yet</p>
          <p className="mx-auto mt-1.5 max-w-md text-[13px] text-textSecondary">
            Register an agent to give it a spending policy: a per-transaction ceiling, a daily budget and the
            categories of money movement it may initiate.
          </p>
          <Link href="/developer/agents" className="tap mt-4 inline-block btn-green px-4 py-2 text-[13px]">
            Register an agent
          </Link>
        </div>
      ) : (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {active.map((a) => (
            <AgentKeyCard key={a.keyId} agent={a} />
          ))}
        </div>
      )}
    </section>
  );
}

/** The relationship the page exists to make obvious. */
function AuthorityChain() {
  const steps = ["Agent", "Key", "Policy", "Budget", "Approval", "Payment", "Ledger"];
  return (
    <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-2 rounded-2xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
      {steps.map((s, i) => (
        <li key={s} className="flex items-center gap-1.5">
          <span className="rounded-md bg-white/[0.05] px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-textSecondary">
            {s}
          </span>
          {i < steps.length - 1 && <span className="text-textMuted" aria-hidden>→</span>}
        </li>
      ))}
    </ol>
  );
}

function AgentKeyCard({ agent }: { agent: AgentKey }) {
  const { policy } = agent;
  return (
    <article className="rounded-2xl border border-neon/20 bg-neon/[0.03] p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-bold">{agent.name}</h3>
          <code className="mt-1 block truncate font-mono text-[12px] text-neon/80">{agent.keyId}</code>
        </div>
        <StatusPill status="active" />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-textMuted">Per transaction</dt>
          <dd className="mt-0.5 text-[17px] font-bold tabular-nums">{usd(policy.perTxLimitUsd)}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-textMuted">Daily budget</dt>
          <dd className="mt-0.5 text-[17px] font-bold tabular-nums">{usd(policy.dailyBudgetUsd)}</dd>
        </div>
      </dl>

      <div className="mt-4">
        <p className="text-[11px] uppercase tracking-wide text-textMuted">Allowed</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {policy.allowedCategories.length === 0 ? (
            <span className="rounded-md border border-white/10 px-2 py-0.5 text-[11px] text-textSecondary">
              Read-only — cannot spend
            </span>
          ) : (
            policy.allowedCategories.map((c) => (
              <span key={c} className="rounded-md bg-white/[0.06] px-2 py-0.5 text-[11px] font-medium capitalize text-white/85">
                {c}
              </span>
            ))
          )}
        </div>
      </div>

      <dl className="mt-4 flex flex-wrap gap-x-5 gap-y-1 border-t border-white/[0.06] pt-3 text-[12px]">
        <div className="flex gap-1.5">
          <dt className="text-textMuted">Created</dt>
          <dd className="text-textSecondary">{dateOnly(agent.createdAt)}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-textMuted">Expires</dt>
          <dd className="text-textSecondary">{policy.expiresAt ? dateOnly(policy.expiresAt) : "Never"}</dd>
        </div>
      </dl>

      <div className="mt-4 flex flex-wrap gap-2">
        <Link href="/developer/agents" className="tap rounded-pill border border-white/15 px-3 py-1.5 text-[12px] font-semibold">
          Manage policy
        </Link>
      </div>
    </article>
  );
}

// ── filters ────────────────────────────────────────────────────────────────

function Filters({
  query,
  setQuery,
  statusFilter,
  setStatusFilter,
  total,
  shown,
}: {
  query: string;
  setQuery: (v: string) => void;
  statusFilter: "all" | "active" | "revoked" | "expired";
  setStatusFilter: (v: "all" | "active" | "revoked" | "expired") => void;
  total: number;
  shown: number;
}) {
  if (total === 0) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor="key-search">Search keys</label>
      <input
        id="key-search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name or key"
        className="min-w-[200px] flex-1 rounded-pill border border-white/10 bg-white/[0.03] px-4 py-2 text-[13px] text-white placeholder:text-textMuted focus:border-neon/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-neon/40"
      />
      <div role="group" aria-label="Filter by status" className="flex rounded-pill border border-white/10 bg-white/[0.03] p-1 text-[12px] font-semibold">
        {(["all", "active", "revoked", "expired"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            aria-pressed={statusFilter === s}
            className={`tap rounded-pill px-3 py-1 capitalize transition ${
              statusFilter === s ? "bg-white/[0.08] text-white" : "text-textSecondary hover:text-white"
            }`}
          >
            {s}
          </button>
        ))}
      </div>
      <p className="text-[12px] text-textMuted" aria-live="polite">
        {shown} of {total}
      </p>
    </div>
  );
}

// ── key list ───────────────────────────────────────────────────────────────

function KeyList({
  loading,
  keys,
  anyInEnv,
  env,
  onCreate,
  onRevoke,
  onRotate,
}: {
  loading: boolean;
  keys: ApiKey[];
  anyInEnv: boolean;
  env: "test" | "live";
  onCreate: () => void;
  onRevoke: (keyId: string, name: string) => void;
  onRotate: (key: ApiKey) => void;
}) {
  if (loading) {
    return (
      <div className="space-y-2" aria-busy="true" aria-label="Loading keys">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-[72px] animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.02]" />
        ))}
      </div>
    );
  }

  if (keys.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/12 px-5 py-12 text-center">
        <KeyRound className="mx-auto h-6 w-6 text-textMuted" aria-hidden />
        <p className="mt-3 text-[14px] font-semibold text-white/90">
          {anyInEnv ? "No keys match those filters" : `No ${env === "test" ? "sandbox" : "live"} keys yet`}
        </p>
        {!anyInEnv && (
          <>
            <p className="mx-auto mt-1.5 max-w-md text-[13px] text-textSecondary">
              Create a key to authenticate your server with the FurlPay API. The secret is shown once, at
              creation, and never again.
            </p>
            <button onClick={onCreate} className="tap mt-4 btn-green px-4 py-2 text-[13px]">
              + Create key
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {keys.map((k) => (
        <li key={k.keyId} className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-[14px] font-semibold">{k.name}</h3>
                <StatusPill status={k.status} />
                <TypePill prefix={k.prefix} />
              </div>
              <code className="mt-1.5 block font-mono text-[12.5px] text-white/70">{k.masked}</code>

              {k.scopes.length > 0 && k.prefix !== "sk" && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {k.scopes.map((s) => (
                    <span key={s} className="rounded bg-white/[0.05] px-1.5 py-0.5 font-mono text-[11px] text-textSecondary">
                      {s}
                    </span>
                  ))}
                </div>
              )}
              {k.prefix === "sk" && (
                <p className="mt-2 text-[12px] text-textMuted">Full API access</p>
              )}

              <dl className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-[12px]">
                <div className="flex gap-1.5">
                  <dt className="text-textMuted">Last used</dt>
                  <dd className="text-textSecondary">{relative(k.lastUsedAt)}</dd>
                </div>
                <div className="flex gap-1.5">
                  <dt className="text-textMuted">Created</dt>
                  <dd className="text-textSecondary">{dateOnly(k.createdAt)}</dd>
                </div>
                {k.expiresAt && (
                  <div className="flex gap-1.5">
                    <dt className="text-textMuted">Expires</dt>
                    <dd className="text-textSecondary">{dateOnly(k.expiresAt)}</dd>
                  </div>
                )}
                {k.ipAllowlist.length > 0 && (
                  <div className="flex gap-1.5">
                    <dt className="text-textMuted">IP allowlist</dt>
                    <dd className="text-textSecondary">{k.ipAllowlist.length} entr{k.ipAllowlist.length === 1 ? "y" : "ies"}</dd>
                  </div>
                )}
              </dl>

              {k.rotationGraceUntil && Date.parse(k.rotationGraceUntil) > Date.now() && (
                <p className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-amber-400/10 px-2 py-1 text-[11.5px] text-amber-200">
                  <RefreshCw className="h-3 w-3" aria-hidden />
                  Previous secret still valid until {new Date(k.rotationGraceUntil).toLocaleString()}
                </p>
              )}
            </div>

            {k.status === "active" && (
              <div className="flex shrink-0 gap-2">
                <button
                  onClick={() => onRotate(k)}
                  className="tap inline-flex items-center gap-1.5 rounded-pill border border-white/15 px-3 py-1.5 text-[12px] font-semibold text-white"
                >
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                  Rotate
                </button>
                <button
                  onClick={() => onRevoke(k.keyId, k.name)}
                  className="tap inline-flex items-center gap-1.5 rounded-pill border border-red-400/25 px-3 py-1.5 text-[12px] font-semibold text-red-300 hover:bg-red-400/10"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  Revoke
                </button>
              </div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function StatusPill({ status }: { status: "active" | "revoked" | "expired" }) {
  const style = {
    active: "border-neon/30 bg-neon/10 text-neon",
    revoked: "border-red-400/30 bg-red-400/10 text-red-300",
    expired: "border-white/15 bg-white/[0.05] text-textSecondary",
  }[status];
  return (
    <span className={`rounded-md border px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wide ${style}`}>
      {status}
    </span>
  );
}

function TypePill({ prefix }: { prefix: "sk" | "pk" | "rk" }) {
  const label = { sk: "Secret", pk: "Publishable", rk: "Restricted" }[prefix];
  return (
    <span className="rounded-md border border-white/10 px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-textMuted">
      {label}
    </span>
  );
}

// ── create flow ────────────────────────────────────────────────────────────

const KEY_TYPES = [
  {
    prefix: "rk" as const,
    title: "Restricted key",
    blurb: "For a service that needs only part of the API.",
    detail: "You choose exactly which resources and actions it may reach.",
    level: "Recommended",
  },
  {
    prefix: "sk" as const,
    title: "Secret key",
    blurb: "For a trusted server you fully control.",
    detail: "Full API access. Never ship it to a browser or commit it.",
    level: "Highest privilege",
  },
  {
    prefix: "pk" as const,
    title: "Publishable key",
    blurb: "For client-side code.",
    detail: "Visible to anyone who loads your page, so it can only read public payment data.",
    level: "Public",
  },
];

function CreateKeyModal({
  env,
  onClose,
  onCreated,
}: {
  env: "test" | "live";
  onClose: () => void;
  onCreated: (secret: string, key: ApiKey) => void;
}) {
  const [step, setStep] = useState(1);
  const [prefix, setPrefix] = useState<"sk" | "pk" | "rk">("rk");
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<Set<ApiScope>>(new Set());
  const [expiry, setExpiry] = useState<"never" | "7" | "30" | "90">("never");
  const [ips, setIps] = useState("");
  const [origins, setOrigins] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const needsScopes = prefix === "rk";
  const lastStep = needsScopes ? 4 : 3;

  function toggle(s: ApiScope) {
    setScopes((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  async function submit() {
    setSubmitting(true);
    setErr(null);
    const days = expiry === "never" ? null : Number(expiry);
    const body = {
      name: name.trim(),
      prefix,
      environment: env,
      scopes: [...scopes],
      expiresAt: days ? new Date(Date.now() + days * 86_400_000).toISOString() : null,
      ipAllowlist: ips.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean),
      originAllowlist: origins.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean),
    };
    try {
      const res = await fetch("/api/developer/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? "Could not create that key.");
      onCreated(data.secret, data.key);
    } catch (e) {
      setErr((e as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <Modal onClose={onClose} labelledBy="create-key-title">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="create-key-title" className="text-[19px] font-bold tracking-tight">Create a key</h2>
          <p className="mt-0.5 text-[13px] text-textSecondary">
            Step {step} of {lastStep} · {env === "live" ? "Live" : "Sandbox"} environment
          </p>
        </div>
        <button onClick={onClose} aria-label="Close" className="tap rounded-md p-1 text-textMuted hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-5 min-h-[280px]">
        {step === 1 && (
          <fieldset>
            <legend className="text-[13px] font-semibold text-white/90">What kind of key do you need?</legend>
            <div className="mt-3 space-y-2">
              {KEY_TYPES.map((t) => (
                <label
                  key={t.prefix}
                  className={`flex cursor-pointer gap-3 rounded-xl border p-3.5 transition ${
                    prefix === t.prefix ? "border-neon/40 bg-neon/[0.05]" : "border-white/10 hover:border-white/20"
                  }`}
                >
                  <input
                    type="radio"
                    name="keytype"
                    checked={prefix === t.prefix}
                    onChange={() => setPrefix(t.prefix)}
                    className="mt-1 accent-neon"
                  />
                  <span>
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-[14px] font-semibold">{t.title}</span>
                      <span className="rounded border border-white/10 px-1.5 py-0.5 text-[10.5px] uppercase tracking-wide text-textMuted">
                        {t.level}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-[13px] text-textSecondary">{t.blurb}</span>
                    <span className="mt-0.5 block text-[12px] text-textMuted">{t.detail}</span>
                  </span>
                </label>
              ))}
            </div>
            <p className="mt-3 rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-2.5 text-[12px] text-textMuted">
              Looking for an <strong className="font-semibold text-textSecondary">agent key</strong>? Agents
              authenticate by signing requests, not with a bearer secret. Register one in the{" "}
              <Link href="/developer/agents" className="text-neon hover:underline">Agent console</Link>.
            </p>
          </fieldset>
        )}

        {step === 2 && (
          <div>
            <label htmlFor="key-name" className="text-[13px] font-semibold text-white/90">
              Name this key
            </label>
            <p className="mt-0.5 text-[12.5px] text-textSecondary">
              Name it after where it runs. In six months this is the only clue you will have about what breaks
              when you revoke it.
            </p>
            <input
              id="key-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Production backend"
              maxLength={64}
              autoFocus
              className="mt-3 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-[14px] text-white placeholder:text-textMuted focus:border-neon/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-neon/40"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {["Production backend", "Webhook worker", "Analytics service"].map((s) => (
                <button
                  key={s}
                  onClick={() => setName(s)}
                  className="tap rounded-md border border-white/10 px-2 py-1 text-[11.5px] text-textSecondary hover:text-white"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 3 && needsScopes && (
          <fieldset>
            <legend className="text-[13px] font-semibold text-white/90">What may this key do?</legend>
            <p className="mt-0.5 text-[12.5px] text-textSecondary">
              Every permission here is checked by the server on each request. Grant only what this service
              actually calls.
            </p>
            <div className="mt-3 space-y-2">
              {SCOPE_GROUPS.map((g) => (
                <div key={g.resource} className="rounded-xl border border-white/[0.08] px-3.5 py-2.5">
                  <p className="text-[12.5px] font-semibold text-white/85">{g.resource}</p>
                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
                    {g.scopes.map((s) => (
                      <label key={s.id} className="flex cursor-pointer items-center gap-2 text-[13px] text-textSecondary">
                        <input
                          type="checkbox"
                          checked={scopes.has(s.id)}
                          onChange={() => toggle(s.id)}
                          className="accent-neon"
                        />
                        {s.action}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </fieldset>
        )}

        {step === lastStep && (
          <div className="space-y-4">
            <div>
              <p className="text-[13px] font-semibold text-white/90">Expiration</p>
              <p className="mt-0.5 text-[12.5px] text-textSecondary">
                Enforced by the server at every request, not by a timer in this page.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {([["never", "Never"], ["7", "7 days"], ["30", "30 days"], ["90", "90 days"]] as const).map(
                  ([v, label]) => (
                    <button
                      key={v}
                      onClick={() => setExpiry(v)}
                      aria-pressed={expiry === v}
                      className={`tap rounded-pill border px-3 py-1.5 text-[12.5px] font-semibold transition ${
                        expiry === v ? "border-neon/40 bg-neon/10 text-neon" : "border-white/12 text-textSecondary hover:text-white"
                      }`}
                    >
                      {label}
                    </button>
                  )
                )}
              </div>
            </div>

            {prefix !== "pk" ? (
              <div>
                <label htmlFor="ip-allowlist" className="text-[13px] font-semibold text-white/90">
                  IP allowlist <span className="font-normal text-textMuted">(optional)</span>
                </label>
                <p className="mt-0.5 text-[12.5px] text-textSecondary">
                  Requests using this key are accepted only from these addresses. IPv4, IPv6 and CIDR ranges.
                </p>
                <textarea
                  id="ip-allowlist"
                  value={ips}
                  onChange={(e) => setIps(e.target.value)}
                  rows={2}
                  placeholder="203.0.113.10, 10.0.0.0/24"
                  className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 font-mono text-[13px] text-white placeholder:text-textMuted focus:border-neon/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-neon/40"
                />
              </div>
            ) : (
              <div>
                <label htmlFor="origin-allowlist" className="text-[13px] font-semibold text-white/90">
                  Allowed origins <span className="font-normal text-textMuted">(optional)</span>
                </label>
                <p className="mt-0.5 text-[12.5px] text-textSecondary">
                  Browsers will send this key only from these sites. Defence in depth, not access control — an
                  Origin header is asserted by the browser and anyone can send their own.
                </p>
                <textarea
                  id="origin-allowlist"
                  value={origins}
                  onChange={(e) => setOrigins(e.target.value)}
                  rows={2}
                  placeholder="example.com, *.example.com"
                  className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 font-mono text-[13px] text-white placeholder:text-textMuted focus:border-neon/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-neon/40"
                />
              </div>
            )}

            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3.5">
              <p className="text-[12px] uppercase tracking-wide text-textMuted">Review</p>
              <p className="mt-1.5 text-[13px] text-textSecondary">
                <strong className="font-semibold text-white/90">{name.trim() || "Untitled"}</strong> — a{" "}
                {KEY_TYPES.find((t) => t.prefix === prefix)!.title.toLowerCase()} in{" "}
                <strong className="font-semibold text-white/90">{env === "live" ? "Live" : "Sandbox"}</strong>,{" "}
                {prefix === "sk"
                  ? "with full API access"
                  : prefix === "pk"
                    ? "readable from the browser"
                    : `granting ${scopes.size} permission${scopes.size === 1 ? "" : "s"}`}
                {expiry === "never" ? ", never expiring" : `, expiring in ${expiry} days`}.
              </p>
            </div>
          </div>
        )}
      </div>

      {err && (
        <p role="alert" className="mt-3 rounded-xl border border-red-400/25 bg-red-400/[0.07] px-3 py-2 text-[13px] text-red-200">
          {err}
        </p>
      )}

      <div className="mt-5 flex items-center justify-between gap-3 border-t border-white/[0.06] pt-4">
        <button
          onClick={() => (step === 1 ? onClose() : setStep((s) => (s === lastStep && !needsScopes ? 2 : s - 1)))}
          className="tap rounded-pill border border-white/15 px-4 py-2 text-[13px] font-semibold text-white"
        >
          {step === 1 ? "Cancel" : "Back"}
        </button>
        {step < lastStep ? (
          <button
            onClick={() => setStep((s) => (s === 2 && !needsScopes ? lastStep : s + 1))}
            disabled={step === 2 && name.trim().length === 0}
            className="tap btn-green px-4 py-2 text-[13px] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Continue
          </button>
        ) : (
          <button
            onClick={submit}
            disabled={submitting || name.trim().length === 0 || (needsScopes && scopes.size === 0)}
            className="tap btn-green inline-flex items-center gap-2 px-4 py-2 text-[13px] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            Create key
          </button>
        )}
      </div>
    </Modal>
  );
}

// ── one-time reveal ────────────────────────────────────────────────────────

function RevealSecretModal({
  issued,
  onClose,
}: {
  issued: { secret: string; key: ApiKey; rotated?: boolean };
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  return (
    <Modal onClose={acknowledged ? onClose : undefined} labelledBy="reveal-title">
      <h2 id="reveal-title" className="text-[19px] font-bold tracking-tight">
        {issued.rotated ? "New secret issued" : "Key created"}
      </h2>
      <p className="mt-1 text-[13px] text-textSecondary">
        Copy <strong className="font-semibold text-white/90">{issued.key.name}</strong> now. FurlPay stores only
        a hash of this secret, so it genuinely cannot be shown again — not by this page, and not by support.
      </p>

      <div className="mt-4 rounded-xl border border-neon/25 bg-neon/[0.04] p-3.5">
        <code className="block break-all font-mono text-[13px] leading-relaxed text-white">{issued.secret}</code>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => {
            void navigator.clipboard?.writeText(issued.secret).then(() => {
              setCopied(true);
              setAcknowledged(true);
              setTimeout(() => setCopied(false), 1600);
            });
          }}
          className="tap btn-green inline-flex items-center gap-2 px-4 py-2 text-[13px]"
        >
          {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
          {copied ? "Copied" : "Copy secret"}
        </button>
        <button
          onClick={() => setAcknowledged(true)}
          className="tap rounded-pill border border-white/15 px-4 py-2 text-[13px] font-semibold text-white"
        >
          I&apos;ve saved it
        </button>
      </div>

      {issued.rotated && issued.key.rotationGraceUntil && (
        <p className="mt-3 rounded-xl border border-amber-400/25 bg-amber-400/[0.06] px-3 py-2.5 text-[12.5px] text-amber-100/90">
          Your previous secret keeps working until{" "}
          <strong className="font-semibold">{new Date(issued.key.rotationGraceUntil).toLocaleString()}</strong>.
          Deploy this one before then.
        </p>
      )}

      <div className="mt-5 border-t border-white/[0.06] pt-4">
        <button
          onClick={onClose}
          disabled={!acknowledged}
          className="tap w-full rounded-pill border border-white/15 px-4 py-2 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {acknowledged ? "Done" : "Copy the secret to continue"}
        </button>
      </div>
    </Modal>
  );
}

// ── shell ──────────────────────────────────────────────────────────────────

function Modal({
  children,
  onClose,
  labelledBy,
}: {
  children: React.ReactNode;
  onClose?: () => void;
  labelledBy: string;
}) {
  useEffect(() => {
    // A modal that leaves the page scrolling behind it reads as an overlay,
    // not a step you must finish.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-6">
      {/* The backdrop dismisses only when dismissal is allowed: the reveal
          modal withholds it until the secret has been copied. */}
      <div className="absolute inset-0" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className="relative max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-white/12 bg-[#0B0B0D] p-5 sm:rounded-3xl sm:p-6"
      >
        {children}
      </div>
    </div>
  );
}

function SignInNotice() {
  return (
    <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.02] px-5 py-10 text-center">
      <KeyRound className="mx-auto h-6 w-6 text-textMuted" aria-hidden />
      <p className="mt-3 text-[15px] font-semibold">Sign in to manage your keys</p>
      <p className="mx-auto mt-1.5 max-w-md text-[13px] text-textSecondary">
        API keys are bound to your account. This page shows only credentials you own — there is nothing to
        preview signed out.
      </p>
      <Link href="/login?next=/developer/keys" className="tap mt-4 inline-block btn-green px-5 py-2 text-[13px]">
        Sign in
      </Link>
    </div>
  );
}

function ErrorNotice({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-400/25 bg-red-400/[0.06] px-4 py-3">
      <p className="text-[13px] text-red-200">Could not load your keys: {message}</p>
      <button onClick={onRetry} className="tap rounded-pill border border-red-400/30 px-3 py-1.5 text-[12.5px] font-semibold text-red-200">
        Retry
      </button>
    </div>
  );
}

function PrefixLegend() {
  const rows: [string, string][] = [
    ["sk_live_ / sk_test_", "Secret — full API access. Server-side only."],
    ["rk_live_ / rk_test_", "Restricted — only the permissions you granted."],
    ["pk_live_ / pk_test_", "Publishable — safe in client code. Public payment data only."],
  ];
  return (
    <section className="mt-12">
      <h2 className="mb-3 flex items-center gap-2 text-[16px] font-bold tracking-tight">
        <KeyRound className="h-5 w-5 text-neon" aria-hidden /> Key prefixes
      </h2>
      <div className="divide-y divide-white/[0.06] overflow-hidden rounded-2xl border border-white/10 text-[13px]">
        {rows.map(([p, d]) => (
          <div key={p} className="grid grid-cols-1 gap-1 px-5 py-3 sm:grid-cols-[230px_1fr]">
            <code className="font-mono text-neon">{p}</code>
            <span className="text-textMuted">{d}</span>
          </div>
        ))}
        <div className="grid grid-cols-1 gap-1 px-5 py-3 sm:grid-cols-[230px_1fr]">
          <code className="font-mono text-white/70">agent_…</code>
          <span className="text-textMuted">
            Agent — an Ed25519 <strong className="font-semibold text-textSecondary">public</strong> key id, not a
            secret. Requests are signed (RFC 9421); authority comes from the spend policy.
          </span>
        </div>
      </div>
    </section>
  );
}
