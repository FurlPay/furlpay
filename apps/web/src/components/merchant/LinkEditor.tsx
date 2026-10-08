"use client";
import { useRef,useState,type FormEvent } from "react";
import { ArrowRight,Plus,Trash2 } from "lucide-react";
import { PAYMENT_CHAINS,type PaymentChainId } from "@/lib/payments/merchant/registry";
import { displayUsdc,feeSplit,parseUsdc } from "@/lib/payments/merchant/money";
import { linkSchema,type LinkInput,type MerchantLink } from "@/lib/payments/merchant/model";
import { ChainMark,request } from "./shared";
export default function LinkEditor({kind,readyChains,onSaved}:{kind:LinkInput["kind"];readyChains:PaymentChainId[];onSaved:(link:MerchantLink)=>void}) {
  const id=useRef(crypto.randomUUID());
  const [title,setTitle]=useState("");const [amount,setAmount]=useState("");const [description,setDescription]=useState("");
  const [chains,setChains]=useState<PaymentChainId[]>([readyChains[0]??"arc"]);const [reusable,setReusable]=useState(kind==="link");
  const [feePayer,setFeePayer]=useState<"merchant"|"customer">("merchant");const [expiry,setExpiry]=useState(kind==="terminal"?"1":"24");
  const [reference,setReference]=useState("");const [lines,setLines]=useState([{description:"",quantity:1,unitPrice:""}]);
  const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  let gross=0n;
  try {gross=kind==="invoice"?lines.reduce((n,l)=>n+parseUsdc(l.unitPrice)*BigInt(l.quantity),0n):parseUsdc(amount);}catch{/* An incomplete form has no quote. */}
  let split:ReturnType<typeof feeSplit>|null=null;try{split=feeSplit(gross,75,feePayer);}catch{/* show no numeric quote */}
  async function submit(e:FormEvent){
    e.preventDefault();setError("");
    const input=linkSchema.safeParse({requestId:id.current,title,description,amount:kind==="invoice"?displayUsdc(gross):amount,chains,reusable,feePayer,expiresAt:expiry==="never"?null:new Date(Date.now()+Number(expiry)*3600000).toISOString(),kind,reference,lines:kind==="invoice"?lines:[]});
    if(!input.success){setError(input.error.issues[0].message);return;}
    setBusy(true);try{const data=await request<{link:MerchantLink}>("/api/merchant/payments",{method:"POST",body:JSON.stringify(input.data)});onSaved(data.link);}catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  return <form className="mp-editor" onSubmit={submit}>
    <label> {kind==="invoice"?"Invoice title":"What are you collecting for?"}<input autoFocus value={title} onChange={e=>setTitle(e.target.value)} maxLength={120} required placeholder={kind==="terminal"?"Counter payment":"e.g. October consulting retainer"}/></label>
    {kind==="invoice"?<><label>Invoice reference<input value={reference} onChange={e=>setReference(e.target.value)} maxLength={80} placeholder="INV-2026-0042"/></label><div className="mp-invoice-lines">{lines.map((l,index)=><div key={index}><label>Description<input aria-label={`Item ${index+1} description`} value={l.description} required onChange={e=>setLines(lines.map((r,j)=>j===index?{...r,description:e.target.value}:r))}/></label><label>Qty<input aria-label={`Item ${index+1} quantity`} type="number" min={1} max={10000} value={l.quantity} onChange={e=>setLines(lines.map((r,j)=>j===index?{...r,quantity:Number(e.target.value)}:r))}/></label><label>USDC<input aria-label={`Item ${index+1} price`} inputMode="decimal" placeholder="0.00" value={l.unitPrice} onChange={e=>setLines(lines.map((r,j)=>j===index?{...r,unitPrice:e.target.value}:r))}/></label><button className="mp-icon-button" type="button" aria-label={`Remove item ${index+1}`} disabled={lines.length===1} onClick={()=>setLines(lines.filter((_,j)=>j!==index))}><Trash2 size={15}/></button></div>)}</div><button className="mp-button secondary" type="button" disabled={lines.length>=50} onClick={()=>setLines([...lines,{description:"",quantity:1,unitPrice:""}])}><Plus size={15}/>Add line item</button></>:<label>Amount<div className="mp-amount-input"><input value={amount} onChange={e=>setAmount(e.target.value)} inputMode="decimal" required placeholder="0.00"/><img src="/logos/coins/usdc.svg" alt="" width={20} height={20}/><span>USDC</span></div></label>}
    <label>Description <span className="mp-muted">(optional)</span><textarea value={description} onChange={e=>setDescription(e.target.value)} maxLength={500} rows={2} placeholder="A note your customer will see at checkout"/></label>
    <fieldset><legend>Accepted networks</legend><div className="mp-network-options">{PAYMENT_CHAINS.map(c=><label key={c.id} className="mp-network-choice" data-checked={chains.includes(c.id)}><input type="checkbox" checked={chains.includes(c.id)} onChange={e=>setChains(e.target.checked?[...chains,c.id]:chains.filter(v=>v!==c.id))}/><ChainMark chain={c.id}/><span>{c.name}<small>{readyChains.includes(c.id)?`${c.gas} for gas`:"Setup required"}</small></span></label>)}</div></fieldset>
    <div className="mp-form-row"><label>Expires after<select value={expiry} onChange={e=>setExpiry(e.target.value)}><option value="0.5">30 minutes</option><option value="1">1 hour</option><option value="24">24 hours</option><option value="168">7 days</option><option value="never">Never</option></select></label><label>Processing fee paid by<select value={feePayer} onChange={e=>setFeePayer(e.target.value as typeof feePayer)}><option value="merchant">Merchant</option><option value="customer">Customer</option></select></label></div>
    {kind==="link"&&<label className="mp-check"><input type="checkbox" checked={reusable} onChange={e=>setReusable(e.target.checked)}/>Reusable link <small>Accept a separate checkout from each customer</small></label>}
    <div className="mp-fee-preview"><div><span>Processing fee · 0.75%</span><b>{split?displayUsdc(split.fee):"—"} USDC</b></div><div><span>Customer sends</span><b>{split?displayUsdc(split.charge):"—"} USDC</b></div><div><span>You receive</span><strong>{split?displayUsdc(split.net):"—"} USDC</strong></div><p>Wallet network fees are separate. Bank settlement and cross-chain routing are not included.</p></div>
    {chains.some(c=>!readyChains.includes(c))&&<p className="mp-notice">Some selected networks need a collection address provisioned. Checkout will offer only networks that are ready.</p>}
    {error&&<p role="alert" className="mp-error">{error}</p>}
    <button className="mp-button primary" type="submit" disabled={busy}>{busy?"Creating…":kind==="invoice"?"Create invoice":kind==="terminal"?"Create payment request":"Create payment link"}<ArrowRight size={16}/></button>
  </form>;
}
