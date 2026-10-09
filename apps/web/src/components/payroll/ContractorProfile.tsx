"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toHex } from "viem";
import { PenLine, ShieldCheck } from "lucide-react";
import { FurlPayMark } from "@/components/trips/FurlPayLogo";
import { request } from "@/components/merchant/shared";
import { paymentChain } from "@/lib/payments/merchant/registry";
import { useDiscoveredWallets } from "@/lib/wallet/mipd";
import { assertChain } from "@/lib/wallet/connect";
import { payoutAddressMessage } from "@/lib/payroll/addressMessage";

// The contractor's payout wallet. The wallet that will be paid signs a message
// naming this contractor profile and chain (EIP-191); the server verifies the
// signer is the address, screens it, and from then on the employer cannot edit it.
// Signing authorizes no payment.
type Profile = { id: string; name: string; role: string; country: string; payout_chain: string; payout_address: string; address_verified_at: string | null; active: boolean };

export default function ContractorProfile() {
  const [profiles, setProfiles] = useState<Profile[] | null>(null); const [error, setError] = useState("");
  const load = useCallback(async () => {
    setError("");
    try { setProfiles((await request<{ profiles: Profile[] }>("/api/payouts/payroll/me")).profiles); } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return <div className="os mp-workspace"><main className="mp-main" style={{ maxWidth: 720, margin: "32px auto" }}>
    <Link className="mp-brand" href="/"><FurlPayMark size={27} /><b>FurlPay</b><span>Payroll</span></Link>
    <div className="mp-page-heading"><div><span className="mp-eyebrow">CONTRACTOR</span><h1>Your payroll</h1><p>Each employer that invited you appears here. Choose the wallet you&apos;re paid to.</p></div></div>
    {error && <p className="mp-error" role="alert">{error}</p>}
    {profiles && !profiles.length && <div className="mp-empty"><p>No payroll profiles yet. Open the invite link your employer sent you.</p></div>}
    {profiles?.map(p => <ProfileCard key={p.id} profile={p} onSaved={() => void load()} />)}
  </main></div>;
}

function ProfileCard({ profile, onSaved }: { profile: Profile; onSaved: () => void }) {
  const wallets = useDiscoveredWallets();
  const [wallet, setWallet] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const chain = paymentChain(profile.payout_chain);
  async function prove() {
    setBusy(true); setError("");
    try {
      const provider = wallets.find(w => w.info.uuid === wallet)?.provider;
      if (!provider || chain.chainId === null) throw new Error("Choose a wallet");
      const address = (await provider.request({ method: "eth_requestAccounts" }) as string[])[0];
      const message = payoutAddressMessage(profile.id, profile.payout_chain, address);
      // The message names the chain; make sure the wallet is on it before it signs anything.
      await assertChain({ address, chainId: chain.chainId, provider, rdns: "", name: "" }, chain.chainId);
      const signature = await provider.request({ method: "personal_sign", params: [toHex(message), address] }) as string;
      await request("/api/payouts/payroll/me", { method: "PATCH", body: JSON.stringify({ contractorId: profile.id, payoutAddress: address, signature }) });
      onSaved();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section className="mp-table-card" style={{ padding: 16 }}>
    <h2>{profile.name}{profile.role ? ` · ${profile.role}` : ""}</h2>
    <dl><div><dt>Paid in USDC on</dt><dd>{chain.name}</dd></div>
      <div><dt>Payout wallet</dt><dd><code>{profile.payout_address}</code></dd></div>
      <div><dt>Status</dt><dd>{profile.address_verified_at ? <><ShieldCheck size={14} /> Proven by you {new Date(profile.address_verified_at).toLocaleDateString()}</> : "Entered by your employer, not yet proven"}</dd></div></dl>
    <div className="mp-heading-actions">
      <select aria-label="Wallet" value={wallet} onChange={e => setWallet(e.target.value)}><option value="">Choose a wallet</option>{wallets.map(w => <option key={w.info.uuid} value={w.info.uuid}>{w.info.name}</option>)}</select>
      <button className="mp-button primary" disabled={busy || !wallet} onClick={() => void prove()}><PenLine size={15} />{busy ? "Check your wallet…" : profile.address_verified_at ? "Change payout wallet" : "Prove and use this wallet"}</button>
    </div>
    {error && <p className="mp-error" role="alert">{error}</p>}
    <p className="mp-muted">Signing only proves the wallet is yours. It cannot move funds.</p>
  </section>;
}
