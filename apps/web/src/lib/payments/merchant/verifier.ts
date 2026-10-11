import { z } from "zod";
import { PublicKey } from "@solana/web3.js";
import { screenAddressRisk } from "@/lib/compliance/addressScreening";
import { sbRpc, sbUpdate } from "@/lib/supabase";
import { isArcChain, paymentChain, requiredConfirmations } from "./registry";
import { address, blockSchema, hash, hex, rpc, verifyChain } from "./rpc";
import type { MerchantIntent } from "./model";
import { fetchSuiTransaction, suiTransactionsTo, usdcDelta } from "./sui";
import { ARC_SYSTEM_EMITTER, arcCreditableTransfers } from "@/lib/chains/arc";
export const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
export const logSchema = z.object({address,topics:z.array(hash),data:hash,transactionHash:hash,blockNumber:hex,blockHash:hash,logIndex:hex,removed:z.boolean().optional()});
type TransferLog = z.infer<typeof logSchema>;
/** Pure gate, also used on the log independently fetched from the receipt. */
export function decodeTransfer(i: MerchantIntent, log: TransferLog) {
  const c = paymentChain(i.chain);
  if(log.removed || log.address.toLowerCase()!==c.token.toLowerCase() || log.topics.length!==3 || log.topics[0].toLowerCase()!==TRANSFER) throw new Error("Not a canonical USDC transfer");
  if(!/^0x0{24}[0-9a-f]{40}$/i.test(log.topics[1]) || !/^0x0{24}[0-9a-f]{40}$/i.test(log.topics[2])) throw new Error("Malformed transfer topics");
  if(`0x${log.topics[2].slice(-40)}`.toLowerCase()!==i.recipient.toLowerCase()) throw new Error("Wrong recipient");
  if(BigInt(log.blockNumber)<BigInt(i.start_block) || BigInt(log.data)<=0n) throw new Error("Invalid payment evidence");
  return {payer:`0x${log.topics[1].slice(-40)}`,amount:BigInt(log.data).toString()};
}
async function hold(i: MerchantIntent) {
  const rows = await sbUpdate<MerchantIntent>("merchant_payment_intents",`id=eq.${i.id}&paid_at=is.null`,{status:"review"});
  return rows[0] ?? i;
}
async function screen(i: MerchantIntent, payer: string, block?: string) {
  const c = paymentChain(i.chain);
  for(const value of [payer,i.recipient]) {
    if((await screenAddressRisk(value,i.chain)).action!=="allow") return false;
    if(c.family==="evm") {
      // isBlacklisted(address), evaluated against a canonical block.
      const result = hex.parse(await rpc(i.chain,"eth_call",[{to:c.token,data:`0xfe575a87${value.slice(2).padStart(64,"0")}`},block ?? "latest"]));
      if(BigInt(result)!==0n) return false;
    }
  }
  return true;
}
export async function scanIntent(original: MerchantIntent): Promise<MerchantIntent> {
  let i = original;
  if(i.status === "review") return i;
  await sbUpdate("merchant_payment_intents",`id=eq.${i.id}`,{last_checked_at:new Date().toISOString()});
  await verifyChain(i.chain);
  if(i.chain === "solana") return scanSolana(i);
  if(i.chain === "sui") return scanSui(i);
  if(isArcChain(i.chain)) return scanArc(i);
  const c = paymentChain(i.chain);
  const depth = requiredConfirmations(i.chain);
  if (depth === null) throw new Error("No deposit policy for this chain");
  const head = blockSchema.parse(await rpc(i.chain,"eth_getBlockByNumber",["latest",false]));
  if(Math.abs(Date.now()/1000-Number(BigInt(head.timestamp)))>120) throw new Error("Stale network head");
  const decimals = hex.parse(await rpc(i.chain,"eth_call",[{to:c.token,data:"0x313ce567"},"latest"]));
  if(BigInt(decimals)!==6n) throw new Error("Unexpected token precision");
  const from = BigInt(i.scan_block), latest = BigInt(head.number);
  const safe = latest-BigInt(depth)+1n;
  if(from>latest) return expire(i);
  const end = from+499n<latest ? from+499n : latest;
  const logs = z.array(logSchema).max(200).parse(await rpc(i.chain,"eth_getLogs",[{address:c.token,topics:[TRANSFER,null,`0x${i.recipient.slice(2).padStart(64,"0")}`],fromBlock:`0x${from.toString(16)}`,toBlock:`0x${end.toString(16)}`} ]));
  for(const event of logs) {
    decodeTransfer(i,event);
    const receipt = z.object({status:hex,blockHash:hash,blockNumber:hex,transactionHash:hash,logs:z.array(logSchema)}).parse(await rpc(i.chain,"eth_getTransactionReceipt",[event.transactionHash]));
    if(BigInt(receipt.status)!==1n || receipt.transactionHash.toLowerCase()!==event.transactionHash.toLowerCase() || receipt.blockHash!==event.blockHash || receipt.blockNumber!==event.blockNumber) throw new Error("Receipt mismatch");
    const actual = receipt.logs.find(l=>l.logIndex===event.logIndex && l.transactionHash===event.transactionHash);
    if(!actual || actual.data!==event.data || actual.blockHash!==event.blockHash) throw new Error("Transfer absent from receipt");
    const transfer = decodeTransfer(i,actual);
    const block = blockSchema.parse(await rpc(i.chain,"eth_getBlockByNumber",[event.blockNumber,false]));
    if(block.hash!==receipt.blockHash) throw new Error("Chain reorganized");
    const timestamp = Number(BigInt(block.timestamp))*1000;
    if(timestamp<Date.parse(i.created_at)-5000 || timestamp>Date.parse(i.expires_at)) return hold(i);
    const confirmations = Number(latest-BigInt(block.number)+1n);
    if(confirmations<depth) {
      const updated=await sbUpdate<MerchantIntent>("merchant_payment_intents",`id=eq.${i.id}&status=in.(awaiting_payment,confirming)`,{status:"confirming",confirmations,transaction_hash:event.transactionHash});
      i=updated[0]??i; continue;
    }
    if(!await screen(i,transfer.payer,event.blockNumber)) return hold(i);
    // Re-check the anchor after screening; receipt evidence cannot cross a reorg.
    if(blockSchema.parse(await rpc(i.chain,"eth_getBlockByNumber",[event.blockNumber,false])).hash!==block.hash) throw new Error("Chain reorganized");
    i = await sbRpc<MerchantIntent>("merchant_payment_receive",{p_id:i.id,p_tx:event.transactionHash.toLowerCase(),p_log:Number(BigInt(event.logIndex)),p_amount:transfer.amount,p_payer:transfer.payer,p_block:BigInt(block.number).toString(),p_block_hash:block.hash,p_time:new Date(timestamp).toISOString(),p_confirmations:confirmations});
  }
  // Advance only through blocks at the required depth. A compare-and-swap keeps
  // an overlapping poller from regressing another scanner's cursor.
  const cursor=(end<safe?end:safe)+1n;
  if(cursor>from) await sbUpdate("merchant_payment_intents",`id=eq.${i.id}&scan_block=eq.${original.scan_block}`,{scan_block:cursor.toString()});
  return expire(i);
}
async function expire(i: MerchantIntent) {
  if(Date.parse(i.expires_at)>Date.now() || !["awaiting_payment","confirming"].includes(i.status)) return i;
  return (await sbUpdate<MerchantIntent>("merchant_payment_intents",`id=eq.${i.id}&status=in.(awaiting_payment,confirming)`,{status:"expired"}))[0]??i;
}
const tokenBalance=z.object({accountIndex:z.number().int(),mint:z.string(),owner:z.string().optional(),uiTokenAmount:z.object({amount:z.string().regex(/^\d+$/),decimals:z.number()})});
const TOKEN_PROGRAM=new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM=new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
/** The destination's native-USDC associated token account (where a plain transfer lands). */
export function usdcTokenAccount(owner: string): string {
  return PublicKey.findProgramAddressSync([new PublicKey(owner).toBuffer(),TOKEN_PROGRAM.toBuffer(),new PublicKey(paymentChain("solana").token).toBuffer()],ASSOCIATED_TOKEN_PROGRAM)[0].toBase58();
}
const sigList=z.array(z.object({signature:z.string(),err:z.unknown(),slot:z.number().int()})).max(50);
async function scanSolana(i: MerchantIntent) {
  // Solana Pay wallets include the intent's reference key; a payer who copies the
  // dedicated address (or pays from an exchange) does not. The destination is
  // single-use and bound to this intent, so transfers into its USDC token
  // account are attributable too. Both lists, deduplicated, oldest first.
  const [byRef,byAccount]=await Promise.all([
    rpc("solana","getSignaturesForAddress",[i.reference,{limit:50,commitment:"finalized"}]).then(r=>sigList.parse(r)),
    rpc("solana","getSignaturesForAddress",[usdcTokenAccount(i.recipient),{limit:50,commitment:"finalized"}]).then(r=>sigList.parse(r)),
  ]);
  const signatures=[...new Map([...byRef,...byAccount].map(s=>[s.signature,s])).values()].sort((a,b)=>b.slot-a.slot);
  for(const s of signatures.reverse()) {
    if(s.err || BigInt(s.slot)<BigInt(i.start_block)) continue;
    const raw=await rpc("solana","getTransaction",[s.signature,{encoding:"jsonParsed",commitment:"finalized",maxSupportedTransactionVersion:0}]);
    if(raw===null) continue;
    const tx=z.object({slot:z.number().int(),blockTime:z.number(),meta:z.object({err:z.unknown(),preTokenBalances:z.array(tokenBalance),postTokenBalances:z.array(tokenBalance)}),transaction:z.object({signatures:z.array(z.string()),message:z.object({accountKeys:z.array(z.object({pubkey:z.string(),signer:z.boolean()}))})})}).parse(raw);
    if(tx.meta.err || !tx.transaction.signatures.includes(s.signature) || tx.slot!==s.slot) throw new Error("Invalid Solana transaction");
    // The reference has no private key; if it ever appears as a signer, ignore the transaction.
    if(tx.transaction.message.accountKeys.some(k=>k.pubkey===i.reference && k.signer)) continue;
    const time=tx.blockTime*1000;
    if(time<Date.parse(i.created_at)-5000 || time>Date.parse(i.expires_at)) return hold(i);
    const mint=paymentChain("solana").token;
    const balances=[...tx.meta.preTokenBalances,...tx.meta.postTokenBalances].filter(b=>b.mint===mint);
    if(balances.some(b=>b.uiTokenAmount.decimals!==6)) throw new Error("Wrong mint precision");
    const owned=(rows:typeof tx.meta.preTokenBalances)=>rows.filter(b=>b.mint===mint && b.owner===i.recipient).reduce((n,b)=>n+BigInt(b.uiTokenAmount.amount),0n);
    const amount=owned(tx.meta.postTokenBalances)-owned(tx.meta.preTokenBalances);
    if(amount<=0n) continue;
    const payers=tx.meta.preTokenBalances.filter(b=>b.mint===mint && BigInt(b.uiTokenAmount.amount)>BigInt(tx.meta.postTokenBalances.find(p=>p.accountIndex===b.accountIndex)?.uiTokenAmount.amount??"0")).map(b=>b.owner);
    if(!payers.length || payers.some(p=>!p)) throw new Error("Payment sender could not be verified");
    for(const payer of payers) if(!await screen(i,payer!)) return hold(i);
    i=await sbRpc<MerchantIntent>("merchant_payment_receive",{p_id:i.id,p_tx:s.signature,p_log:0,p_amount:amount.toString(),p_payer:payers[0],p_block:String(tx.slot),p_block_hash:s.signature,p_time:new Date(time).toISOString(),p_confirmations:31});
  }
  return expire(i);
}

/** Sui: the destination is single-use, so every USDC credit to it after reservation belongs to this intent.
 *  Evidence is the transaction's own balance changes (netted per owner and coin), re-read by digest before crediting. */
async function scanSui(i: MerchantIntent) {
  const from=BigInt(i.scan_block);
  const txs=await suiTransactionsTo(i.recipient,from);
  let highest=from-1n;
  for(const listed of txs) {
    const cp=listed.effects.checkpoint;
    if(!cp || BigInt(cp.sequenceNumber)<BigInt(i.start_block)) continue;
    if(BigInt(cp.sequenceNumber)>highest) highest=BigInt(cp.sequenceNumber);
    if(listed.effects.status!=="SUCCESS") continue;
    const amount=usdcDelta(listed,i.recipient);
    if(amount<=0n) continue;
    // Independent re-read by digest: same checkpoint, same status, same credit.
    const tx=await fetchSuiTransaction(listed.digest);
    if(!tx || tx.digest!==listed.digest || tx.effects.status!=="SUCCESS" || tx.effects.checkpoint?.digest!==cp.digest || usdcDelta(tx,i.recipient)!==amount) throw new Error("Sui transaction mismatch");
    const time=Date.parse(tx.effects.timestamp ?? "");
    if(!Number.isFinite(time)) throw new Error("Sui transaction has no timestamp");
    if(time<Date.parse(i.created_at)-5000 || time>Date.parse(i.expires_at)) return hold(i);
    // The payer is the sender, and only when the sender's own USDC went down: a credit
    // from a pool, a sponsor or a shared object has no attributable payer, so it is reviewed.
    const payer=tx.sender?.address;
    if(!payer || usdcDelta(tx,payer)>=0n) return hold(i);
    if(!await screen(i,payer)) return hold(i);
    i = await sbRpc<MerchantIntent>("merchant_payment_receive",{p_id:i.id,p_tx:tx.digest,p_log:0,p_amount:amount.toString(),p_payer:payer,p_block:String(cp.sequenceNumber),p_block_hash:cp.digest,p_time:new Date(time).toISOString(),p_confirmations:1});
  }
  // Checkpoints are final: advance the cursor past everything read (compare-and-swap, as for EVM).
  if(highest>=from) await sbUpdate("merchant_payment_intents",`id=eq.${i.id}&scan_block=eq.${i.scan_block}`,{scan_block:(highest+1n).toString()});
  return expire(i);
}

/** Arc (ARC-P1-001). USDC is Arc's native gas, so EIP-7708 makes every movement emit a Transfer
 *  log from the system emitter (0xffff…fffe) at 18 dp; only transfer() calls ALSO emit the 0x3600
 *  ERC-20 log at 6 dp. Reading only the ERC-20 stream (the generic EVM path) misses every plain
 *  native send. Both streams are read and arcCreditableTransfers() counts each movement once,
 *  keyed on its system-emitter log; amounts are credited at 6 dp, and a movement carrying
 *  sub-micro-USDC dust is held for review rather than rounded. */
export const arcReceiptSchema = z.object({status:hex,blockHash:hash,blockNumber:hex,transactionHash:hash,logs:z.array(logSchema)});
async function scanArc(i: MerchantIntent) {
  const c = paymentChain(i.chain);
  const depth = requiredConfirmations(i.chain);
  if (depth === null) throw new Error("No deposit policy for this chain");
  const head = blockSchema.parse(await rpc(i.chain,"eth_getBlockByNumber",["latest",false]));
  if(Math.abs(Date.now()/1000-Number(BigInt(head.timestamp)))>120) throw new Error("Stale network head");
  const decimals = hex.parse(await rpc(i.chain,"eth_call",[{to:c.token,data:"0x313ce567"},"latest"]));
  if(BigInt(decimals)!==6n) throw new Error("Unexpected token precision");
  const from = BigInt(i.scan_block), latest = BigInt(head.number);
  const safe = latest-BigInt(depth)+1n;
  if(from>latest) return expire(i);
  const end = from+499n<latest ? from+499n : latest;
  const logs = z.array(logSchema).max(400).parse(await rpc(i.chain,"eth_getLogs",[{address:[ARC_SYSTEM_EMITTER,c.token],topics:[TRANSFER,null,`0x${i.recipient.slice(2).toLowerCase().padStart(64,"0")}`],fromBlock:`0x${from.toString(16)}`,toBlock:`0x${end.toString(16)}`}]));
  // One pass per transaction, in chain order; the receipt (not the log list) is the evidence.
  const ordered = logs.filter(l=>!l.removed).sort((a,b)=>Number(BigInt(a.blockNumber)-BigInt(b.blockNumber)) || Number(BigInt(a.logIndex)-BigInt(b.logIndex)));
  const txs = [...new Map(ordered.map(l=>[l.transactionHash.toLowerCase(),l])).values()];
  for(const listed of txs) {
    const receipt = arcReceiptSchema.parse(await rpc(i.chain,"eth_getTransactionReceipt",[listed.transactionHash]));
    if(BigInt(receipt.status)!==1n || receipt.transactionHash.toLowerCase()!==listed.transactionHash.toLowerCase() || receipt.blockHash!==listed.blockHash || receipt.blockNumber!==listed.blockNumber) throw new Error("Receipt mismatch");
    const movements = arcCreditableTransfers(receipt.logs).filter(m=>m.to===i.recipient.toLowerCase());
    if(!movements.length) continue;
    const block = blockSchema.parse(await rpc(i.chain,"eth_getBlockByNumber",[receipt.blockNumber,false]));
    if(block.hash!==receipt.blockHash) throw new Error("Chain reorganized");
    const timestamp = Number(BigInt(block.timestamp))*1000;
    if(timestamp<Date.parse(i.created_at)-5000 || timestamp>Date.parse(i.expires_at)) return hold(i);
    const confirmations = Number(latest-BigInt(block.number)+1n);
    if(confirmations<depth) {
      const updated=await sbUpdate<MerchantIntent>("merchant_payment_intents",`id=eq.${i.id}&status=in.(awaiting_payment,confirming)`,{status:"confirming",confirmations,transaction_hash:receipt.transactionHash});
      i=updated[0]??i; continue;
    }
    for(const m of movements) {
      // 18-dp value that is not a whole micro-USDC: never round money into or out of existence.
      if(m.dust!==0n) return hold(i);
      if(m.erc20Value<=0n || m.logIndex===undefined) continue;
      if(!await screen(i,m.from,receipt.blockNumber)) return hold(i);
      if(blockSchema.parse(await rpc(i.chain,"eth_getBlockByNumber",[receipt.blockNumber,false])).hash!==block.hash) throw new Error("Chain reorganized");
      i = await sbRpc<MerchantIntent>("merchant_payment_receive",{p_id:i.id,p_tx:receipt.transactionHash.toLowerCase(),p_log:Number(BigInt(m.logIndex)),p_amount:m.erc20Value.toString(),p_payer:m.from,p_block:BigInt(block.number).toString(),p_block_hash:block.hash,p_time:new Date(timestamp).toISOString(),p_confirmations:confirmations});
    }
  }
  const cursor=(end<safe?end:safe)+1n;
  if(cursor>from) await sbUpdate("merchant_payment_intents",`id=eq.${i.id}&scan_block=eq.${i.scan_block}`,{scan_block:cursor.toString()});
  return expire(i);
}
