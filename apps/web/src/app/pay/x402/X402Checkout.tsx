"use client";

import { useEffect, useMemo, useState } from "react";
import { Address } from "@/components/onchain/Address";
import { assertChain, type Connection } from "@/lib/wallet/connect";

// /pay/x402 — checkout for a resource that answered HTTP 402 (opened by the
// FurlPay browser extension). Every term shown here is what the RESOURCE ITSELF
// asks for, read server-side (/api/x402/checkout); the link that opened this
// page carries only the resource URL and the page it came from. The user's own
// wallet signs an EIP-3009 authorization for exactly those terms; the server
// re-reads the terms and verifies the signature before delivering it.

interface Terms {
  resource: string;
  x402Version: 1 | 2;
  network: string;
  chainId: number;
  asset: string;
  payTo: string;
  amountAtomic: string;
  amountUsdc: string;
  maxTimeoutSeconds: number;
  description: string | null;
  domainName: string;
  domainVersion: string;
}
interface Paid {
  status: number;
  receipt: unknown;
  contentType: string | null;
  bodyPreview: string;
}
type Eip1193 = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };

const NETWORK_LABEL: Record<string, string> = { ethereum: "Ethereum", base: "Base", arbitrum: "Arbitrum One", polygon: "Polygon" };

/** resource + origin from ?resource=&origin=, or the legacy ?x402=<encoded params> link. */
export function readParams(search: URLSearchParams): { resource: string | null; origin: string | null } {
  const legacy = search.get("x402");
  const p = legacy ? new URLSearchParams(legacy) : search;
  return { resource: p.get("resource"), origin: p.get("origin") };
}

const hostOf = (u: string | null) => {
  try {
    return u ? new URL(u).host : null;
  } catch {
    return null;
  }
};

export default function X402Checkout({ search }: { search: string }) {
  const { resource, origin } = useMemo(() => readParams(new URLSearchParams(search)), [search]);
  const [terms, setTerms] = useState<Terms | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [paid, setPaid] = useState<Paid | null>(null);

  useEffect(() => {
    if (!resource) {
      setError("No resource to pay was provided.");
      return;
    }
    let live = true;
    fetch(`/api/x402/checkout?resource=${encodeURIComponent(resource)}`, { cache: "no-store" })
      .then(async (r) => {
        const b = (await r.json().catch(() => null)) as { ok: true; data: Terms } | { ok: false; error?: { message?: string } } | null;
        if (!live) return;
        if (b && b.ok) setTerms(b.data);
        else setError((b && !b.ok && b.error?.message) || (r.status === 401 ? "Sign in to FurlPay to pay." : `Could not read the payment terms (${r.status}).`));
      })
      .catch(() => live && setError("Network error."));
    return () => {
      live = false;
    };
  }, [resource]);

  const mismatch = origin && terms && hostOf(origin) !== hostOf(terms.resource);

  async function pay() {
    if (!terms) return;
    const eth = (globalThis as { ethereum?: Eip1193 }).ethereum;
    if (!eth) {
      setError("No Ethereum wallet found in this browser. Open this page where your wallet is installed.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const [from] = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${terms.chainId.toString(16)}` }] });
      const now = Math.floor(Date.now() / 1000);
      const nonce = `0x${Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("")}`;
      const authorization = { from, to: terms.payTo, value: terms.amountAtomic, validAfter: String(now - 5), validBefore: String(now + Math.min(terms.maxTimeoutSeconds, 600)), nonce };
      const typed = {
        domain: { name: terms.domainName, version: terms.domainVersion, chainId: terms.chainId, verifyingContract: terms.asset },
        types: {
          EIP712Domain: [
            { name: "name", type: "string" },
            { name: "version", type: "string" },
            { name: "chainId", type: "uint256" },
            { name: "verifyingContract", type: "address" },
          ],
          TransferWithAuthorization: [
            { name: "from", type: "address" },
            { name: "to", type: "address" },
            { name: "value", type: "uint256" },
            { name: "validAfter", type: "uint256" },
            { name: "validBefore", type: "uint256" },
            { name: "nonce", type: "bytes32" },
          ],
        },
        primaryType: "TransferWithAuthorization",
        message: authorization,
      };
      // A LIVE eth_chainId read immediately before signing: the switch above can
      // be declined or raced, and the typed data binds the chain id.
      await assertChain({ address: from, chainId: terms.chainId, provider: eth as Connection["provider"], rdns: "injected", name: "Browser wallet" }, terms.chainId);
      const signature = (await eth.request({ method: "eth_signTypedData_v4", params: [from, JSON.stringify(typed)] })) as string;
      const r = await fetch("/api/x402/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ resource: terms.resource, authorization, signature }) });
      const b = (await r.json().catch(() => null)) as { ok: true; data: Paid } | { ok: false; error?: { message?: string } } | null;
      if (b && b.ok) setPaid(b.data);
      else setError((b && !b.ok && b.error?.message) || `Payment failed (${r.status}).`);
    } catch (e) {
      setError((e as { message?: string }).message?.slice(0, 200) ?? "The wallet refused the request.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-[640px] px-4 py-10 text-white">
      <h1 className="text-[22px] font-semibold tracking-[-0.01em]">Pay for this resource</h1>
      <p className="mt-1 text-[13px] text-white/55">Terms below are read from the resource itself, not from the link that opened this page.</p>

      {error && (
        <p role="alert" className="mt-4 rounded-lg border border-[#FF4D6D]/30 bg-[#FF4D6D]/[0.06] px-3 py-2 text-[13px] text-[#FFB3C1]">
          {error}
        </p>
      )}

      {!terms && !error && <div className="mt-6 h-[180px] animate-pulse rounded-[10px] border border-white/[0.06] bg-white/[0.02]" aria-busy="true" aria-label="Reading payment terms" />}

      {terms && (
        <section className="mt-6 rounded-[10px] border border-white/[0.08] bg-[#0A0F10] px-4 py-4 text-[13px]">
          <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2.5">
            <dt className="text-white/50">Amount</dt>
            <dd className="font-mono tabular-nums text-[15px] font-semibold">{terms.amountUsdc} USDC</dd>
            <dt className="text-white/50">Network</dt>
            <dd>{NETWORK_LABEL[terms.network] ?? terms.network}</dd>
            <dt className="text-white/50">Recipient</dt>
            <dd className="min-w-0"><Address value={terms.payTo} label="recipient" /></dd>
            <dt className="text-white/50">Resource</dt>
            <dd className="min-w-0 break-all font-mono text-[12px] text-white/80">{terms.resource}</dd>
            {terms.description && (
              <>
                <dt className="text-white/50">For</dt>
                <dd>{terms.description}</dd>
              </>
            )}
            {origin && (
              <>
                <dt className="text-white/50">Requested by</dt>
                <dd className="break-all">{origin}</dd>
              </>
            )}
          </dl>
          {mismatch && (
            <p className="mt-3 rounded-md border border-[#F5B83D]/30 bg-[#F5B83D]/[0.06] px-3 py-2 text-[12px] text-[#F5B83D]">
              The page that asked ({hostOf(origin)}) is not the site being paid ({hostOf(terms.resource)}). Pay only if you expected this.
            </p>
          )}
          {!paid && (
            <button
              type="button"
              onClick={() => void pay()}
              disabled={busy}
              className="mt-4 w-full rounded-lg bg-[#00E599] px-4 py-2.5 text-[14px] font-semibold text-black disabled:opacity-60"
            >
              {busy ? "Waiting for your wallet…" : `Pay ${terms.amountUsdc} USDC with your wallet`}
            </button>
          )}
        </section>
      )}

      {paid && (
        <section className="mt-4 rounded-[10px] border border-white/[0.08] bg-[#0A0F10] px-4 py-4 text-[13px]">
          <p className={paid.status < 400 ? "text-[#00E599]" : "text-[#F5B83D]"}>
            {paid.status < 400 ? "Payment delivered. The resource answered:" : `The resource answered HTTP ${paid.status} to the payment.`}
          </p>
          {paid.receipt !== null && <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded bg-black/40 p-2 text-[11.5px] text-white/75">{JSON.stringify(paid.receipt, null, 2)}</pre>}
          {paid.bodyPreview && <pre className="mt-2 max-h-[320px] overflow-auto whitespace-pre-wrap break-all rounded bg-black/40 p-2 text-[11.5px] text-white/75">{paid.bodyPreview}</pre>}
        </section>
      )}
    </main>
  );
}
