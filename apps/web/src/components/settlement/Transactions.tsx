"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ASSETS, NETWORKS } from "@/lib/settlement/model";
import { api } from "./os/primitives";
import { ArrowDownLeft, ArrowUpRight, Download, Search } from "lucide-react";
import type { Activity } from "@/lib/settlement/model";
import { csvDocument } from "@/lib/csv";
import {
  AssetMark,
  Badge,
  Checklist,
  downloadFile,
  Drawer,
  Empty,
  Field,
  humanize,
  Panel,
  Status,
  usd,
} from "./ui";

export function exportTransactions(rows: Activity[]) {
  downloadFile(
    "furlpay-transactions.csv",
    csvDocument(
      [
        "ID",
        "Counterparty",
        "Type",
        "Direction",
        "Amount USD",
        "Asset",
        "Network",
        "Status",
        "Timestamp",
        "Source",
      ],
      rows.map((row) => [
        row.id,
        row.name,
        row.type,
        row.direction,
        row.amountUsd.toFixed(2),
        row.asset,
        row.network,
        row.status,
        row.timestamp,
        "Account ledger",
      ])
    ),
    "text/csv;charset=utf-8"
  );
}

export default function Transactions({
  compact = false,
  onViewAll,
}: {
  rows?: Activity[];
  compact?: boolean;
  onViewAll?: () => void;
}) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const query = params.get("q") ?? "";
  const status = params.get("status") ?? "any";
  const direction = params.get("direction") ?? "any";
  const [selected, setSelected] = useState<Activity | null>(null);
  const [result, setResult] = useState<{ items: Activity[]; total: number; nextCursor: string | null }>({ items: [], total: 0, nextCursor: null });
  const [cursors, setCursors] = useState<string[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const allowed = ["q", "status", "direction", "network", "asset", "category", "from", "to", "min", "max", "cursor"];
  const request = new URLSearchParams([...params.entries()].filter(([k, v]) => allowed.includes(k) && v));
  request.set("limit", compact ? "5" : "25");
  const requestKey = request.toString();
  useEffect(() => {
    const ac = new AbortController();
    setBusy(true); setError("");
    const timer = setTimeout(() => {
      api<typeof result>(`/api/settlement/transactions?${requestKey}`, { signal: ac.signal })
        .then((r) => { if (!ac.signal.aborted) setResult(r); })
        .catch((e) => { if (!ac.signal.aborted) { setError(e.message); setResult({ items: [], total: 0, nextCursor: null }); } })
        .finally(() => { if (!ac.signal.aborted) setBusy(false); });
    }, 200);
    return () => { clearTimeout(timer); ac.abort(); };
  }, [requestKey]);
  function changeFilter(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    value ? next.set(key, value) : next.delete(key);
    next.delete("cursor"); setCursors([]);
    router.replace(`${pathname}?${next}`, { scroll: false });
  }
  function navigate(cursor: string) {
    const next = new URLSearchParams(params.toString());
    cursor ? next.set("cursor", cursor) : next.delete("cursor");
    router.replace(`${pathname}?${next}`, { scroll: false });
  }
  const visible = result.items;
  return (
    <>
      <Panel
        title={compact ? "Recent activity" : "All transactions"}
        subtitle="Every movement, in one place. Amounts shown in USD."
        action={
          compact ? (
            <button className="st-text-button" onClick={onViewAll}>
              View all <ArrowUpRight size={14} />
            </button>
          ) : (
            <button
              className="st-button st-small"
              disabled={busy || !visible.length}
              onClick={() => exportTransactions(visible)}
            >
              <Download size={14} />
              Export this page
            </button>
          )
        }
      >
        {!compact && (
          <div className="st-table-tools">
            <label className="st-search">
              <Search size={16} />
              <input
                aria-label="Search transactions"
                placeholder="Search counterparty, memo, reference or network…"
                value={query}
                onChange={(event) => {
                  changeFilter("q", event.target.value);
                }}
              />
            </label>
            <select
              aria-label="Filter transaction status"
              value={status}
              onChange={(event) => {
                changeFilter("status", event.target.value);
              }}
            >
              <option value="any">All statuses</option>
              {["settled", "pending", "escrow", "declined"].map((value) => (
                <option key={value} value={value}>
                  {humanize(value)}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter transaction direction"
              value={direction}
              onChange={(event) => {
                changeFilter("direction", event.target.value);
              }}
            >
              <option value="any">All directions</option>
              <option value="in">Incoming</option>
              <option value="out">Outgoing</option>
            </select>
          </div>
        )}
        {!compact && <div className="st-table-tools" style={{ flexWrap: "wrap", alignItems: "end" }}>
          <Field label="From"><input type="date" value={params.get("from") ?? ""} onChange={(e) => changeFilter("from", e.target.value)} /></Field>
          <Field label="Through"><input type="date" value={params.get("to") ?? ""} onChange={(e) => changeFilter("to", e.target.value)} /></Field>
          <Field label="Minimum USD"><input type="number" min="0" step="0.01" value={params.get("min") ?? ""} onChange={(e) => changeFilter("min", e.target.value)} /></Field>
          <Field label="Maximum USD"><input type="number" min="0" step="0.01" value={params.get("max") ?? ""} onChange={(e) => changeFilter("max", e.target.value)} /></Field>
          <Field label="Network"><select value={params.get("network") ?? ""} onChange={(e) => changeFilter("network", e.target.value)}><option value="">All networks</option>{[...NETWORKS, "account"].map((n) => <option key={n} value={n}>{humanize(n)}</option>)}</select></Field>
          <Field label="Asset"><select value={params.get("asset") ?? ""} onChange={(e) => changeFilter("asset", e.target.value)}><option value="">All assets</option>{ASSETS.map((n) => <option key={n}>{n}</option>)}</select></Field>
          <Field label="Category"><select value={params.get("category") ?? ""} onChange={(e) => changeFilter("category", e.target.value)}><option value="">All categories</option>{["transfer", "ramp", "swap", "card", "bill", "invest", "yield", "refund"].map((n) => <option key={n} value={n}>{humanize(n)}</option>)}</select></Field>
          <button className="st-button st-small" onClick={() => { setCursors([]); router.replace(pathname, { scroll: false }); }}>Reset filters</button>
        </div>}
        {error && <p role="alert" className="st-error">{error}</p>}
        {busy ? <p role="status" className="st-muted" style={{ padding: 20 }}>Loading transactions…</p> : visible.length ? (
          <div className="st-table-scroll">
            <table className="st-table">
              <thead>
                <tr>
                  <th>Counterparty</th>
                  <th>Asset / network</th>
                  <th>Status</th>
                  <th>Amount · USD</th>
                  <th>Time</th>
                  <th>
                    <span className="st-sr-only">Details</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div className="st-cell-title">
                        <span
                          className={`st-direction ${
                            row.direction === "in" ? "st-incoming" : ""
                          }`}
                        >
                          {row.direction === "in" ? (
                            <ArrowDownLeft size={17} />
                          ) : (
                            <ArrowUpRight size={17} />
                          )}
                        </span>
                        <div>
                          <button
                            className="st-row-link"
                            onClick={() => setSelected(row)}
                          >
                            {row.name}
                          </button>
                          <small>
                            {humanize(row.type)} · {row.id.slice(-9)}
                          </small>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="st-cell-title">
                        <AssetMark asset={row.asset} network={row.network} />
                        <div>
                          {row.asset}
                          <small>{humanize(row.network)}</small>
                        </div>
                      </div>
                    </td>
                    <td>
                      <Status value={row.status} />
                    </td>
                    <td
                      className={`st-number ${
                        row.direction === "in" ? "st-green-text" : ""
                      }`}
                    >
                      {row.direction === "in" ? "+" : "−"}
                      {usd(Math.abs(row.amountUsd))}
                    </td>
                    <td>
                      <time dateTime={row.timestamp}>
                        {new Date(row.timestamp).toLocaleDateString("en-GB", {
                          day: "2-digit",
                          month: "short",
                        })}
                        <small>
                          {new Date(row.timestamp).toLocaleTimeString("en-GB", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </small>
                      </time>
                    </td>
                    <td>
                      <button
                        aria-label={`View ${row.name} transaction`}
                        className="st-icon-button"
                        onClick={() => setSelected(row)}
                      >
                        <ArrowUpRight size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title={
              query || status !== "any" || direction !== "any"
                ? "No matching transactions"
                : "Your activity starts here"
            }
            description="Incoming payments and payouts will appear here when they are recorded in your account."
          />
        )}
        {!compact && result.total > 0 && (
          <div className="st-pagination">
            <span>
              {visible.length} shown · {result.total} matches
            </span>
            <div>
              <button
                className="st-button st-small"
                disabled={busy || !params.get("cursor")}
                onClick={() => { navigate(cursors.at(-1) ?? ""); setCursors((c) => c.slice(0, -1)); }}
              >
                Previous
              </button>
              <button
                className="st-button st-small"
                disabled={busy || !result.nextCursor}
                onClick={() => { setCursors((c) => [...c, params.get("cursor") ?? ""]); navigate(result.nextCursor!); }}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </Panel>
      {selected && (
        <TransactionDetail
          transaction={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}

export function TransactionDetail({
  transaction: tx,
  onClose,
}: {
  transaction: Activity;
  onClose: () => void;
}) {
  const [refund, setRefund] = useState("");
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundMessage, setRefundMessage] = useState("");
  return (
    <Drawer title="Transaction details" onClose={onClose}>
      <div className="st-detail-amount">
        <AssetMark asset={tx.asset} network={tx.network} />
        <strong>{usd(tx.amountUsd)}</strong>
        <p>{tx.name}</p>
        <Status value={tx.status} />
      </div>
      <dl className="st-summary">
        <div>
          <dt>Reference</dt>
          <dd>{tx.id}</dd>
        </div>
        <div>
          <dt>Direction</dt>
          <dd>{tx.direction === "in" ? "Incoming" : "Outgoing"}</dd>
        </div>
        <div>
          <dt>Asset / network</dt>
          <dd>
            {tx.asset} · {humanize(tx.network)}
          </dd>
        </div>
        <div>
          <dt>Recorded at</dt>
          <dd>{new Date(tx.timestamp).toLocaleString()}</dd>
        </div>
        <div>
          <dt>Amount basis</dt>
          <dd>USD ledger value</dd>
        </div>
      </dl>
      <h3>Settlement evidence</h3>
      <Checklist
        items={[
          {
            label: "Account ledger entry",
            done: true,
            detail: "Recorded in your FurlPay transaction history.",
          },
          {
            label: "Blockchain reference",
            done: false,
            detail:
              "No verified transaction hash is provided by this ledger entry.",
          },
          {
            label: "Bank clearing / ERP match",
            done: false,
            detail: "External reconciliation evidence is not connected.",
          },
        ]}
      />
      <button
        className="st-button"
        onClick={() =>
          downloadFile(
            `${tx.id}.json`,
            JSON.stringify(
              {
                source: "account_ledger",
                transaction: tx,
                onchainEvidence: null,
                bankEvidence: null,
                erpEvidence: null,
              },
              null,
              2
            ),
            "application/json"
          )
        }
      >
        <Download size={15} />
        Download record
      </button>
      {tx.direction === "in" && tx.status === "settled" && (
        <div className="st-refund">
          <button
            className="st-text-button"
            onClick={() => setRefundOpen(!refundOpen)}
          >
            Prepare a refund estimate <ArrowUpRight size={14} />
          </button>
          {refundOpen && (
            <form
              className="st-form"
              onSubmit={(event) => {
                event.preventDefault();
                const value = Number(refund);
                setRefundMessage(
                  !/^\d+(\.\d{1,2})?$/.test(refund) ||
                    value <= 0 ||
                    value > tx.amountUsd
                    ? "Enter a positive amount no greater than the original payment."
                    : "Refund request prepared locally. A verified payment reference, current fee quote and authorized refund service are required before funds can be returned."
                );
              }}
            >
              <Field label="Refund amount · USD">
                <input
                  inputMode="decimal"
                  value={refund}
                  onChange={(event) => setRefund(event.target.value)}
                  placeholder={tx.amountUsd.toFixed(2)}
                  required
                />
              </Field>
              <button className="st-button">Review refund</button>
              {refundMessage && (
                <p role="status" className="st-notice">
                  {refundMessage}
                </p>
              )}
            </form>
          )}
        </div>
      )}
    </Drawer>
  );
}
