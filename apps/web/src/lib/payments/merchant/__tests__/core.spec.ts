import { describe,it,expect,vi } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { parseUsdc,displayUsdc,feeSplit } from "../money";
import { paymentUri } from "../qr";
import { paymentChain } from "../registry";
import { linkSchema,publicIntent,publicLink,type MerchantIntent,type MerchantLink } from "../model";
vi.mock("@/lib/compliance/addressScreening",()=>({screenAddressRisk:vi.fn()}));
vi.mock("@/lib/supabase",()=>({sbRpc:vi.fn(),sbUpdate:vi.fn()}));
import { decodeTransfer,TRANSFER } from "../verifier";
export const intent:MerchantIntent={id:"d951e12e-fc0f-4ce9-84ca-5c407c1cf13d",link_id:"19b46540-50f6-43fd-99ab-c56aa608dcdf",merchant_id:"8fc4ff7d-ec04-4d19-954a-c1b287bd86dd",chain:"base",recipient:`0x${"a".repeat(40)}`,reference:new PublicKey(new Uint8Array(32).fill(2)).toBase58(),status:"awaiting_payment",gross_units:"1000000000",fee_units:"7500000",charge_units:"1000000000",net_units:"992500000",received_units:"0",start_block:"100",scan_block:"100",created_at:"2026-10-08T10:00:00.000Z",expires_at:"2026-10-08T10:30:00.000Z",paid_at:null,transaction_hash:null,confirmations:0,ledger_tx_id:null};
describe("merchant fee and amount boundaries",()=>{
  it("keeps amounts exact at six decimals and every tier",()=>{
    expect(parseUsdc("0.000001")).toBe(1n);expect(displayUsdc(1000000000000n)).toBe("1000000.00");
    expect(feeSplit(parseUsdc("1000"))).toEqual({gross:"1000000000",fee:"7500000",charge:"1000000000",net:"992500000"});
    for(const bps of [0,25,50,75,95,1000])for(const gross of [1n,333333n,1000000000n,1000000000000n])for(const payer of ["merchant","customer"] as const){const f=feeSplit(gross,bps,payer);expect(BigInt(f.fee)+BigInt(f.net)).toBe(BigInt(f.charge));}
  });
  it.each(["0","-1","1e3","0.0000001","1000000.000001","NaN","01","Infinity","1,000"])("rejects %s",v=>expect(()=>parseUsdc(v)).toThrow());
  it("rejects fees that exceed the supported policy",()=>{expect(()=>feeSplit(1n,1.1)).toThrow();expect(()=>feeSplit(1n,1001)).toThrow();});
});
describe("native payment instructions",()=>{
  it("encodes EVM chain, canonical token, exact units and exclusive recipient",()=>{
    expect(paymentUri("base",intent.recipient,"1234567",intent.reference)).toBe(`ethereum:${paymentChain("base").token}@8453/transfer?address=${intent.recipient}&uint256=1234567`);
    expect(paymentUri("arc",intent.recipient,"1000000",intent.reference)).toContain("@5042/transfer?");
  });
  it("uses the recipient in the Solana URI and mint/reference as query parameters",()=>{
    const recipient=new PublicKey(new Uint8Array(32).fill(3)).toBase58();const uri=paymentUri("solana",recipient,"1000000",intent.reference);
    expect(uri.startsWith(`solana:${recipient}?`)).toBe(true);expect(uri).toContain(`spl-token=${paymentChain("solana").token}`);expect(uri).toContain(`reference=${intent.reference}`);expect(uri).toContain("amount=1&");
  });
  it("rejects null recipients and fake network names",()=>{expect(()=>paymentUri("base","0x"+"0".repeat(40),"1",intent.reference)).toThrow();expect(()=>paymentUri("solana","garbage","1",intent.reference)).toThrow();expect(()=>paymentChain("constructor")).toThrow();});
});
describe("transfer verification",()=>{
  const event={address:paymentChain("base").token,topics:[TRANSFER,`0x${"0".repeat(24)}${"b".repeat(40)}`,`0x${"0".repeat(24)}${"a".repeat(40)}`],data:`0x${(1000000000n).toString(16).padStart(64,"0")}`,transactionHash:`0x${"1".repeat(64)}`,blockNumber:"0x64",blockHash:`0x${"2".repeat(64)}`,logIndex:"0x0",removed:false};
  it("decodes only an on-time native transfer into the reserved address",()=>expect(decodeTransfer(intent,event)).toEqual({payer:`0x${"b".repeat(40)}`,amount:"1000000000"}));
  it("rejects bridged tokens, unrelated recipients, old blocks and reorg removals",()=>{
    for(const patch of [{address:`0x${"c".repeat(40)}`},{removed:true},{blockNumber:"0x63"},{topics:[...event.topics.slice(0,2),`0x${"c".repeat(64)}`]},{topics:[`0x${"d".repeat(64)}`,...event.topics.slice(1)]}])expect(()=>decodeTransfer(intent,{...event,...patch})).toThrow();
  });
});
describe("request and public contracts",()=>{
  const input={requestId:crypto.randomUUID(),title:"Consulting",description:"",amount:"1000",chains:["base"],reusable:true,feePayer:"merchant",expiresAt:null,kind:"link",reference:"",lines:[]};
  it("rejects client pricing overrides and forged settlement state",()=>{expect(linkSchema.safeParse({...input,processing_bps:0}).success).toBe(false);expect(linkSchema.safeParse({...input,status:"paid"}).success).toBe(false);});
  it("checks invoice total and prevents reusable invoices",()=>{expect(linkSchema.safeParse({...input,kind:"invoice",reusable:false,lines:[{description:"Consulting",quantity:2,unitPrice:"500"}]}).success).toBe(true);expect(linkSchema.safeParse({...input,kind:"invoice",reusable:false,lines:[{description:"Consulting",quantity:2,unitPrice:"499"}]}).success).toBe(false);});
  it("does not expose account IDs, collection configuration or ledger IDs publicly",()=>{
    expect(publicIntent(intent)).not.toHaveProperty("merchant_id");expect(publicIntent(intent)).not.toHaveProperty("ledger_tx_id");
    const link={...input,id:input.requestId,merchant_id:"private",merchant_name:"Merchant",slug:"test",amount_units:"1000000000",processing_bps:75,fee_payer:"merchant",active:true,expires_at:null,created_at:"today"} as unknown as MerchantLink;
    expect(publicLink(link)).not.toHaveProperty("merchant_id");expect(publicLink(link)).not.toHaveProperty("processing_bps");
  });
});
