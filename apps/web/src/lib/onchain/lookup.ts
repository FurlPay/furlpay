import { screenWallet } from "@furlpay/compliance";
import { PublicKey } from "@solana/web3.js";
import { getChain } from "@/lib/services/chainRegistry";
import { evmRpcFor, solanaRpc } from "./balances";
import { assetRegistry, classifyContract } from "./assets";
import { decodeDepositForBurn, domainName, pairMints, chainOfDomain } from "./cctp";
import { nodeRpc } from "./nodeIndexer";
import { formatUnits, normalizeSolanaTransaction, TRANSFER_TOPIC, type RpcLog, type SolanaTx } from "./normalize";
import { scrub } from "./indexerLog";

// ---------------------------------------------------------------------------
// Live on-chain lookup for the /onchain search box: a transaction hash or an
// address, read from FurlPay's OWN configured nodes at request time (never a
// public fallback; a chain without an RPC says so). Facts only:
//   - EVM tx: receipt from every configured chain, status, block, finality
//     (block <= the node's finalized head), decoded native-USDC / USDC.e
//     transfers (by CONTRACT), CCTP V2 burns and mints.
//   - EVM address: native, USDC and USDC.e balances pinned to ONE canonical
//     block (EIP-1898 blockHash + requireCanonical), contract-or-account.
//   - Solana signature / address: status, decoded transfers / USDC balance.
// Plus the OFAC SDN screen FurlPay holds (worded as exactly that). No entity
// labels are invented; FurlPay user wallets are never revealed.
// ---------------------------------------------------------------------------

const EVM_CHAINS = ["ethereum", "base", "arbitrum", "polygon"] as const;
const hexN = (h: string) => BigInt(h);
const explorer = (chain: string) => getChain(chain)?.explorer?.replace(/\/+$/, "").split("?")[0] ?? null;
const link = (chain: string, kind: "tx" | "address", v: string) => {
  const e = explorer(chain);
  return e ? `${e}/${kind}/${v}` : null;
};

export interface LookupTransfer {
  asset: string;
  native: boolean | null;
  contract: string;
  from: string;
  to: string;
  amount: string | null;
  amountRaw: string;
  kind: "transfer" | "mint" | "burn";
}
export interface LookupCctp {
  side: "burn" | "mint";
  amount: string;
  fee: string | null;
  otherDomain: number;
  otherChain: string | null;
  otherName: string | null;
  recipient: string;
  nonce: string | null;
}
export interface ChainHit {
  chain: string;
  status: "found" | "not_found" | "unavailable" | "not_configured";
  reason?: string;
  explorerUrl?: string | null;
  // tx
  succeeded?: boolean;
  block?: string;
  blockHash?: string;
  blockTime?: string | null;
  finality?: "finalized" | "not_finalized" | "unknown";
  from?: string;
  to?: string | null;
  transfers?: LookupTransfer[];
  cctp?: LookupCctp[];
  // address
  isContract?: boolean;
  balances?: { asset: string; native: boolean | null; amount: string; contract: string | null }[];
  atBlock?: string;
  readAt?: string;
}
export interface LookupResult {
  query: string;
  kind: "evm_tx" | "evm_address" | "solana_signature" | "solana_address";
  readAt: string;
  chains: ChainHit[];
  screening: { list: string; listed: boolean; note: string } | null;
}

export function classifyQuery(q: string): LookupResult["kind"] | null {
  const s = q.trim();
  if (/^0x[0-9a-fA-F]{64}$/.test(s)) return "evm_tx";
  if (/^0x[0-9a-fA-F]{40}$/.test(s)) return "evm_address";
  if (/^[1-9A-HJ-NP-Za-km-z]{86,90}$/.test(s)) return "solana_signature";
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)) {
    try {
      return new PublicKey(s).toBase58() === s ? "solana_address" : null;
    } catch {
      return null;
    }
  }
  return null;
}

interface Receipt {
  transactionHash: string;
  blockNumber: string;
  blockHash: string;
  status: string;
  from: string;
  to: string | null;
  logs: RpcLog[];
}

async function evmTx(chain: string, hash: string): Promise<ChainHit> {
  const url = evmRpcFor(chain);
  if (!url) return { chain, status: "not_configured", reason: `No RPC configured for ${chain}.` };
  try {
    const r = await nodeRpc<Receipt | null>(url, "eth_getTransactionReceipt", [hash]);
    if (!r) return { chain, status: "not_found" };
    if (r.transactionHash.toLowerCase() !== hash.toLowerCase()) throw new Error("node returned a different transaction");
    const [blk, fin] = await Promise.all([
      nodeRpc<{ timestamp: string; hash: string } | null>(url, "eth_getBlockByNumber", [r.blockNumber, false]),
      nodeRpc<{ number: string } | null>(url, "eth_getBlockByNumber", ["finalized", false]).catch(() => null),
    ]);
    const transfers: LookupTransfer[] = [];
    for (const l of r.logs) {
      if ((l.topics?.[0] ?? "").toLowerCase() !== TRANSFER_TOPIC || l.topics.length !== 3 || !/^0x[0-9a-f]{64}$/i.test(l.data ?? "")) continue;
      const contract = l.address.toLowerCase();
      const a = classifyContract(chain, contract);
      const from = `0x${l.topics[1].slice(26)}`.toLowerCase();
      const to = `0x${l.topics[2].slice(26)}`.toLowerCase();
      const raw = hexN(l.data).toString();
      transfers.push({
        asset: a?.symbol ?? "Unregistered token",
        native: a ? a.kind === "native" : null,
        contract,
        from,
        to,
        amountRaw: raw,
        amount: a ? formatUnits(raw, a.decimals) : null, // unknown decimals: raw only, never guessed
        kind: /^0x0{40}$/.test(from) ? "mint" : /^0x0{40}$/.test(to) ? "burn" : "transfer",
      });
    }
    const cctp: LookupCctp[] = [];
    for (const l of r.logs) {
      const b = decodeDepositForBurn(l);
      if (b) cctp.push({ side: "burn", amount: formatUnits(b.amount, 6), fee: null, otherDomain: b.destination_domain, otherChain: chainOfDomain(b.destination_domain), otherName: domainName(b.destination_domain), recipient: b.mint_recipient, nonce: null });
    }
    for (const m of pairMints(r.logs).mints) {
      cctp.push({ side: "mint", amount: formatUnits(m.decoded.minted, 6), fee: formatUnits(m.decoded.fee, 6), otherDomain: m.decoded.source_domain, otherChain: chainOfDomain(m.decoded.source_domain), otherName: domainName(m.decoded.source_domain), recipient: m.decoded.mint_recipient, nonce: m.decoded.nonce });
    }
    return {
      chain,
      status: "found",
      explorerUrl: link(chain, "tx", r.transactionHash),
      succeeded: r.status === "0x1",
      block: hexN(r.blockNumber).toString(),
      blockHash: r.blockHash,
      blockTime: blk ? new Date(Number(hexN(blk.timestamp)) * 1000).toISOString() : null,
      finality: fin ? (hexN(r.blockNumber) <= hexN(fin.number) ? "finalized" : "not_finalized") : "unknown",
      from: r.from.toLowerCase(),
      to: r.to ? r.to.toLowerCase() : null,
      transfers,
      cctp,
      readAt: new Date().toISOString(),
    };
  } catch (e) {
    return { chain, status: "unavailable", reason: scrub((e as Error).message).slice(0, 160) };
  }
}

async function evmAddress(chain: string, address: string): Promise<ChainHit> {
  const url = evmRpcFor(chain);
  if (!url) return { chain, status: "not_configured", reason: `No RPC configured for ${chain}.` };
  try {
    const tip = await nodeRpc<{ number: string; hash: string }>(url, "eth_getBlockByNumber", ["latest", false]);
    // Every read pinned to the same canonical block (EIP-1898), so balances are consistent with each other.
    const at = { blockHash: tip.hash, requireCanonical: true };
    const assets = assetRegistry().filter((a) => a.deployments[chain]);
    const word = `0x70a08231${address.slice(2).toLowerCase().padStart(64, "0")}`;
    const [native, code, ...tokens] = await Promise.all([
      nodeRpc<string>(url, "eth_getBalance", [address, at]),
      nodeRpc<string>(url, "eth_getCode", [address, at]),
      ...assets.map((a) => nodeRpc<string>(url, "eth_call", [{ to: a.deployments[chain], data: word }, at])),
    ]);
    const nativeSym = chain === "polygon" ? "POL" : "ETH";
    return {
      chain,
      status: "found",
      explorerUrl: link(chain, "address", address),
      isContract: code !== "0x" && code !== "0x0",
      atBlock: hexN(tip.number).toString(),
      balances: [
        { asset: nativeSym, native: null, amount: formatUnits(hexN(native).toString(), 18), contract: null },
        ...assets.map((a, i) => ({ asset: a.symbol, native: a.kind === "native", amount: formatUnits(hexN(tokens[i]).toString(), a.decimals), contract: a.deployments[chain] })),
      ],
      readAt: new Date().toISOString(),
    };
  } catch (e) {
    return { chain, status: "unavailable", reason: scrub((e as Error).message).slice(0, 160) };
  }
}

async function solanaSignature(sig: string): Promise<ChainHit> {
  const url = solanaRpc();
  if (!url) return { chain: "solana", status: "not_configured", reason: "No RPC configured for solana." };
  try {
    const [st, fin] = await Promise.all([
      nodeRpc<{ value: ({ slot: number; err: unknown; confirmationStatus: string | null } | null)[] }>(url, "getSignatureStatuses", [[sig], { searchTransactionHistory: true }]),
      nodeRpc<number>(url, "getSlot", [{ commitment: "finalized" }]),
    ]);
    const s = st.value[0];
    if (!s) return { chain: "solana", status: "not_found" };
    const tx = await nodeRpc<SolanaTx | null>(url, "getTransaction", [sig, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }]);
    const usdcMint = assetRegistry().find((a) => a.id === "usdc")?.deployments.solana;
    const transfers: LookupTransfer[] = tx
      ? normalizeSolanaTransaction(tx, { finalizedSlot: fin }).transfers.map((t) => ({
          asset: t.asset_address === null ? "SOL" : t.asset_address === usdcMint ? "USDC" : "Unregistered token",
          native: t.asset_address === usdcMint ? true : null,
          contract: t.asset_address ?? "native",
          from: t.from_address,
          to: t.to_address,
          amountRaw: t.amount_raw ?? "",
          amount: t.asset_address === null || t.asset_address === usdcMint ? t.amount : null,
          kind: "transfer",
        }))
      : [];
    return {
      chain: "solana",
      status: "found",
      explorerUrl: link("solana", "tx", sig),
      succeeded: s.err === null,
      block: String(s.slot),
      blockTime: tx?.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null,
      finality: s.slot <= fin ? "finalized" : "not_finalized",
      transfers,
      readAt: new Date().toISOString(),
    };
  } catch (e) {
    return { chain: "solana", status: "unavailable", reason: scrub((e as Error).message).slice(0, 160) };
  }
}

async function solanaAddress(addr: string): Promise<ChainHit> {
  const url = solanaRpc();
  if (!url) return { chain: "solana", status: "not_configured", reason: "No RPC configured for solana." };
  const usdcMint = assetRegistry().find((a) => a.id === "usdc")?.deployments.solana;
  try {
    const [bal, accts] = await Promise.all([
      nodeRpc<{ context: { slot: number }; value: number }>(url, "getBalance", [addr, { commitment: "confirmed" }]),
      usdcMint ? nodeRpc<{ value: { account: { data: { parsed: { info: { tokenAmount: { amount: string } } } } } }[] }>(url, "getTokenAccountsByOwner", [addr, { mint: usdcMint }, { encoding: "jsonParsed", commitment: "confirmed" }]) : Promise.resolve({ value: [] }),
    ]);
    const usdcRaw = accts.value.reduce((a, x) => a + BigInt(x.account.data.parsed.info.tokenAmount.amount), 0n);
    return {
      chain: "solana",
      status: "found",
      explorerUrl: link("solana", "address", addr),
      atBlock: String(bal.context.slot),
      balances: [
        { asset: "SOL", native: null, amount: formatUnits(String(bal.value), 9), contract: null },
        { asset: "USDC", native: true, amount: formatUnits(usdcRaw.toString(), 6), contract: usdcMint ?? null },
      ],
      readAt: new Date().toISOString(),
    };
  } catch (e) {
    return { chain: "solana", status: "unavailable", reason: scrub((e as Error).message).slice(0, 160) };
  }
}

export async function lookup(query: string): Promise<LookupResult | null> {
  const q = query.trim();
  const kind = classifyQuery(q);
  if (!kind) return null;
  const readAt = new Date().toISOString();
  let chains: ChainHit[];
  if (kind === "evm_tx") chains = await Promise.all(EVM_CHAINS.map((c) => evmTx(c, q)));
  else if (kind === "evm_address") chains = await Promise.all(EVM_CHAINS.map((c) => evmAddress(c, q.toLowerCase())));
  else if (kind === "solana_signature") chains = [await solanaSignature(q)];
  else chains = [await solanaAddress(q)];
  const isAddr = kind === "evm_address" || kind === "solana_address";
  const sc = isAddr ? screenWallet(kind === "evm_address" ? q.toLowerCase() : q) : null;
  return {
    query: kind === "evm_address" || kind === "evm_tx" ? q.toLowerCase() : q,
    kind,
    readAt,
    chains,
    screening: sc ? { list: "OFAC SDN (list held by FurlPay)", listed: sc.sanctioned, note: sc.sanctioned ? "This address is on the OFAC SDN list FurlPay holds." : "Not on the OFAC SDN list FurlPay holds. This is not a risk score." } : null,
  };
}
