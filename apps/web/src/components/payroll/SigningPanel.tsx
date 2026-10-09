"use client";
import { useEffect, useState } from "react";
import { Download, PenLine, RotateCcw, ShieldCheck } from "lucide-react";
import { downloadJson, request } from "@/components/merchant/shared";
import { displayUsdc } from "@/lib/payments/merchant/money";
import { useDiscoveredWallets } from "@/lib/wallet/mipd";
import { assertChain } from "@/lib/wallet/connect";
import type { Batch, BatchLine } from "@/lib/payroll/model";
import type { SignData } from "@/lib/payroll/signing";

// Resumable signing for a submitted payroll batch. Every signing request is
// read back from the database, so a refresh loses nothing. Each signature is
// verified by the server (EIP-712 recovery, router-compatible encoding) before
// it is stored. Signing authorizes nothing to move until the authorizations are
// executed on FurlPayRouter; execution is shown as unavailable until a reviewed
// router is deployed.
const EIP712_DOMAIN = [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }];
type Detail = { batch: Batch; lines: BatchLine[]; executionAvailable?: boolean };
const state = (l: BatchLine, now: number) => l.signature ? "signed" : !l.sign_deadline ? "missing" : Date.parse(l.sign_deadline) <= now ? "expired" : "pending";

export default function SigningPanel({ detail, onChanged, onReissue }: { detail: Detail; onChanged: () => void; onReissue: () => void }) {
  const wallets = useDiscoveredWallets();
  const [wallet, setWallet] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [progress, setProgress] = useState("");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(t); }, []);
  const counts = detail.lines.reduce((m, l) => { m[state(l, now)]++; return m; }, { signed: 0, pending: 0, expired: 0, missing: 0 } as Record<string, number>);
  const firstDeadline = detail.lines.filter(l => state(l, now) === "pending").map(l => Date.parse(l.sign_deadline!)).sort()[0];

  async function signAll() {
    setError(""); setBusy(true);
    try {
      const provider = wallets.find(w => w.info.uuid === wallet)?.provider;
      if (!provider) throw new Error("Choose a wallet");
      const accounts = await provider.request({ method: "eth_requestAccounts" }) as string[];
      const account = accounts[0];
      if (detail.batch.payer_address && account.toLowerCase() !== detail.batch.payer_address.toLowerCase()) throw new Error(`Switch to ${detail.batch.payer_address}, the wallet that signed this batch`);
      const todo = detail.lines.filter(l => state(l, Date.now()) === "pending");
      for (const [n, l] of todo.entries()) {
        const data = l.sign_data as SignData;
        setProgress(`Signing ${n + 1} of ${todo.length}: ${l.name}`);
        // The chain is part of what gets signed: verify it immediately before every request.
        await assertChain({ address: account, chainId: data.domain.chainId, provider, rdns: "", name: "" }, data.domain.chainId);
        const signature = await provider.request({ method: "eth_signTypedData_v4", params: [account, JSON.stringify({ ...data, types: { EIP712Domain: EIP712_DOMAIN, ...data.types } })] }) as string;
        await request("/api/payouts/payroll/batches", { method: "PATCH", body: JSON.stringify({ id: detail.batch.id, action: "sign", lineId: l.id, signature }) });
      }
      setProgress("");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); onChanged(); }
  }

  return <section className="mp-detail" aria-label="Signing">
    <h3>Awaiting signatures</h3>
    <p>{counts.signed} of {detail.lines.length} signed{counts.expired ? ` · ${counts.expired} expired` : ""}{firstDeadline ? ` · next request expires ${new Date(firstDeadline).toLocaleTimeString()}` : ""}</p>
    <ul>{detail.lines.map(l => { const s = state(l, now); return <li key={l.id}><strong>{l.name}</strong> · {displayUsdc(BigInt(String(l.amount_units)))} USDC · {s === "signed" ? <><ShieldCheck size={13} /> Signed by <code>{l.signer?.slice(0, 8)}…</code></> : s === "expired" ? "Expired — re-issue" : s === "pending" ? "Ready to sign" : "No request"}</li>; })}</ul>
    {counts.pending > 0 && <div className="mp-heading-actions">
      <select aria-label="Wallet" value={wallet} onChange={e => setWallet(e.target.value)}><option value="">Choose a wallet</option>{wallets.map(w => <option key={w.info.uuid} value={w.info.uuid}>{w.info.name}</option>)}</select>
      <button className="mp-button primary" disabled={busy || !wallet} onClick={() => void signAll()}><PenLine size={15} />{busy ? progress || "Waiting for wallet…" : `Sign ${counts.pending} remaining`}</button>
    </div>}
    {counts.expired > 0 && <button className="mp-button secondary" disabled={busy} onClick={onReissue}><RotateCcw size={15} />Re-issue {counts.expired} expired</button>}
    {error && <p className="mp-error" role="alert">{error}</p>}
    <p>{detail.executionAvailable
      ? "A FurlPayRouter address is configured, but executing signed authorizations from this page is not built yet. Signatures expire at their deadline; nothing has been paid."
      : "Execution is not available yet: FurlPayRouter has not been deployed for this environment. Signatures are kept, but they expire, and nothing has been paid."}</p>
    <button className="mp-button secondary" onClick={() => downloadJson(detail, `furlpay-payroll-${detail.batch.cycle}.json`)}><Download size={15} />Download signing requests</button>
  </section>;
}
