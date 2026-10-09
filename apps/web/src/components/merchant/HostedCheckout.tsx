"use client";
import Link from "next/link";
import { useCallback,useEffect,useRef,useState } from "react";
import { ArrowRight,Check,CheckCircle2,Clock3,Download,ExternalLink,LockKeyhole,Printer,RefreshCw,ShieldCheck,Wallet } from "lucide-react";
import { FurlPayMark } from "@/components/trips/FurlPayLogo";
import { useDiscoveredWallets } from "@/lib/wallet/mipd";
import { assertChain } from "@/lib/wallet/connect";
import { paymentChain,type PaymentChainId } from "@/lib/payments/merchant/registry";
import { displayUsdc,parseUsdc } from "@/lib/payments/merchant/money";
import { isPaid,type PublicIntent,type PublicLink } from "@/lib/payments/merchant/model";
import { ChainMark,CopyButton,Qr,Status,downloadJson,request } from "./shared";
type Poll={intent:PublicIntent;uri:string|null;verificationDelayed?:boolean};
export default function HostedCheckout({slug,embedded=false}:{slug:string;embedded?:boolean}) {
  const [link,setLink]=useState<PublicLink|null>(null);const [ready,setReady]=useState<PaymentChainId[]>([]);const [chain,setChain]=useState<PaymentChainId>("arc");
  const [payment,setPayment]=useState<Poll|null>(null);const [error,setError]=useState("");const [busy,setBusy]=useState(false);const [loading,setLoading]=useState(true);
  const [now,setNow]=useState(Date.now());const [mode,setMode]=useState<"qr"|"wallet">("qr");const [selectedWallet,setSelectedWallet]=useState("");const [broadcast,setBroadcast]=useState(false);
  const providers=useDiscoveredWallets();const requestId=useRef<string|null>(null);const sound=useRef<AudioContext|null>(null);const sounded=useRef(false);
  const endpoint=`/api/checkout/merchant/${encodeURIComponent(slug)}`;
  const load=useCallback(async()=>{
    setLoading(true);setError("");
    try {
      const data=await request<{link:PublicLink;readyChains:PaymentChainId[]}>(endpoint);setLink(data.link);setReady(data.readyChains);setChain(data.readyChains[0]??data.link.chains[0]);
      let saved:string|null=null;try{saved=sessionStorage.getItem(`mp:${slug}`);}catch{/* Storage may be unavailable in a private browser. */}
      if(saved && /^[0-9a-f-]{36}$/i.test(saved)){const recovered=await request<Poll>(`${endpoint}?intent=${saved}`);setPayment(recovered);}
    }catch(e){setError((e as Error).message);}finally{setLoading(false);}
  },[endpoint,slug]);
  useEffect(()=>{void load();},[load]);
  useEffect(()=>{const t=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(t);},[]);
  const intent=payment?.intent;
  useEffect(()=>{
    if(!intent || isPaid(intent.status)||intent.status==="review")return;
    let alive=true;let timer:ReturnType<typeof setTimeout>;
    async function poll(){
      try{const data=await request<Poll>(`${endpoint}?intent=${intent!.id}`);if(alive){setPayment(data);setError("");}}
      catch{if(alive)setError("Payment status is temporarily unavailable. Your payment has not been marked as failed.");}
      if(alive)timer=setTimeout(()=>void poll(),6000);
    }
    timer=setTimeout(()=>void poll(),3000);return()=>{alive=false;clearTimeout(timer);};
  },[endpoint,intent?.id,intent?.status]);
  useEffect(()=>{
    if(!intent || !isPaid(intent.status)||sounded.current||!sound.current)return;
    sounded.current=true;const ctx=sound.current;const oscillator=ctx.createOscillator();const gain=ctx.createGain();oscillator.connect(gain);gain.connect(ctx.destination);oscillator.frequency.setValueAtTime(660,ctx.currentTime);oscillator.frequency.setValueAtTime(880,ctx.currentTime+.12);gain.gain.setValueAtTime(.08,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.45);oscillator.start();oscillator.stop(ctx.currentTime+.45);
  },[intent]);
  useEffect(()=>()=>{void sound.current?.close();},[]);
  async function begin(){
    setBusy(true);setError("");
    if(embedded&&!sound.current){try{sound.current=new AudioContext();void sound.current.resume();}catch{/* Audio is optional. */}}
    const id=requestId.current??crypto.randomUUID();requestId.current=id;
    // Save before submitting: an interrupted response must recover the SAME
    // intent, never consume another destination or request a second payment.
    try{sessionStorage.setItem(`mp:${slug}`,id);}catch{/* still idempotent while mounted */}
    try{const data=await request<Poll>(endpoint,{method:"POST",body:JSON.stringify({requestId:id,chain})});setPayment(data);}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function payWallet(){
    if(!intent)return;setBusy(true);setError("");
    try{
      const fresh=await request<Poll>(`${endpoint}?intent=${intent.id}`);setPayment(fresh);
      if(!fresh.uri || fresh.verificationDelayed || isPaid(fresh.intent.status) || fresh.intent.status==="confirming")throw new Error("Wait for the current payment status before sending.");
      const network=paymentChain(fresh.intent.chain);
      const provider=providers.find(p=>p.info.uuid===selectedWallet)?.provider;
      if(!provider || network.chainId===null)throw new Error("Choose an installed wallet, or scan the QR with your mobile wallet.");
      const accounts=await provider.request({method:"eth_requestAccounts"}) as string[];
      if(!Array.isArray(accounts)||!/^0x[0-9a-fA-F]{40}$/.test(accounts[0]))throw new Error("Wallet did not provide a valid address.");
      await provider.request({method:"wallet_switchEthereumChain",params:[{chainId:`0x${network.chainId.toString(16)}`} ]});
      if(Date.parse(fresh.intent.expiresAt)<=Date.now())throw new Error("The payment window has ended.");
      const units=BigInt(fresh.intent.charge)-BigInt(fresh.intent.received);
      const data=`0xa9059cbb${fresh.intent.recipient.slice(2).padStart(64,"0")}${units.toString(16).padStart(64,"0")}`;
      // transfer(), never approve(); wallet confirmation shows the exact token,
      // recipient and amount. Its response is NOT accepted as payment evidence.
      // Live eth_chainId check immediately before the send (signing-path ratchet):
      // the same token address and calldata on another chain must never be sent.
      await assertChain({address:accounts[0],chainId:network.chainId,provider,rdns:"",name:""},network.chainId);
      await provider.request({method:"eth_sendTransaction",params:[{from:accounts[0],to:network.token,data,value:"0x0"}]});
      setBroadcast(true);
    }catch(e){setError(e instanceof Error?e.message:"Wallet request was not completed.");}finally{setBusy(false);}
  }
  const paid=!!intent&&isPaid(intent.status);
  const closed=!!link&&(!link.active || (!!link.expiresAt&&Date.parse(link.expiresAt)<=now));
  const seconds=intent?Math.max(0,Math.ceil((Date.parse(intent.expiresAt)-now)/1000)):0;
  const canSend=!!payment?.uri&&seconds>0&&!paid&&intent?.status!=="review";
  return <div className={`os mp-checkout ${embedded?"mp-embedded":""}`}>
    {!embedded&&<header className="mp-checkout-header"><Link href="/" className="mp-brand"><FurlPayMark size={27}/><b>FurlPay</b></Link><span><LockKeyhole size={13}/>Secure checkout</span></header>}
    {loading?<div className="mp-checkout-loading" role="status"><RefreshCw size={24} className="mp-spin"/>Loading payment details…</div>:!link?<div className="mp-checkout-loading"><h1>Checkout unavailable</h1><p role="alert">{error}</p><button className="mp-button secondary" onClick={()=>void load()}>Try again</button></div>:<main className="mp-checkout-grid">
      <section className="mp-order"><span className="mp-eyebrow">{link.kind==="invoice"?"INVOICE":"PAYMENT TO"}</span><h1>{link.merchantName}</h1><p>{link.title}</p><div className="mp-order-amount"><img src="/logos/coins/usdc.svg" alt="" width={32} height={32}/><strong>{displayUsdc(link.amount)}</strong><span>USDC</span></div><p className="mp-order-description">{link.description}</p>
        {link.lines.length>0&&<div className="mp-order-lines">{link.lines.map((l,j)=><div key={j}><span>{l.description} <small>× {l.quantity}</small></span><b>{displayUsdc(BigInt(l.quantity)*parseUsdc(l.unitPrice))}</b></div>)}</div>}
        <dl><div><dt>Payment reference</dt><dd>{link.reference||slug.slice(0,12)}</dd></div><div><dt>Asset</dt><dd>Native USDC</dd></div><div><dt>Processing fee</dt><dd>{link.feePayer==="merchant"?"Covered by merchant":`${displayUsdc(link.pricing.fee)} USDC`}</dd></div></dl>
        <div className="mp-order-trust"><ShieldCheck size={23}/><div><strong>Verified before it’s marked paid</strong><p>FurlPay checks the network, token and received amount automatically.</p></div></div><Link className="mp-text-link" href="/support">Need help with this payment?<ArrowRight size={14}/></Link>
      </section>
      <section className="mp-payment-panel">
        {paid?<div className="mp-success" aria-live="polite"><span className="mp-success-icon"><CheckCircle2 size={44}/></span><span className="mp-eyebrow">PAYMENT RECEIVED</span><h2>All paid. Thank you.</h2><p>{displayUsdc(intent!.charge)} USDC verified on {paymentChain(intent!.chain).name}.</p>{intent!.status==="overpaid"&&<p className="mp-notice">Excess received: {displayUsdc(BigInt(intent!.received)-BigInt(intent!.charge))} USDC. It is held separately for review.</p>}<div className="mp-receipt"><span>Payment ID</span><code>{intent!.id}</code><span>Confirmed</span><b>{intent!.paidAt?new Date(intent!.paidAt).toLocaleString():"Verified"}</b></div><button className="mp-button primary" onClick={()=>downloadJson({merchant:link.merchantName,title:link.title,...intent},`furlpay-receipt-${intent!.id}.json`)}><Download size={16}/>Download receipt</button><button className="mp-button secondary" onClick={()=>window.print()}><Printer size={16}/>Print receipt</button>{intent!.transactionHash&&<a className="mp-text-link" href={`${paymentChain(intent!.chain).explorer}/tx/${encodeURIComponent(intent!.transactionHash)}`} target="_blank" rel="noopener noreferrer">View transaction<ExternalLink size={14}/></a>}</div>:<>
          <div className="mp-payment-heading"><div><span className="mp-eyebrow">PAY WITH STABLECOINS</span><h2>{intent?"Complete your payment":"Choose your network"}</h2></div><img src="/logos/coins/usdc.svg" alt="USDC" width={32} height={32}/></div>
          {!intent?<><p className="mp-muted">Use the network where you hold native USDC.</p><div className="mp-checkout-chains">{link.chains.map(id=><button key={id} type="button" aria-pressed={chain===id} disabled={!ready.includes(id)||closed} onClick={()=>{setChain(id);requestId.current=null;}}><ChainMark chain={id} size={30}/><span><strong>{paymentChain(id).name}</strong><small>{!ready.includes(id)?"Temporarily unavailable":id==="arc"?"Gas paid in USDC":`Requires ${paymentChain(id).gas} for gas`}</small></span>{chain===id&&<Check size={18}/>}</button>)}</div><div className="mp-checkout-total"><span>Total to send</span><b>{displayUsdc(link.pricing.charge)} USDC</b></div><p className="mp-fine">Your wallet calculates the network fee separately before you approve.</p>{closed&&<p className="mp-notice">This payment link is closed. Contact the merchant for a new link.</p>}{!ready.length&&!closed&&<p className="mp-notice">The merchant’s payment networks are not ready yet. Please check back later.</p>}<button className="mp-button primary" onClick={()=>void begin()} disabled={busy||closed||!ready.includes(chain)}>{busy?"Preparing checkout…":"Continue to payment"}<ArrowRight size={16}/></button></>:<>
          <div className="mp-active-network"><ChainMark chain={intent.chain}/><strong>{paymentChain(intent.chain).name}</strong><span><Clock3 size={13}/>{Math.floor(seconds/60)}:{String(seconds%60).padStart(2,"0")}</span></div>
          <div className="mp-checkout-total"><span>{intent.status==="underpaid"?"Remaining to send":"Send exactly"}</span><b>{displayUsdc(BigInt(intent.charge)>BigInt(intent.received)?BigInt(intent.charge)-BigInt(intent.received):0n)} USDC</b></div>
          {intent.status==="underpaid"&&<p className="mp-notice">Received {displayUsdc(intent.received)} USDC. The QR now requests only the remaining amount.</p>}
          {canSend?<><div className="mp-mode-tabs" role="group" aria-label="Payment method"><button aria-pressed={mode==="qr"} onClick={()=>setMode("qr")}>Scan QR code</button><button aria-pressed={mode==="wallet"} onClick={()=>setMode("wallet")}>Pay with wallet</button></div>{mode==="qr"?<div className="mp-qr-wrap"><Qr value={payment!.uri!}/><p>Scan with a compatible wallet</p></div>:<div className="mp-wallet-pay"><Wallet size={30}/><h3>Approve in your wallet</h3>{intent.chain!=="solana"&&providers.length>0?<><label>Installed wallet<select value={selectedWallet} onChange={e=>setSelectedWallet(e.target.value)}><option value="">Choose wallet</option>{providers.map(p=><option key={p.info.uuid} value={p.info.uuid}>{p.info.name} · {p.info.rdns}</option>)}</select></label><button className="mp-button primary" disabled={busy||!selectedWallet||broadcast||intent.status==="confirming"} onClick={()=>void payWallet()}>{broadcast?"Transaction sent — verifying":busy?"Check your wallet…":"Review payment in wallet"}</button></>:<p className="mp-muted">Open a compatible mobile wallet, or use the QR code.</p>}{intent.chain==="sui"?<p className="mp-muted">Sui has no payment-request link: scan the address with your Sui wallet and send exactly the amount shown, in USDC.</p>:<a className="mp-button secondary" href={payment!.uri!}>Open mobile wallet<ExternalLink size={14}/></a>}</div>}<div className="mp-copy-address"><div><small>Dedicated receiving address</small><code>{intent.recipient}</code></div><CopyButton value={intent.recipient} label="Copy receiving address"/></div><p className="mp-fine">Send native USDC on {paymentChain(intent.chain).name} only. Keep enough {paymentChain(intent.chain).gas} for the wallet’s network fee.</p></>:<p className="mp-notice">{intent.status==="review"?"Your payment needs review. Please contact support before sending any more funds.":"This payment window has ended. Any transfer already sent will still be checked; please do not send again."}</p>}
          <div className="mp-live-status" role="status"><Status status={intent.status}/><p>{payment?.verificationDelayed?"Network verification is delayed. We will retry automatically.":intent.status==="confirming"?`${intent.confirmations} of ${paymentChain(intent.chain).confirmations} confirmations` : "We check the network automatically. Keep this page open."}</p></div>
          <ol className="mp-steps"><li className="done"><Check size={13}/>Checkout ready</li><li className={intent.status!=="awaiting_payment"?"done":""}>Payment detected</li><li>Payment verified</li></ol>
          </>}{error&&<p role="alert" className="mp-error">{error}</p>}
        </>}
      </section>
    </main>}
    {!embedded&&<footer className="mp-checkout-footer"><span>Powered by <b>FurlPay</b></span><Link href="/legal/privacy">Privacy</Link><Link href="/legal/terms">Terms</Link><Link href="/support">Support</Link></footer>}
  </div>;
}
