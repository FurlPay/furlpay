"use client";

import { useState } from "react";
import { ArrowUpRight, ChevronRight, Download, FileText, GitFork, Link2, Plus, Search, Users } from "lucide-react";
import { FurlPayMark } from "@/components/trips/FurlPayLogo";
import { decimalAmount, invoiceTotals, recordAmount, type DraftKind, type WorkspaceRecord } from "@/lib/settlement/model";
import { DRAFT_LABELS } from "./DraftEditor";
import { AssetMark, Badge, downloadFile, Drawer, Empty, humanize, Panel } from "./ui";

// Saved workspace drafts (invoices, links, payouts, schedules, beneficiaries,
// rules, checkout). Drafts never execute: each view says what activation needs.
export function DraftList({
  kind,
  records,
  onCreate,
  onOpen,
  available,
}: {
  kind: DraftKind;
  records: WorkspaceRecord[];
  onCreate: () => void;
  onOpen: (record: WorkspaceRecord) => void;
  available: boolean;
}) {
  const [query, setQuery] = useState("");
  const [archived, setArchived] = useState(false);
  const filtered = records.filter(
    (row) =>
      row.data.kind === kind &&
      !!row.archivedAt === archived &&
      row.data.name.toLowerCase().includes(query.toLowerCase())
  );
  const descriptions: Record<DraftKind, string> = {
    invoice:
      "Create itemized invoices with taxes, discounts, currencies and due dates. Review and export each draft before publishing is enabled.",
    link: "Configure fixed or open amounts, network and expiry. Saved drafts are previews; no public payable URL is issued.",
    payout:
      "Prepare destination, amount and reference. A saved draft requires screening, authorization and a settlement service before execution.",
    schedule:
      "Plan one-time, weekly or monthly payouts. These schedules remain inactive until an authorized execution service is connected.",
    beneficiary:
      "Save wallet recipient drafts. Address syntax is validated; ownership, sanctions and payee verification remain separate checks.",
    rule: "Allocate a payment between your treasury and reserves. Rules must total 100%. Draft rules never move funds automatically.",
    checkout:
      "Choose your branding, return URL and accepted networks. Publishing a checkout requires an active merchant integration.",
  };
  return (
    <>
      <div className="st-notice">{descriptions[kind]}</div>
      <Panel
        title={`${humanize(DRAFT_LABELS[kind])} drafts`}
        subtitle={`${filtered.length} ${archived ? "archived" : "current"} ${
          filtered.length === 1 ? "draft" : "drafts"
        }`}
      >
        <div className="st-table-tools">
          <label className="st-search">
            <Search size={16} />
            <input
              aria-label="Search drafts"
              placeholder="Search drafts…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <select
            aria-label="Draft status"
            value={archived ? "archived" : "current"}
            onChange={(event) => setArchived(event.target.value === "archived")}
          >
            <option value="current">Current drafts</option>
            <option value="archived">Archived</option>
          </select>
        </div>
        {filtered.length ? (
          <div className="st-draft-list">
            {filtered.map((row) => (
              <button key={row.id} onClick={() => onOpen(row)}>
                <span className="st-feature-icon">
                  {kind === "rule" ? (
                    <GitFork size={21} />
                  ) : kind === "invoice" ? (
                    <FileText size={21} />
                  ) : kind === "beneficiary" ? (
                    <Users size={21} />
                  ) : (
                    <Link2 size={21} />
                  )}
                </span>
                <div>
                  <strong>{row.data.name}</strong>
                  <p>
                    {row.data.kind === "invoice"
                      ? `${row.data.customer} · Due ${row.data.dueDate}`
                      : "network" in row.data
                      ? humanize(row.data.network)
                      : "Checkout configuration"}
                  </p>
                  {row.data.kind === "rule" && (
                    <div className="st-split-bar">
                      {row.data.allocations.map((item, index) => (
                        <i
                          key={index}
                          title={`${item.label}: ${item.percentage}%`}
                          style={{
                            width: `${item.percentage}%`,
                            opacity: 1 - index * 0.08,
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
                {recordAmount(row.data) && (
                  <span className="st-number">
                    {recordAmount(row.data)}{" "}
                    {"asset" in row.data ? row.data.asset : "USDC"}
                  </span>
                )}
                <Badge>{row.archivedAt ? "Archived" : "Draft"}</Badge>
                <ChevronRight size={17} />
              </button>
            ))}
          </div>
        ) : (
          <Empty
            title={
              query
                ? "No matching drafts"
                : `Your first ${DRAFT_LABELS[kind]} starts here`
            }
            description={
              archived
                ? "Archived drafts will appear here."
                : `Create a ${DRAFT_LABELS[kind]} and review all details in one place.`
            }
            action={
              !query &&
              !archived && (
                <button
                  className="st-button st-primary"
                  disabled={!available}
                  onClick={onCreate}
                >
                  <Plus size={15} />
                  Create {DRAFT_LABELS[kind]}
                </button>
              )
            }
          />
        )}
      </Panel>
      {kind === "checkout" && (
        <a className="st-resource-card" href="/docs">
          <h3>
            Connect hosted checkout <ArrowUpRight size={17} />
          </h3>
          <p>
            Create merchant checkout sessions with the existing checkout API and
            publishable API key.
          </p>
        </a>
      )}
    </>
  );
}

export function DraftDetail({
  record,
  onArchive,
  onClose,
}: {
  record: WorkspaceRecord;
  onArchive: (record: WorkspaceRecord) => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const data = record.data;
  return (
    <Drawer title={data.name} onClose={onClose}>
      <div className="st-form">
        <Badge tone="amber">
          {record.archivedAt ? "Archived draft" : "Draft · not active"}
        </Badge>
        {data.kind === "invoice" ? (
          <div className="st-invoice-preview">
            <div className="st-between">
              <h3>FurlPay / Invoice draft</h3>
              <FileText size={24} />
            </div>
            <p>
              To: <strong>{data.customer}</strong>
            </p>
            <p>
              Due {data.dueDate} · {data.asset}
            </p>
            <div className="st-table-scroll">
              <table className="st-table">
                <thead>
                  <tr>
                    <th>Description</th>
                    <th>Qty</th>
                    <th>Unit price</th>
                    <th>Tax</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lines.map((line, i) => (
                    <tr key={i}>
                      <td>{line.description}</td>
                      <td>{line.quantity}</td>
                      <td>{line.unitPrice}</td>
                      <td>{line.taxBps / 100}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <dl className="st-summary">
              <div>
                <dt>Discount</dt>
                <dd>{data.discountBps / 100}%</dd>
              </div>
              <div>
                <dt>Tax</dt>
                <dd>
                  {decimalAmount(
                    invoiceTotals(data.lines, data.discountBps).tax
                  )}{" "}
                  {data.asset}
                </dd>
              </div>
              <div className="st-total">
                <dt>Total</dt>
                <dd>
                  {recordAmount(data)} {data.asset}
                </dd>
              </div>
            </dl>
            <p>{data.note}</p>
            <small>
              DRAFT — Not a payment confirmation or certified tax invoice.
            </small>
          </div>
        ) : data.kind === "rule" ? (
          <>
            <h3>When an incoming payment settles</h3>
            <div className="st-rule-preview">
              <span>
                <AssetMark />
                USDC · {humanize(data.network)}
              </span>
              <GitFork size={26} />
              {data.allocations.map((row, i) => (
                <div key={i}>
                  <strong>{row.percentage}%</strong>
                  <span>{row.label}</span>
                </div>
              ))}
            </div>
            <p className="st-notice">
              Destinations are planning labels. Actual vaults, recipient
              verification and execution authorization must be bound before this
              rule can be activated.
            </p>
          </>
        ) : data.kind === "link" ? (
          <div className="st-checkout-preview">
            <FurlPayMark size={42} className="st-checkout-mark" />
            <Badge>Checkout preview</Badge>
            <h3>{data.name}</h3>
            <strong>
              {data.mode === "open"
                ? "Choose an amount"
                : `${data.amount} ${data.asset}`}
            </strong>
            <p>
              {humanize(data.network)} · Expires {data.expiresOn}
            </p>
            <button disabled className="st-button st-primary">
              Payment not enabled
            </button>
            <small>Preview only. This is not a public payment link.</small>
          </div>
        ) : (
          <dl className="st-summary">
            {Object.entries(data)
              .filter(([key]) => key !== "kind")
              .map(([key, value]) => (
                <div key={key}>
                  <dt>{humanize(key)}</dt>
                  <dd>
                    {Array.isArray(value) ? value.join(", ") : String(value)}
                  </dd>
                </div>
              ))}
          </dl>
        )}
        <div className="st-action-row">
          <button
            className="st-button"
            onClick={() =>
              downloadFile(
                `${data.kind}-${record.id}.json`,
                JSON.stringify(
                  {
                    status: "draft",
                    executable: false,
                    source: "account_workspace",
                    record,
                  },
                  null,
                  2
                ),
                "application/json"
              )
            }
          >
            <Download size={15} />
            Export draft
          </button>
          {data.kind === "invoice" && (
            <button className="st-button" onClick={() => window.print()}>
              Print invoice draft
            </button>
          )}
        </div>
        {!record.archivedAt && (
          <button
            className="st-button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onArchive(record);
              } catch (e) {
                setError(e instanceof Error ? e.message : "Archive failed");
                setBusy(false);
              }
            }}
          >
            {busy ? "Archiving…" : "Archive draft"}
          </button>
        )}
        {error && (
          <p className="st-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Drawer>
  );
}
