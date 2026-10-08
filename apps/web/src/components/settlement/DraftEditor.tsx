"use client";

import { useRef, useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  ASSETS,
  NETWORKS,
  approvalTier,
  decimalAmount,
  draftSchema,
  invoiceTotals,
  validateDestination,
  type Draft,
  type DraftKind,
  type InvoiceLine,
} from "@/lib/settlement/model";
import { Field, humanize } from "./ui";

export const DRAFT_LABELS: Record<DraftKind, string> = {
  invoice: "invoice",
  link: "payment link",
  payout: "payout",
  schedule: "schedule",
  beneficiary: "beneficiary",
  rule: "settlement rule",
  checkout: "checkout configuration",
};

export default function DraftEditor({
  kind,
  onSave,
  onClose,
}: {
  kind: DraftKind;
  onSave: (data: Draft, id: string) => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<{ fingerprint: string; id: string }>();
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState("fixed");
  const [discount, setDiscount] = useState(0);
  const [lines, setLines] = useState<InvoiceLine[]>([
    { description: "", quantity: 1, unitPrice: "0", taxBps: 0 },
  ]);
  const [allocations, setAllocations] = useState([
    { label: "Main treasury", percentage: 80 },
    { label: "Supplier reserve", percentage: 15 },
    { label: "Operating reserve", percentage: 5 },
  ]);
  const totals = (() => {
    try {
      return invoiceTotals(lines, discount);
    } catch {
      return null;
    }
  })();
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError("");
    const form = new FormData(event.currentTarget);
    const get = (key: string) => String(form.get(key) ?? "").trim();
    const shared = { kind, name: get("name") };
    let data: unknown;
    if (kind === "invoice")
      data = {
        ...shared,
        customer: get("customer"),
        asset: get("asset"),
        dueDate: get("date"),
        lines,
        discountBps: discount,
        note: get("note"),
      };
    else if (kind === "rule")
      data = { ...shared, network: get("network"), allocations };
    else if (kind === "checkout")
      data = {
        ...shared,
        accent: get("accent"),
        returnUrl: get("returnUrl"),
        networks: form.getAll("networks"),
      };
    else if (kind === "link")
      data = {
        ...shared,
        mode,
        ...(mode === "fixed" ? { amount } : {}),
        asset: get("asset"),
        network: get("network"),
        expiresOn: get("date"),
        note: get("note"),
      };
    else
      data = {
        ...shared,
        network: get("network"),
        address: get("address"),
        note: get("note"),
        ...(kind === "beneficiary" ? {} : { amount }),
        ...(kind === "payout" ? { asset: "USDC" } : {}),
        ...(kind === "schedule"
          ? { startDate: get("date"), frequency: get("frequency") }
          : {}),
      };
    const parsed = draftSchema.safeParse(data);
    if (!parsed.success) {
      setError(
        parsed.error.issues
          .map((issue) => `${issue.path.join(" ")}: ${issue.message}`)
          .join(". ")
      );
      return;
    }
    setBusy(true);
    try {
      if (
        "address" in parsed.data &&
        !(await validateDestination(parsed.data.address, parsed.data.network))
      )
        throw new Error(
          "Enter a valid wallet address for the selected network."
        );
      const fingerprint = JSON.stringify(parsed.data);
      if (request.current?.fingerprint !== fingerprint)
        request.current = { fingerprint, id: crypto.randomUUID() };
      await onSave(parsed.data, request.current.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save draft");
    } finally {
      setBusy(false);
    }
  }
  const networkField = (
    <Field label="Settlement network">
      <select name="network" defaultValue="arbitrum">
        {NETWORKS.map((value) => (
          <option key={value} value={value}>
            {humanize(value)}
            {value === "arbitrum" ? " · Primary" : ""}
          </option>
        ))}
      </select>
    </Field>
  );
  const assetField = (
    <Field label="Currency">
      <select name="asset">
        {ASSETS.map((value) => (
          <option key={value}>{value}</option>
        ))}
      </select>
    </Field>
  );
  return (
    <form className="st-form" onSubmit={submit}>
      <div className="st-notice">
        Save a draft to your account. Drafts do not initiate payments, publish checkout links, verify recipients, or activate automations.
      </div>
      <Field
        label={
          kind === "beneficiary"
            ? "Recipient name"
            : kind === "payout" || kind === "schedule"
            ? "Payout name / recipient"
            : "Name"
        }
      >
        <input
          autoFocus
          required
          name="name"
          maxLength={120}
          placeholder={
            kind === "invoice"
              ? "October services"
              : kind === "link"
              ? "Monthly subscription"
              : "Give this a name"
          }
        />
      </Field>
      {kind === "invoice" && (
        <>
          <Field label="Customer / company">
            <input
              name="customer"
              required
              maxLength={120}
              placeholder="Customer company name"
            />
          </Field>
          <div className="st-form-grid">
            {assetField}
            <Field label="Due date">
              <input type="date" name="date" required defaultValue={tomorrow} />
            </Field>
          </div>
          <div className="st-line-items">
            <h3>Line items</h3>
            {lines.map((line, index) => (
              <div className="st-invoice-line" key={index}>
                <Field label={`Item ${index + 1}`}>
                  <input
                    aria-label={`Item ${index + 1} description`}
                    required
                    value={line.description}
                    placeholder="Service or product"
                    onChange={(event) =>
                      setLines(
                        lines.map((row, i) =>
                          i === index
                            ? { ...row, description: event.target.value }
                            : row
                        )
                      )
                    }
                  />
                </Field>
                <div className="st-line-numbers">
                  <Field label="Qty">
                    <input
                      aria-label={`Item ${index + 1} quantity`}
                      type="number"
                      min="1"
                      max="10000"
                      step="1"
                      required
                      value={line.quantity}
                      onChange={(event) =>
                        setLines(
                          lines.map((row, i) =>
                            i === index
                              ? { ...row, quantity: Number(event.target.value) }
                              : row
                          )
                        )
                      }
                    />
                  </Field>
                  <Field label="Unit price">
                    <input
                      aria-label={`Item ${index + 1} price`}
                      inputMode="decimal"
                      required
                      value={line.unitPrice}
                      onChange={(event) =>
                        setLines(
                          lines.map((row, i) =>
                            i === index
                              ? { ...row, unitPrice: event.target.value }
                              : row
                          )
                        )
                      }
                    />
                  </Field>
                  <Field label="Tax %">
                    <input
                      aria-label={`Item ${index + 1} tax`}
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={line.taxBps / 100}
                      onChange={(event) =>
                        setLines(
                          lines.map((row, i) =>
                            i === index
                              ? {
                                  ...row,
                                  taxBps: Math.round(
                                    Number(event.target.value) * 100
                                  ),
                                }
                              : row
                          )
                        )
                      }
                    />
                  </Field>
                  <button
                    type="button"
                    className="st-icon-button"
                    aria-label={`Remove item ${index + 1}`}
                    disabled={lines.length === 1}
                    onClick={() =>
                      setLines(lines.filter((_, i) => i !== index))
                    }
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
            <button
              className="st-button st-small"
              type="button"
              disabled={lines.length >= 50}
              onClick={() =>
                setLines([
                  ...lines,
                  { description: "", quantity: 1, unitPrice: "0", taxBps: 0 },
                ])
              }
            >
              <Plus size={15} />
              Add line item
            </button>
          </div>
          <Field label="Discount % (before tax)">
            <input
              type="number"
              min="0"
              max="99.99"
              step="0.01"
              value={discount / 100}
              onChange={(event) =>
                setDiscount(Math.round(Number(event.target.value) * 100))
              }
            />
          </Field>
          {totals && (
            <dl className="st-summary">
              <div>
                <dt>Subtotal</dt>
                <dd>{decimalAmount(totals.subtotal)}</dd>
              </div>
              <div>
                <dt>Discount</dt>
                <dd>−{decimalAmount(totals.discount)}</dd>
              </div>
              <div>
                <dt>Tax</dt>
                <dd>{decimalAmount(totals.tax)}</dd>
              </div>
              <div className="st-total">
                <dt>Total</dt>
                <dd>{decimalAmount(totals.total)}</dd>
              </div>
            </dl>
          )}
        </>
      )}
      {kind === "link" && (
        <>
          <div className="st-form-grid">
            <Field label="Amount type">
              <select
                value={mode}
                onChange={(event) => setMode(event.target.value)}
              >
                <option value="fixed">Fixed amount</option>
                <option value="open">Customer chooses</option>
              </select>
            </Field>
            {assetField}
          </div>
          {mode === "fixed" && (
            <Field label="Amount">
              <input
                inputMode="decimal"
                value={amount}
                required
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0.00"
              />
            </Field>
          )}
          <div className="st-form-grid">
            {networkField}
            <Field label="Expires on">
              <input
                type="date"
                name="date"
                required
                defaultValue={tomorrow}
                min={new Date().toISOString().slice(0, 10)}
              />
            </Field>
          </div>
        </>
      )}
      {["beneficiary", "payout", "schedule"].includes(kind) && (
        <>
          {networkField}
          <Field
            label="Wallet address"
            hint="Syntax is validated. Ownership and sanctions screening are separate checks."
          >
            <input
              name="address"
              required
              spellCheck={false}
              autoComplete="off"
              placeholder="Recipient wallet address"
            />
          </Field>
          {kind !== "beneficiary" && (
            <>
              <Field label="Amount (USDC)">
                <input
                  inputMode="decimal"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  required
                  placeholder="0.00"
                />
              </Field>
              <div className="st-notice">
                <strong>
                  {approvalTier(Number(amount) || 0).label} policy preview
                </strong>
                <br />
                {approvalTier(Number(amount) || 0).requirement}. Saving a draft
                does not apply or satisfy this policy.
              </div>
            </>
          )}
        </>
      )}
      {kind === "schedule" && (
        <div className="st-form-grid">
          <Field label="Start date">
            <input
              name="date"
              type="date"
              min={tomorrow}
              defaultValue={tomorrow}
              required
            />
          </Field>
          <Field label="Frequency">
            <select name="frequency">
              <option value="once">One time</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </Field>
        </div>
      )}
      {kind === "rule" && (
        <>
          {networkField}
          <h3>Allocate incoming funds</h3>
          {allocations.map((row, index) => (
            <div className="st-allocation" key={index}>
              <Field label={`Destination ${index + 1}`}>
                <input
                  value={row.label}
                  required
                  onChange={(event) =>
                    setAllocations(
                      allocations.map((value, i) =>
                        i === index
                          ? { ...value, label: event.target.value }
                          : value
                      )
                    )
                  }
                />
              </Field>
              <Field label="Percent">
                <input
                  type="number"
                  min="1"
                  max="100"
                  step="1"
                  value={row.percentage}
                  onChange={(event) =>
                    setAllocations(
                      allocations.map((value, i) =>
                        i === index
                          ? { ...value, percentage: Number(event.target.value) }
                          : value
                      )
                    )
                  }
                />
              </Field>
              <button
                className="st-icon-button"
                type="button"
                disabled={allocations.length <= 2}
                aria-label={`Remove allocation ${index + 1}`}
                onClick={() =>
                  setAllocations(allocations.filter((_, i) => i !== index))
                }
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          <div className="st-between">
            <button
              type="button"
              className="st-button st-small"
              disabled={allocations.length >= 10}
              onClick={() =>
                setAllocations([...allocations, { label: "", percentage: 1 }])
              }
            >
              <Plus size={14} />
              Add destination
            </button>
            <strong
              className={
                allocations.reduce((sum, row) => sum + row.percentage, 0) ===
                100
                  ? "st-green-text"
                  : "st-amber-text"
              }
            >
              {allocations.reduce((sum, row) => sum + row.percentage, 0)} / 100%
            </strong>
          </div>
        </>
      )}
      {kind === "checkout" && (
        <>
          <Field label="Accent color">
            <input type="color" name="accent" defaultValue="#00c888" />
          </Field>
          <Field label="Return URL">
            <input
              name="returnUrl"
              type="url"
              placeholder="https://your-site.com/thank-you"
              required
            />
          </Field>
          <fieldset className="st-checkboxes">
            <legend>Accepted networks</legend>
            {NETWORKS.map((value) => (
              <label key={value}>
                <input
                  name="networks"
                  type="checkbox"
                  value={value}
                  defaultChecked={value === "arbitrum"}
                />
                {humanize(value)}
              </label>
            ))}
          </fieldset>
        </>
      )}
      {!["rule", "checkout"].includes(kind) && (
        <Field label="Memo (optional)">
          <textarea
            name="note"
            rows={3}
            maxLength={500}
            placeholder="Add a reference or internal note"
          />
        </Field>
      )}
      {error && (
        <p role="alert" className="st-error">
          {error}
        </p>
      )}
      <div className="st-form-actions">
        <button
          type="button"
          className="st-button"
          onClick={onClose}
          disabled={busy}
        >
          Cancel
        </button>
        <button className="st-button st-primary" disabled={busy}>
          {busy ? "Saving…" : "Save draft"}
        </button>
      </div>
    </form>
  );
}
