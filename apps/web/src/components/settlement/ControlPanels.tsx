"use client";

import { useEffect, useMemo, useState } from "react";
import { filterRows, isMatch, MAX_TOLERANCE_CENTS, reconcile, RESULT_LABEL, type MatchFilter } from "@/lib/settlement/reconcile";
import {
  ArrowUpRight,
  BookOpen,
  CheckCheck,
  Code2,
  Download,
  FileText,
  KeyRound,
  Landmark,
  LockKeyhole,
  RefreshCw,
  Scale,
  ShieldCheck,
  Users,
  Webhook,
} from "lucide-react";
import {
  approvalTier,
  minorUnits,
  parseCsv,
  type Activity,
  type WorkspaceSnapshot,
} from "@/lib/settlement/model";
import {
  Badge,
  Checklist,
  downloadFile,
  Drawer,
  Empty,
  ExternalCard,
  Field,
  Panel,
  usd,
} from "./ui";
import { exportTransactions } from "./Transactions";
import { requestJson } from "./TreasuryTools";

type Approval = {
  id: string;
  approverRole: string;
  deadline: string | null;
  payment: {
    amount: string;
    asset: string;
    network: string;
    recipientDestination: string | null;
    reason: string;
    phase: string;
  };
};
export function Approvals({
  onMessage,
}: {
  onMessage: (message: string) => void;
}) {
  const [queue, setQueue] = useState<Approval[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Approval | null>(null);
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [decision, setDecision] = useState<"APPROVE" | "DENY">("APPROVE");
  async function refresh() {
    setBusy(true);
    setError("");
    try {
      setQueue(
        (
          await requestJson<{ approvals: Approval[] }>(
            "/api/control-plane/approvals"
          )
        ).approvals
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Approval queue unavailable");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    requestJson<{ approvals: Approval[] }>("/api/control-plane/approvals", {
      signal: controller.signal,
    })
      .then((result) => setQueue(result.approvals))
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, []);
  async function decide() {
    if (!selected || !confirmed || busy) return;
    setBusy(true);
    setError("");
    try {
      await requestJson(
          `/api/control-plane/approvals/${encodeURIComponent(selected.id)}`,
          { method: "POST", body: JSON.stringify({ decision, note }) }
        );
      setQueue((rows) => rows.filter((row) => row.id !== selected.id));
      setSelected(null);
      onMessage(
        "Decision recorded by the approval service. Payment execution is a separate step."
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Decision could not be recorded"
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Panel
        title="Approval queue"
        subtitle="Held payments from the organization control plane"
        action={
          (
            <button
              className="st-button st-small"
              onClick={refresh}
              disabled={busy}
            >
              <RefreshCw size={14} />
              Refresh
            </button>
          )
        }
      >
        {error && !selected && (
          <p role="alert" className="st-error st-panel-content">
            {error}
          </p>
        )}
        {busy && !selected ? (
          <div role="status" className="st-empty">
            Loading approval queue…
          </div>
        ) : queue.length ? (
          <div className="st-approval-list">
            {queue.map((row) => (
              <div key={row.id}>
                <span className="st-feature-icon">
                  <KeyRound size={21} />
                </span>
                <div>
                  <h3>{row.payment.recipientDestination || row.id}</h3>
                  <p>{row.payment.reason}</p>
                  <small>
                    {row.approverRole} · {row.payment.network}
                  </small>
                </div>
                <Badge tone="amber">Awaiting decision</Badge>
                <button
                  className="st-button"
                  onClick={() => {
                    setSelected(row);
                    setConfirmed(false);
                    setNote("");
                    setError("");
                  }}
                >
                  Review <ArrowUpRight size={14} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          !error && (
            <Empty
              title="No approvals waiting"
              description="Eligible payment authorizations will appear here when a human decision is required. Workspace drafts do not enter this queue."
            />
          )
        )}
      </Panel>
      <Panel
        title="Approval policy reference"
        subtitle="Blueprint thresholds. The control plane’s configured policy is authoritative."
      >
        <div className="st-policy-grid">
          {[500, 5000, 50000, 150000].map((amount, index) => {
            const tier = approvalTier(amount);
            return (
              <div key={tier.label}>
                <Badge>{tier.label}</Badge>
                <h3>
                  {
                    [
                      "≤ $1,000",
                      "$1,000–$10,000",
                      "$10,000–$100,000",
                      "> $100,000",
                    ][index]
                  }
                </h3>
                <p>{tier.requirement}</p>
              </div>
            );
          })}
        </div>
      </Panel>
      {selected && (
        <Drawer
          title="Review payment decision"
          onClose={() => {
            if (!busy) setSelected(null);
          }}
        >
          <div className="st-form">
            <Badge tone="amber">
              Re-verification required
            </Badge>
            <dl className="st-summary">
              <div>
                <dt>Payment</dt>
                <dd>{selected.id}</dd>
              </div>
              <div>
                <dt>Amount (atomic units)</dt>
                <dd>
                  {selected.payment.amount} {selected.payment.asset}
                </dd>
              </div>
              <div>
                <dt>Network</dt>
                <dd>{selected.payment.network}</dd>
              </div>
              <div>
                <dt>Recipient</dt>
                <dd>
                  {selected.payment.recipientDestination ?? "Not supplied"}
                </dd>
              </div>
              <div>
                <dt>Deadline</dt>
                <dd>
                  {selected.deadline
                    ? new Date(selected.deadline).toLocaleString()
                    : "Not supplied"}
                </dd>
              </div>
            </dl>
            <Field label="Decision">
              <select
                value={decision}
                onChange={(event) => {
                  setDecision(event.target.value as "APPROVE" | "DENY");
                  setConfirmed(false);
                }}
              >
                <option value="APPROVE">Approve authorization</option>
                <option value="DENY">Deny authorization</option>
              </select>
            </Field>
            <Field label="Audit note">
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={500}
              />
            </Field>
            <label className="st-confirm">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              I have reviewed the recipient, network and amount in atomic units.
            </label>
            {error && (
              <p role="alert" className="st-error">
                {error}
              </p>
            )}
            <button
              className="st-button st-primary"
              disabled={busy || !confirmed}
              onClick={decide}
            >
              {busy
                ? "Submitting…"
                : `Submit ${decision.toLowerCase()}`}
            </button>
            <a className="st-text-button" href="/profile">
              Security & authentication <ArrowUpRight size={14} />
            </a>
          </div>
        </Drawer>
      )}
    </>
  );
}

export function Reconciliation({
  transactions,
}: {
  transactions: Activity[];
}) {
  const [statement, setStatement] = useState<Map<string, number> | null>(null);
  const [error, setError] = useState("");
  const [source, setSource] = useState("Bank statement");
  const [busy, setBusy] = useState(false);
  const [tolerance, setTolerance] = useState("0.00");
  const [filter, setFilter] = useState<MatchFilter>("all");
  const [query, setQuery] = useState("");
  async function compare(file?: File) {
    if (!file) return;
    setBusy(true);
    setError("");
    setStatement(null);
    try {
      if (file.size > 100_000)
        throw new Error("Statement must be smaller than 100 KB");
      const [header, ...input] = parseCsv(await file.text());
      if (
        header?.join(",") !== "transaction_id,amount_usd" ||
        !input.length ||
        input.length > 500
      )
        throw new Error(
          "Use columns transaction_id,amount_usd and 1–500 rows."
        );
      const next = new Map<string, number>();
      for (const row of input) {
        if (row.length !== 2 || !row[0] || next.has(row[0]))
          throw new Error(
            "Statement contains a malformed row or duplicate transaction ID."
          );
        next.set(row[0], minorUnits(row[1]));
      }
      setStatement(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read statement");
    } finally {
      setBusy(false);
    }
  }
  const toleranceCents = (() => {
    try {
      const c = minorUnits(tolerance);
      return c <= MAX_TOLERANCE_CENTS ? c : null;
    } catch {
      return null;
    }
  })();
  const rows = useMemo(() => {
    if (!statement || toleranceCents === null) return null;
    const ledger = new Map(transactions.map((tx) => [tx.id, Math.round(Math.abs(tx.amountUsd) * 100)]));
    return reconcile(ledger, statement, toleranceCents);
  }, [statement, transactions, toleranceCents]);
  const matches = rows?.filter(isMatch).length ?? 0;
  const shown = rows ? filterRows(rows, filter, query) : [];
  return (
    <>
      <div className="st-reconcile-grid">
        {[
          { icon: ShieldCheck, title: "On-chain", value: "Not connected" },
          {
            icon: Scale,
            title: "FurlPay journal",
            value: `${transactions.length} activity records`,
          },
          {
            icon: Landmark,
            title: "Bank clearing",
            value: statement && source === "Bank statement" ? "Statement imported" : "Import a statement",
          },
          {
            icon: CheckCheck,
            title: "ERP / accounting",
            value: statement && source === "ERP export" ? "Export imported" : "Import an export",
          },
        ].map(({ icon: Icon, title, value }) => (
          <Panel key={title}>
            <div className="st-reconcile-source">
              <Icon size={23} />
              <h3>{title}</h3>
              <p>{value}</p>
            </div>
          </Panel>
        ))}
      </div>
      <Panel
        title="Match external records"
        subtitle="Compare transaction IDs and USD amounts locally. No bank or ERP data is changed."
      >
        <div className="st-panel-content">
          <div className="st-inline-form">
            <Field label="Source">
              <select
                value={source}
                disabled={busy}
                onChange={(event) => {
                  setSource(event.target.value);
                  setStatement(null);
                }}
              >
                <option>Bank statement</option>
                <option>ERP export</option>
              </select>
            </Field>
            <Field label="Upload CSV">
              <input
                type="file"
                accept=".csv,text/csv"
                disabled={busy}
                onChange={(event) => void compare(event.target.files?.[0])}
              />
            </Field>
            <Field label="Amount tolerance (USD)">
              <input
                inputMode="decimal"
                aria-invalid={toleranceCents === null}
                value={tolerance}
                onChange={(event) => setTolerance(event.target.value.trim())}
              />
            </Field>
          </div>
          {toleranceCents === null && (
            <p role="alert" className="st-error">
              Enter a tolerance from 0.00 to {usd(MAX_TOLERANCE_CENTS / 100)}.
            </p>
          )}
          <p className="st-muted">
            Columns: transaction_id,amount_usd. Use non-negative USD amounts.
            Uploaded data stays in this browser session. A match is an
            amount-and-ID comparison, not certified four-way reconciliation.
            Rows inside the tolerance are labelled, never counted as exact.
          </p>
          {error && (
            <p role="alert" className="st-error">
              {error}
            </p>
          )}
          {rows && (
            <div className="st-between">
              <Badge tone="green">{matches} matched</Badge>
              <Badge tone={rows.length > matches ? "amber" : "green"}>
                {rows.length - matches} exceptions
              </Badge>
              <button
                className="st-button st-small"
                onClick={() =>
                  downloadFile(
                    "reconciliation.json",
                    JSON.stringify(
                      { basis: "Local comparison only", source, toleranceUsd: tolerance, rows },
                      null,
                      2
                    ),
                    "application/json"
                  )
                }
              >
                <Download size={14} />
                Export comparison
              </button>
            </div>
          )}
        </div>
      </Panel>
      {rows && (
        <Panel title="Comparison results">
          <div className="st-table-tools">
            <input
              aria-label="Search references"
              placeholder="Search transaction ID"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <select aria-label="Filter results" value={filter} onChange={(event) => setFilter(event.target.value as MatchFilter)}>
              <option value="all">All rows</option>
              <option value="exceptions">Exceptions only</option>
              <option value="matched">Matched only</option>
            </select>
          </div>
          {shown.length ? (
            <div className="st-table-scroll">
              <table className="st-table">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>FurlPay · USD</th>
                    <th>{source} · USD</th>
                    <th>Difference</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((row) => (
                    <tr key={row.id}>
                      <td>{row.id}</td>
                      <td className="st-number">
                        {row.ledgerAmount === null ? "Missing" : usd(row.ledgerAmount / 100)}
                      </td>
                      <td className="st-number">
                        {row.statementAmount === null ? "Missing" : usd(row.statementAmount / 100)}
                      </td>
                      <td className="st-number">
                        {row.difference === null || row.difference === 0
                          ? "—"
                          : `${row.difference > 0 ? "+" : "−"}${usd(Math.abs(row.difference) / 100)}`}
                      </td>
                      <td>
                        <Badge tone={row.result === "matched" ? "green" : "amber"}>
                          {RESULT_LABEL[row.result]}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="No rows match" description="Change the search or the result filter." />
          )}
        </Panel>
      )}
    </>
  );
}

export function Reports({
  transactions,
}: {
  transactions: Activity[];
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const valid = !from || !to || from <= to;
  const filtered = valid
    ? transactions.filter(
        (tx) =>
          (!from || tx.timestamp.slice(0, 10) >= from) &&
          (!to || tx.timestamp.slice(0, 10) <= to)
      )
    : [];
  return (
    <Panel
      title="Statements & exports"
      subtitle="Export up to the latest 500 account transactions. Dates use UTC."
    >
      <div className="st-panel-content">
        <div className="st-inline-form">
          <Field label="From">
            <input
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </Field>
          <Field label="Through">
            <input
              type="date"
              min={from}
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </Field>
        </div>
        {!valid && (
          <p className="st-error">
            End date must be on or after the start date.
          </p>
        )}
        <div className="st-report-preview">
          <FileText size={30} />
          <div>
            <h3>Transaction statement</h3>
            <p>
              {filtered.length} records ·{" "}
              Account ledger
            </p>
          </div>
          <Badge>Export ready</Badge>
        </div>
        <div className="st-action-row">
          <button
            disabled={!valid}
            className="st-button st-primary"
            onClick={() => exportTransactions(filtered)}
          >
            <Download size={16} />
            Download CSV
          </button>
          <button
            disabled={!valid}
            className="st-button"
            onClick={() =>
              downloadFile(
                "furlpay-statement.json",
                JSON.stringify(
                  {
                    source: "account_ledger",
                    period: { from, to },
                    transactions: filtered,
                  },
                  null,
                  2
                ),
                "application/json"
              )
            }
          >
            <Code2 size={16} />
            Download JSON
          </button>
        </div>
        <p className="st-notice">
          Certified audit PDFs, MT103/FIRC documents and accounting-system
          exports require settlement evidence from the relevant provider.
        </p>
      </div>
    </Panel>
  );
}

export function Compliance({
  snapshot,
}: {
  snapshot: WorkspaceSnapshot;
}) {
  return (
    <>
      <Panel
        title="Verification & risk"
        subtitle="Identity status and the checks required before money moves."
      >
        <div className="st-panel-content">
          <div className="st-between">
            <div>
              <h3>{snapshot.name || "Your account"}</h3>
              <p className="st-muted">
                Account identity verification
              </p>
            </div>
            <Badge
              tone={snapshot.verification === "verified" ? "green" : "amber"}
            >
              {snapshot.verification}
            </Badge>
          </div>
          <Checklist
            items={[
              {
                label: "Account identity",
                done: snapshot.verification === "verified",
                detail: `Current KYC status: ${snapshot.verification}. This does not establish enterprise KYB.`,
              },
              {
                label: "Company & beneficial owners",
                done: false,
                detail:
                  "Company registration and beneficial-owner verification require a KYB provider.",
              },
              {
                label: "Recipient screening",
                done: false,
                detail:
                  "A saved address is not screened or verified. Screening is enforced by the payout service at execution.",
              },
              {
                label: "Travel Rule & payee verification",
                done: false,
                detail:
                  "Transfer-specific information must be validated by the appropriate compliance provider.",
              },
            ]}
          />
          <a className="st-button" href="/profile">
            Manage verification <ArrowUpRight size={15} />
          </a>
        </div>
      </Panel>
      <div className="st-card-grid">
        <ExternalCard
          title="Compliance documentation"
          description="Review the product’s current compliance scope and integration requirements."
          href="/docs/compliance/mica"
          icon={<ShieldCheck size={23} />}
        />
        <ExternalCard
          title="Security posture"
          description="Authentication, approval boundaries and payment protection."
          href="/docs/security/posture"
          icon={<LockKeyhole size={23} />}
        />
        <ExternalCard
          title="Contact compliance"
          description="Discuss entity onboarding, supported jurisdictions and required evidence."
          href="/talk-to-us"
          icon={<Users size={23} />}
        />
      </div>
    </>
  );
}

export function DeveloperTools() {
  return (
    <>
      <div className="st-card-grid">
        <ExternalCard
          title="API keys"
          description="Manage credentials and access scopes in the developer console."
          href="/developer"
          icon={<KeyRound size={23} />}
        />
        <ExternalCard
          title="Webhooks"
          description="Configure event subscriptions and inspect delivery attempts."
          href="/developer/webhooks"
          icon={<Webhook size={23} />}
        />
        <ExternalCard
          title="API event log"
          description="Inspect requests, events and failures from your integrations."
          href="/developer/events"
          icon={<Code2 size={23} />}
        />
      </div>
      <Panel
        title="Build on FurlPay"
        subtitle="Use the existing API surface and SDK documentation."
      >
        <div className="st-panel-content">
          <pre className="st-code">{`// Read your settlement workspace with a user session.\nconst response = await fetch('/api/settlement/workspace', {\n  credentials: 'same-origin',\n  cache: 'no-store'\n});\nconst workspace = await response.json();`}</pre>
          <div className="st-action-row">
            <a href="/docs" className="st-button">
              <BookOpen size={16} />
              API documentation <ArrowUpRight size={15} />
            </a>
            <a href="/docs/security/posture" className="st-text-button">
              Authentication & security <ArrowUpRight size={15} />
            </a>
          </div>
        </div>
      </Panel>
    </>
  );
}

export function Settings() {
  return (
    <>
      <div className="st-card-grid">
        <ExternalCard
          title="Company & profile"
          description="Manage your profile, linked wallets and verification details."
          href="/profile"
          icon={<Users size={23} />}
        />
        <ExternalCard
          title="Security & MFA"
          description="Manage passkeys, multifactor authentication and active sessions."
          href="/profile"
          icon={<LockKeyhole size={23} />}
        />
        <ExternalCard
          title="Agent policies"
          description="Configure budgets, merchant restrictions and human approval thresholds."
          href="/developer/agents"
          icon={<ShieldCheck size={23} />}
        />
      </div>
      <Panel title="Organization access">
        <div className="st-panel-content">
          <p className="st-notice">
            Workspace drafts belong to your signed-in account. Shared
            organization workspaces, team invitations and role assignment
            require the organization administration service.
          </p>
          <a className="st-button" href="/talk-to-us">
            Discuss team access <ArrowUpRight size={15} />
          </a>
        </div>
      </Panel>
    </>
  );
}
