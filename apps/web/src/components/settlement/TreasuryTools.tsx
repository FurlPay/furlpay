"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpRight,
  Download,
  FileSpreadsheet,
  Landmark,
  ShieldCheck,
  Upload,
} from "lucide-react";
import {
  approvalTier,
  minorUnits,
  moneySchema,
  NETWORKS,
  validateBatch,
  type BatchLine,
  type Draft,
  type Network,
  type WorkspaceSnapshot,
} from "@/lib/settlement/model";
import { csvDocument } from "@/lib/csv";
import {
  AssetMark,
  Badge,
  Checklist,
  CopyButton,
  downloadFile,
  Empty,
  Field,
  formatNumber,
  humanize,
  Panel,
  usd,
} from "./ui";

export async function requestJson<T>(
  url: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(url, {
    ...options,
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      data.detail ||
        data.message ||
        data.error ||
        `Request failed (${response.status})`
    );
  return data as T;
}

export function Balances({
  snapshot,
  onReceive,
}: {
  snapshot: WorkspaceSnapshot;
  onReceive: () => void;
}) {
  return (
    <>
      <div className="st-card-grid">
        {snapshot.balances.map((balance, index) => (
          <Panel
            key={`${balance.asset}-${balance.network}-${index}`}
            className="st-balance-card"
          >
            <div className="st-between">
              <AssetMark asset={balance.asset} network={balance.network} />
              <Badge>
                {balance.custody === "fiat" ? "Fiat ledger" : "Account ledger"}
              </Badge>
            </div>
            <h3>
              {balance.asset}
              <span>{humanize(balance.network)}</span>
            </h3>
            <div className="st-balance-value">
              {formatNumber(balance.amount)}
            </div>
            <p>
              {balance.asset} ·{" "}
              {balance.custody === "fiat"
                ? "Bank account details require a provider"
                : "Custodial account balance"}
            </p>
          </Panel>
        ))}
      </div>
      {!snapshot.balances.length && (
        <Panel>
          <Empty
            title="No balances yet"
            description="Balances appear when funds are recorded in your account. Each asset and custody type is shown separately."
            action={
              <button className="st-button st-primary" onClick={onReceive}>
                <ArrowDownToLine size={16} />
                Receive USDC
              </button>
            }
          />
        </Panel>
      )}
      <div className="st-notice">
        Account ledger balances and external device wallet balances are
        separate. No currency conversion or combined buying power is implied.
      </div>
    </>
  );
}

type LinkedResponse = {
  linked: { address: string } | null;
  balances: {
    chain: string;
    display: string | null;
    status: string;
    asOf: { source: string } | null;
  }[];
  detail?: string;
};
export function Receive({
  onMessage,
}: {
  onMessage: (message: string) => void;
}) {
  const [network, setNetwork] = useState<Network>("arbitrum");
  const [linked, setLinked] = useState<LinkedResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [qr, setQr] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    requestJson<LinkedResponse>("/api/wallet/balances", {
      signal: controller.signal,
    })
      .then(setLinked)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);
  const address =
    ["arbitrum", "base"].includes(network)
      ? linked?.linked?.address
      : undefined;
  useEffect(() => {
    let cancelled = false;
    setQr("");
    if (address)
      import("qrcode")
        .then((module) =>
          module.toDataURL(address, {
            width: 240,
            margin: 2,
            errorCorrectionLevel: "M",
          })
        )
        .then((url) => {
          if (!cancelled) setQr(url);
        })
        .catch(() => {
          if (!cancelled)
            setError(
              "The QR code could not be generated. Use the address below."
            );
        });
    return () => {
      cancelled = true;
    };
  }, [address, network]);
  return (
    <div className="st-two-columns">
      <Panel
        title="Receive USDC"
        subtitle="Choose the network before sharing your wallet address."
      >
        <div className="st-panel-content">
          <div className="st-network-options">
            {NETWORKS.map((value) => (
              <button
                className={network === value ? "st-selected" : ""}
                onClick={() => setNetwork(value)}
                key={value}
              >
                <AssetMark asset="USDC" network={value} />
                {humanize(value)}
                {value === "arbitrum" && <small>Primary</small>}
              </button>
            ))}
          </div>
          {loading ? (
            <p role="status">Loading your linked wallet…</p>
          ) : address ? (
            <div className="st-deposit">
              <div className="st-qr">
                {qr ? (
                  <img
                    src={qr}
                    alt={`QR code for your ${humanize(network)} wallet address`}
                    width={200}
                    height={200}
                  />
                ) : (
                  "Generating QR…"
                )}
              </div>
              <Badge tone="green">Verified linked address</Badge>
              <p className="st-address">{address}</p>
              <div className="st-action-row">
                <CopyButton value={address} onMessage={onMessage} />
                <a
                  className="st-button st-small"
                  href={`https://${
                    network === "base" ? "basescan.org" : "arbiscan.io"
                  }/address/${address}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Explorer <ArrowUpRight size={14} />
                </a>
              </div>
            </div>
          ) : (
            <Empty
              title="Link a wallet to receive"
              description={
                error ||
                linked?.detail ||
                "Receiving on this network requires a verified, linked wallet."
              }
              action={
                <a className="st-button" href="/profile">
                  Manage linked wallet <ArrowUpRight size={14} />
                </a>
              }
            />
          )}
        </div>
      </Panel>
      <Panel title="Before you receive">
        <div className="st-panel-content">
          <Checklist
            items={[
              {
                label: "Use native USDC",
                done: true,
                detail: `Send only native USDC on ${humanize(
                  network
                )} to this address.`,
              },
              {
                label: "Check the network",
                done: true,
                detail:
                  "The sending network must match the network selected here.",
              },
              {
                label: "Device wallet custody",
                done: true,
                detail:
                  "Deposits belong to your linked wallet. They are not automatically credited to the FurlPay account ledger.",
              },
              {
                label: "Automatic settlement",
                done: false,
                detail:
                  "Cross-chain consolidation and split execution require connected settlement providers.",
              },
            ]}
          />
        </div>
      </Panel>
    </div>
  );
}

type QuoteResponse = {
  quoteId: string;
  expiresAt: string;
  quote: {
    amountOut: number;
    amountIn: number;
    feeUsd: number;
    gasUsd: number;
    source: string;
    route: string[];
    slippagePct: number;
  };
};
export function Conversion() {
  const [amount, setAmount] = useState("1000");
  const [target, setTarget] = useState("EURC");
  const [chain, setChain] = useState("base");
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const generation = useRef(0);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  function invalidate() {
    generation.current++;
    setQuote(null);
    setError("");
  }
  async function getQuote() {
    setError("");
    setQuote(null);
    if (!moneySchema.safeParse(amount).success) {
      setError(
        "Enter an amount from 0.01 to 1,000,000 with at most two decimals."
      );
      return;
    }
    const request = ++generation.current;
    setBusy(true);
    try {
      const result: QuoteResponse = await requestJson<QuoteResponse>("/api/swaps", {
            method: "POST",
            body: JSON.stringify({
              fromToken: "USDC",
              fromChain: chain,
              toToken: target,
              toChain: chain,
              amountIn: Number(amount),
            }),
          });
      if (request === generation.current) {
        setQuote(result);
        setNow(Date.now());
      }
    } catch (e) {
      if (request === generation.current)
        setError(e instanceof Error ? e.message : "Quote unavailable");
    } finally {
      setBusy(false);
    }
  }
  const seconds = quote
    ? Math.max(0, Math.ceil((Date.parse(quote.expiresAt) - now) / 1000))
    : 0;
  return (
    <div className="st-two-columns">
      <Panel
        title="Convert & FX"
        subtitle="Review a quote before choosing how to settle."
      >
        <div className="st-panel-content st-form">
          <div className="st-conversion-input">
            <label htmlFor="st-send-amount">You send</label>
            <div>
              <input
                id="st-send-amount"
                inputMode="decimal"
                value={amount}
                onChange={(event) => {
                  invalidate();
                  setAmount(event.target.value);
                }}
              />
              <span>
                <AssetMark />
                USDC
              </span>
            </div>
          </div>
          <div className="st-conversion-arrow">
            <ArrowLeftRight size={20} />
          </div>
          <div className="st-conversion-input">
            <label htmlFor="st-target-asset">You receive</label>
            <div>
              <strong>
                {quote ? formatNumber(quote.quote.amountOut) : "—"}
              </strong>
              <select
                id="st-target-asset"
                value={target}
                onChange={(event) => {
                  invalidate();
                  setTarget(event.target.value);
                }}
              >
                <option>EURC</option>
                <option>USDT</option>
              </select>
            </div>
          </div>
          <Field label="Network">
            <select
              value={chain}
              onChange={(event) => {
                invalidate();
                setChain(event.target.value);
              }}
            >
              {(target === "EURC"
                ? ["base", "ethereum", "solana"]
                : ["ethereum", "solana"]
              ).map((value) => (
                <option key={value} value={value}>
                  {humanize(value)}
                </option>
              ))}
            </select>
          </Field>
          {target === "USDT" && chain === "base" && (
            <p className="st-notice">Choose Ethereum or Solana for USDT.</p>
          )}
          {quote && (
            <>
              <div className="st-between">
                <Badge tone={quote.quote.source === "lifi" ? "green" : "amber"}>
                  {quote.quote.source === "lifi"
                    ? "Li.Fi quote"
                    : "Illustrative estimate"}
                </Badge>
                <span className="st-number">
                  {seconds
                    ? `${seconds}s remaining`
                    : "Expired · request a new quote"}
                </span>
              </div>
              <dl className="st-summary">
                <div>
                  <dt>Rate</dt>
                  <dd>
                    1 USDC ≈{" "}
                    {formatNumber(
                      quote.quote.amountOut / quote.quote.amountIn,
                      6
                    )}{" "}
                    {target}
                  </dd>
                </div>
                <div>
                  <dt>Route fee</dt>
                  <dd>{usd(quote.quote.feeUsd)}</dd>
                </div>
                <div>
                  <dt>Estimated gas</dt>
                  <dd>{usd(quote.quote.gasUsd)}</dd>
                </div>
                <div>
                  <dt>Slippage</dt>
                  <dd>{quote.quote.slippagePct}%</dd>
                </div>
              </dl>
            </>
          )}
          {error && (
            <p className="st-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="st-button st-primary"
            disabled={busy || (target === "USDT" && chain === "base")}
            onClick={getQuote}
          >
            {busy ? "Fetching quote…" : quote ? "Refresh quote" : "Get quote"}
            <ArrowUpRight size={16} />
          </button>
          <p className="st-muted">
            This screen quotes only. Bank FX and guaranteed fiat rate locks
            require an institutional provider.
          </p>
        </div>
      </Panel>
      <Panel title="Every cost, before you commit">
        <div className="st-panel-content">
          <Checklist
            items={[
              {
                label: "Explicit quote source",
                done: true,
                detail:
                  "Live aggregator quotes and fallback estimates are labelled separately.",
              },
              {
                label: "Time-bound pricing",
                done: true,
                detail:
                  "Expired quotes must be refreshed. Editing an amount or route discards the previous quote.",
              },
              {
                label: "Secure execution",
                done: false,
                detail:
                  "Continue through the existing swap flow for wallet signing and authorization.",
              },
            ]}
          />
          <a className="st-button" href="/swaps">
            Open swap workspace <ArrowUpRight size={15} />
          </a>
        </div>
      </Panel>
    </div>
  );
}

export function BatchPayouts({
  onSave,
  onMessage,
}: {
  onSave: (data: Draft, id: string) => Promise<void>;
  onMessage: (message: string) => void;
}) {
  const [rows, setRows] = useState<BatchLine[]>([]);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(new Set<number>());
  const requestIds = useRef<string[]>([]);
  const valid = rows.filter((row) => !row.error);
  const total =
    valid.reduce((sum, row) => sum + minorUnits(row.amount), 0) / 100;
  async function upload(file?: File) {
    if (!file || busy) return;
    setBusy(true);
    setError("");
    setRows([]);
    setSaved(new Set());
    setFileName(file.name);
    try {
      if (file.size > 100_000)
        throw new Error("CSV must be smaller than 100 KB");
      const result = await validateBatch(await file.text());
      setRows(result);
      requestIds.current = result.map(() => crypto.randomUUID());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not parse CSV");
    } finally {
      setBusy(false);
    }
  }
  async function saveBatch() {
    setBusy(true);
    setError("");
    const complete = new Set(saved);
    try {
      for (let i = 0; i < rows.length; i++) {
        if (complete.has(i)) continue;
        const row = rows[i];
        await onSave(
          {
            kind: "payout",
            name: row.name,
            network: row.network,
            address: row.address,
            asset: "USDC",
            amount: row.amount,
            note: row.reference,
          },
          requestIds.current[i]
        );
        complete.add(i);
        setSaved(new Set(complete));
      }
      onMessage(
        `${rows.length} payout drafts saved. No payments were executed.`
      );
    } catch (e) {
      setError(
        `${complete.size} of ${rows.length} drafts confirmed. ${
          e instanceof Error ? e.message : "Save failed"
        } Retry resumes remaining rows.`
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="st-steps">
        <span className="st-step-active">
          01 <b>Upload</b>
        </span>
        <span className={rows.length ? "st-step-active" : ""}>
          02 <b>Validate</b>
        </span>
        <span
          className={
            saved.size === rows.length && rows.length ? "st-step-active" : ""
          }
        >
          03 <b>Save drafts</b>
        </span>
      </div>
      <div className="st-two-columns">
        <Panel
          title="Batch payouts"
          subtitle="Import up to 100 recipients. USDC wallet payouts only."
        >
          <div className="st-panel-content">
            <label className="st-upload">
              <Upload size={30} />
              <strong>
                {busy ? "Processing…" : fileName || "Choose a CSV file"}
              </strong>
              <span>
                name, address, amount, network, reference · Max 100 KB
              </span>
              <input
                type="file"
                accept=".csv,text/csv"
                disabled={busy}
                onChange={(event) => void upload(event.target.files?.[0])}
                aria-label="Upload payout CSV"
              />
            </label>
            <button
              className="st-text-button"
              onClick={() =>
                downloadFile(
                  "furlpay-payout-template.csv",
                  csvDocument(
                    ["name", "address", "amount", "network", "reference"],
                    [
                      [
                        "Recipient name",
                        "REPLACE_WITH_VERIFIED_WALLET",
                        "100.00",
                        "arbitrum",
                        "Invoice reference",
                      ],
                    ]
                  ),
                  "text/csv"
                )
              }
            >
              <Download size={14} />
              Download CSV template
            </button>
            {error && (
              <p role="alert" className="st-error">
                {error}
              </p>
            )}
          </div>
        </Panel>
        <Panel title="Validation summary">
          <div className="st-panel-content">
            <dl className="st-summary">
              <div>
                <dt>Recipients</dt>
                <dd>{rows.length}</dd>
              </div>
              <div>
                <dt>Valid rows</dt>
                <dd>
                  {valid.length} / {rows.length}
                </dd>
              </div>
              <div>
                <dt>Total (valid rows)</dt>
                <dd>{formatNumber(total)} USDC</dd>
              </div>
              <div>
                <dt>Approval policy preview</dt>
                <dd>{approvalTier(total).label}</dd>
              </div>
            </dl>
            <p className="st-notice">
              Syntax validation only. Sanctions, ownership, liquidity, fees and
              authorizations must pass before execution.
            </p>
            <button
              className="st-button st-primary"
              disabled={
                busy ||
                !rows.length ||
                valid.length !== rows.length ||
                saved.size === rows.length
              }
              onClick={saveBatch}
            >
              <FileSpreadsheet size={16} />
              {busy
                ? `Saving ${saved.size}/${rows.length}…`
                : saved.size === rows.length && rows.length
                ? "Drafts saved"
                : "Save payout drafts"}
            </button>
          </div>
        </Panel>
      </div>
      {rows.length > 0 && (
        <Panel
          title="Recipient preview"
          subtitle="Correct invalid rows in your CSV and upload it again."
        >
          <div className="st-table-scroll">
            <table className="st-table">
              <thead>
                <tr>
                  <th>Row / recipient</th>
                  <th>Destination</th>
                  <th>Network</th>
                  <th>Amount · USDC</th>
                  <th>Validation</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.row}>
                    <td>
                      {row.row} · {row.name}
                    </td>
                    <td className="st-address-cell">{row.address}</td>
                    <td>{humanize(row.network)}</td>
                    <td className="st-number">{row.amount}</td>
                    <td>
                      {row.error ? (
                        <span className="st-error">{row.error}</span>
                      ) : (
                        <Badge tone="green">
                          {saved.has(index) ? "Draft saved" : "Syntax valid"}
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </>
  );
}

export function VirtualAccounts() {
  return (
    <>
      <div className="st-card-grid">
        {[
          {
            currency: "USD",
            region: "United States",
            rails: "ACH · FedNow · RTP",
          },
          { currency: "EUR", region: "Europe", rails: "SEPA · SEPA Instant" },
          {
            currency: "GBP",
            region: "United Kingdom",
            rails: "Faster Payments",
          },
        ].map((row) => (
          <Panel className="st-bank-card" key={row.currency}>
            <div className="st-between">
              <span className="st-feature-icon">
                <Landmark size={22} />
              </span>
              <Badge tone="amber">Not provisioned</Badge>
            </div>
            <h3>{row.currency} account</h3>
            <p>{row.region}</p>
            <div className="st-bank-number">•••• &nbsp; •••• &nbsp; ••••</div>
            <small>{row.rails}</small>
          </Panel>
        ))}
      </div>
      <Panel title="Local accounts, one workspace">
        <div className="st-panel-content">
          <div className="st-notice">
            Virtual accounts are not available yet. FurlPay must connect a
            contracted account-issuing partner before any bank account details
            can be issued.
          </div>
          <a className="st-button" href="/talk-to-us">
            <ShieldCheck size={16} />
            Discuss account availability <ArrowUpRight size={15} />
          </a>
        </div>
      </Panel>
    </>
  );
}
