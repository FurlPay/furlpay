"use client";
import { useEffect,useRef,useState,type ReactNode } from "react";
import { Check,Copy,X } from "lucide-react";
import QRCode from "qrcode";
import { paymentChain } from "@/lib/payments/merchant/registry";
import type { PaymentStatus } from "@/lib/payments/merchant/model";
export async function request<T>(url:string,init?:RequestInit):Promise<T> {
  const res=await fetch(url,{cache:"no-store",credentials:"same-origin",...init,headers:{"Content-Type":"application/json",...init?.headers}});
  const data=await res.json(); if(!res.ok) throw new Error(data.error??"Request failed. Try again."); return data as T;
}
export function ChainMark({chain,size=24}:{chain:string;size?:number}) {
  const c=paymentChain(chain);
  // An unbranded Arc label is intentional: no invented substitute for a logo.
  return c.logo ? <img src={c.logo} alt="" width={size} height={size} className="mp-chain-mark"/> : <span className="mp-arc-wordmark" style={{fontSize:size*.45}}>Arc</span>;
}
const labels:Record<PaymentStatus,string>={awaiting_payment:"Awaiting payment",confirming:"Confirming",underpaid:"Underpaid",paid:"Paid",overpaid:"Overpaid",expired:"Expired",review:"In review"};
export function Status({status}:{status:PaymentStatus}) {return <span className="mp-status" data-status={status}><i/>{labels[status]}</span>;}
export function CopyButton({value,label="Copy"}:{value:string;label?:string}) {
  const [state,setState]=useState<"idle"|"copied"|"error">("idle");
  useEffect(()=>{if(state==="idle") return; const t=setTimeout(()=>setState("idle"),2000);return()=>clearTimeout(t);},[state]);
  return <button type="button" className="mp-icon-button" aria-label={state==="copied"?"Copied":label} title={label} onClick={()=>void navigator.clipboard.writeText(value).then(()=>setState("copied")).catch(()=>setState("error"))}>{state==="copied"?<Check size={16}/>:<Copy size={16}/>}<span className="sr-only" role="status">{state==="error"?"Could not copy. Select and copy the text.":state==="copied"?"Copied":""}</span></button>;
}
export function Qr({value,size=232}:{value:string;size?:number}) {
  const [src,setSrc]=useState("");const [error,setError]=useState(false);
  useEffect(()=>{let active=true;setSrc("");setError(false);void QRCode.toDataURL(value,{width:size*2,margin:2,errorCorrectionLevel:"M",color:{dark:"#07110c",light:"#ffffff"}}).then(s=>{if(active)setSrc(s);}).catch(()=>{if(active)setError(true);});return()=>{active=false;};},[value,size]);
  return src?<img src={src} alt="Scan to open this payment in your wallet" width={size} height={size} className="mp-qr"/>:<div className="mp-qr-placeholder" style={{width:size,height:size}} role="status">{error?"QR unavailable. Use the payment link below.":"Generating QR…"}</div>;
}
export function Dialog({title,children,onClose}:{title:string;children:ReactNode;onClose:()=>void}) {
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const d=ref.current;d?.showModal();const overflow=document.body.style.overflow;document.body.style.overflow="hidden";return()=>{d?.close();document.body.style.overflow=overflow;};},[]);
  return <dialog ref={ref} className="mp-dialog os" aria-label={title} onCancel={onClose} onClick={e=>{if(e.target===e.currentTarget)onClose();}}><header><div><span className="mp-eyebrow">FURLPAY PAYMENTS</span><h2>{title}</h2></div><button type="button" className="mp-icon-button" onClick={onClose} aria-label="Close dialog"><X size={20}/></button></header>{children}</dialog>;
}
export function downloadJson(value:unknown,name:string) { const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:"application/json"}));const a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000); }
