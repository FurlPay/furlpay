"use client";
import { useEffect, useState } from "react";
import { encodeFunctionData } from "viem";
import { Download, PenLine, RotateCcw, Send, ShieldCheck } from "lucide-react";
import { downloadJson, request } from "@/components/merchant/shared";
import { displayUsdc } from "@/lib/payments/merchant/money";
import { paymentChain } from "@/lib/payments/merchant/registry";
import { useDiscoveredWallets, type EIP6963ProviderDetail } from "@/lib/wallet/mipd";
import { assertChain } from "@/lib/wallet/connect";
import { ERC20_ABI, ROUTER_ABI } from "@/lib/payroll/routerAbi";
import type { Batch, BatchLine } from "@/lib/payroll/model";
import type { SignData } from "@/lib/payroll/signing";

// Resumable signing and execution for a payroll batch.
//
// Signing: every request is read back from the database, so a refresh loses
// nothing; the server verifies each signature before storing it.
// Execution: the EMPLOYER's wallet approves exactly the batch total to the
// chain's FurlPayRouter and calls batchPay; FurlPay holds no keys and relays
// nothing. The transaction hash is then sent to the server, which marks lines
// paid only after re-reading the receipt from the chain.
const EIP712_DOMAIN = [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }];
type Detail = { batch: Batch; lines: BatchLine[]; executionAvailable?: boolean; router?: string | null; token?: string; chainId?: number };
type Provider = EIP6963ProviderDetail["provider"];
const state = (l: BatchLine, now: number) => l.executed_tx ? "paid" : l.signature && l.sign_deadline && Date.parse(l.sign_deadline) <= now ? "expired" : l.signature ? "signed" : !l.sign_deadline ? "missing" : Date.parse(l.sign_deadline) <= now ? "expired" : "pending";
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function waitForReceipt(provider: Provider, hash: string) {
  for (let i = 0; i < 120; i++) {
    const r = await provider.request({ method: "eth_getTransactionReceipt", params: [hash] }) as { status?: string } | null;
    if (r) { if (r.status !== "0x1") throw new Error("The approval transaction failed"); return; }
    await sleep(2000);
  }
  throw new Error("The approval is still pending; try again once it confirms");
}

export default function SigningPanel({ detail, onChanged, onReissue }: { detail: Detail; onChanged: () => void; onReissue: () => void }) {
  const wallets = useDiscoveredWallets();
  const [wallet, setWallet] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [progress, setProgress] = useState("");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(t); }, []);
  const counts = detail.lines.reduce((m, l) => { m[state(l, now)]++; return m; }, { paid: 0, signed: 0, pending: 0, expired: 0, missing: 0 } as Record<string, number>);
  const outstanding = detail.lines.filter(l => !l.executed_tx);
  const firstDeadline = outstanding.filter(l => l.sign_deadline).map(l => Date.parse(l.sign_deadline!)).sort()[0];
  const explorer = paymentChain(detail.batch.chain).explorer;
  const canExecute = detail.batch.status === "submitted" && detail.executionAvailable && outstanding.length > 0 && outstanding.every(l => state(l, now) === "signed") && firstDeadline - now > 60_000;

  async function connect(): Promise<{ provider: Provider; account: string }> {
    const provider = wallets.find(w => w.info.uuid === wallet)?.provider;
    if (!provider) throw new Error("Choose a wallet");
    const account = (await provider.request({ method: "eth_requestAccounts" }) as string[])[0];
    if (detail.batch.payer_address && account.toLowerCase() !== detail.batch.payer_address.toLowerCase()) throw new Error(`Switch to ${detail.batch.payer_address}, the wallet that signed this batch`);
    return { provider, account };
  }

  async function signAll() {
    setError(""); setBusy(true);
    try {
      const { provider, account } = await connect();
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

  async function execute() {
    setError(""); setBusy(true);
    try {
      const { provider, account } = await connect();
      const router = detail.router!, token = detail.token!, chainId = detail.chainId!;
      const signed = outstanding.map(l => ({ l, m: (l.sign_data as SignData).message }));
      const total = signed.reduce((s, x) => s + BigInt(x.m.amount), 0n);
      await assertChain({ address: account, chainId, provider, rdns: "", name: "" }, chainId);
      const allowance = BigInt(await provider.request({ method: "eth_call", params: [{ to: token, data: encodeFunctionData({ abi: ERC20_ABI, functionName: "allowance", args: [account as `0x${string}`, router as `0x${string}`] }) }, "latest"] }) as string);
      if (allowance < total) {
        setProgress(`Approve exactly ${displayUsdc(total)} USDC for FurlPayRouter`);
        await assertChain({ address: account, chainId, provider, rdns: "", name: "" }, chainId);
        const approval = await provider.request({ method: "eth_sendTransaction", params: [{ from: account, to: token, data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [router as `0x${string}`, total] }) }] }) as string;
        setProgress("Waiting for the approval to confirm…");
        await waitForReceipt(provider, approval);
      }
      setProgress(`Paying ${signed.length} contractors`);
      const data = encodeFunctionData({ abi: ROUTER_ABI, functionName: "batchPay", args: [
        signed.map(({ m }) => ({ paymentId: m.paymentId, recipient: m.recipient as `0x${string}`, amount: BigInt(m.amount), fee: BigInt(m.fee), nonce: m.nonce as `0x${string}`, deadline: BigInt(m.deadline) })),
        signed.map(() => account as `0x${string}`),
        signed.map(({ l }) => l.signature as `0x${string}`),
      ] });
      await assertChain({ address: account, chainId, provider, rdns: "", name: "" }, chainId);
      const txHash = await provider.request({ method: "eth_sendTransaction", params: [{ from: account, to: router, data }] }) as string;
      // The server marks lines paid only from the chain's own receipt; retry while it confirms.
      for (let i = 0; i < 60; i++) {
        setProgress(`Verifying ${txHash.slice(0, 10)}… on-chain`);
        try { await request("/api/payouts/payroll/batches", { method: "PATCH", body: JSON.stringify({ id: detail.batch.id, action: "record_execution", txHash }) }); setProgress(""); return; }
        catch (e) { if (!/not on-chain yet|Waiting for confirmations|reorganized/.test((e as Error).message)) throw new Error(`${(e as Error).message} (transaction ${txHash})`); }
        await sleep(5000);
      }
      throw new Error(`Still confirming. Transaction ${txHash} — reopen this batch to verify it later.`);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); onChanged(); }
  }

  return <section className="mp-detail" aria-label="Signing and execution">
    <h3>{detail.batch.status === "completed" ? "Paid on-chain" : "Awaiting signatures"}</h3>
    <p>{counts.paid ? `${counts.paid} paid · ` : ""}{counts.signed} signed of {outstanding.length} outstanding{counts.expired ? ` · ${counts.expired} expired` : ""}{firstDeadline && !counts.expired ? ` · next request expires ${new Date(firstDeadline).toLocaleTimeString()}` : ""}</p>
    <ul>{detail.lines.map(l => { const s = state(l, now); const m = (l.sign_data as SignData | null)?.message; return <li key={l.id}><strong>{l.name}</strong> · {displayUsdc(BigInt(String(l.amount_units)))} USDC{m ? ` (+${displayUsdc(BigInt(m.fee))} fee)` : ""} · {s === "paid" ? <a href={`${explorer}/tx/${l.executed_tx}`} target="_blank" rel="noopener noreferrer"><ShieldCheck size={13} /> Paid, verified on-chain</a> : s === "signed" ? <><ShieldCheck size={13} /> Signed</> : s === "expired" ? "Expired — re-issue" : s === "pending" ? "Ready to sign" : "No request"}</li>; })}</ul>
    {(counts.pending > 0 || canExecute) && <div className="mp-heading-actions">
      <select aria-label="Wallet" value={wallet} onChange={e => setWallet(e.target.value)}><option value="">Choose a wallet</option>{wallets.map(w => <option key={w.info.uuid} value={w.info.uuid}>{w.info.name}</option>)}</select>
      {counts.pending > 0 && <button className="mp-button primary" disabled={busy || !wallet} onClick={() => void signAll()}><PenLine size={15} />{busy ? progress || "Waiting for wallet…" : `Sign ${counts.pending} remaining`}</button>}
      {canExecute && <button className="mp-button primary" disabled={busy || !wallet} onClick={() => void execute()}><Send size={15} />{busy ? progress || "Waiting for wallet…" : "Execute batch on-chain"}</button>}
    </div>}
    {counts.expired > 0 && <button className="mp-button secondary" disabled={busy} onClick={onReissue}><RotateCcw size={15} />Re-issue {counts.expired} expired</button>}
    {error && <p className="mp-error" role="alert">{error}</p>}
    {!detail.executionAvailable && detail.batch.status === "submitted" && <p>Execution is not available: no FurlPayRouter is configured on {detail.batch.chain}. Signatures are kept but expire, and nothing has been paid.</p>}
    {canExecute && <p>Executing approves exactly the batch total to FurlPayRouter and pays every signed line in one transaction from your wallet. Each contractor receives their full amount; the 0.35% fee is added on top.</p>}
    <button className="mp-button secondary" onClick={() => downloadJson(detail, `furlpay-payroll-${detail.batch.cycle}.json`)}><Download size={15} />Download signing requests</button>
  </section>;
}
