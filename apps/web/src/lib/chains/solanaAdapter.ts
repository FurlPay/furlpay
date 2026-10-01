// ---------------------------------------------------------------------------
// Solana Chain Adapter
//
// Implements the canonical ChainAdapter for Solana.
// Uses raw JSON-RPC HTTP fetch to avoid bundling @solana/web3.js.
// ---------------------------------------------------------------------------

import { 
  ChainAdapter, 
  TokenBalance, 
  GasEstimate, 
  GasPrice, 
  BroadcastResult, 
  TransactionStatus, 
  ConfirmationOpts, 
  ConfirmationResult, 
  HealthResult,
  ChainVm,
  TxConfirmationState
} from './chainAdapter';

const MODE = process.env.INTEGRATION_MODE || "mock";
const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhRxEsyDjY6nNGUa31guU2D8c";

export interface SolanaAdapterOpts {
  rpcUrl: string;
  timeoutMs?: number;
}

export class SolanaAdapter implements ChainAdapter {
  readonly vm: ChainVm = "solana";
  readonly chainSlug = "solana";
  readonly chainId = "mainnet-beta";
  private readonly rpcUrl: string;
  private readonly timeoutMs: number;

  constructor(opts: SolanaAdapterOpts) {
    this.rpcUrl = opts.rpcUrl;
    this.timeoutMs = opts.timeoutMs || 5000;
  }

  private async rpc<T>(method: string, params: unknown[] = []): Promise<T | null> {
    if (MODE !== "live") return null;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
      const res = await fetch(this.rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method, params }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) return null;
      const json = await res.json();
      return json?.result ?? null;
    } catch {
      return null;
    }
  }

  async getBalance(address: string, token?: string): Promise<TokenBalance | null> {
    if (MODE !== "live") {
      return {
        token: token || "native",
        rawAmount: "1000000000",
        decimals: 9,
        amount: 1.0,
        blockNumber: 250000000,
      };
    }

    if (!token) {
      const res = await this.rpc<any>("getBalance", [address, { commitment: "confirmed" }]);
      if (!res) return null;
      return {
        token: "native",
        rawAmount: res.value.toString(),
        decimals: 9,
        amount: res.value / 1e9,
        blockNumber: res.context.slot,
      };
    }

    // Call getTokenAccountsByOwner for specific mint
    const accounts = await this.rpc<any>("getTokenAccountsByOwner", [
      address,
      { mint: token },
      { encoding: "jsonParsed" }
    ]);
    
    if (!accounts || !accounts.value || accounts.value.length === 0) {
      return {
        token,
        rawAmount: "0",
        decimals: 6, // Assume 6 for USDC if missing
        amount: 0,
        blockNumber: accounts?.context?.slot || null,
      };
    }

    const data = accounts.value[0].account.data.parsed.info.tokenAmount;
    return {
      token,
      rawAmount: data.amount,
      decimals: data.decimals,
      amount: data.uiAmount,
      blockNumber: accounts.context.slot,
    };
  }

  async getTokenBalances(address: string, tokens: string[]): Promise<(TokenBalance | null)[]> {
    if (MODE !== "live") {
      return tokens.map(t => ({
        token: t,
        rawAmount: "1000000",
        decimals: 6,
        amount: 1.0,
        blockNumber: 250000000,
      }));
    }
    
    // Batch requests or execute sequentially
    const results = [];
    for (const token of tokens) {
      results.push(await this.getBalance(address, token));
    }
    return results;
  }

  async estimateGas(params: { to: string; data?: string; value?: bigint }): Promise<GasEstimate> {
    if (MODE !== "live") {
      return {
        gasUnits: 1n,
        gasPricePerUnit: 5000n, // 5000 lamports typical fee
        totalCost: 5000n,
        totalCostUsd: 0.0007,
        chain: "solana",
      };
    }

    // Solana standard signature fee is 5000 lamports
    return {
      gasUnits: 1n,
      gasPricePerUnit: 5000n,
      totalCost: 5000n,
      totalCostUsd: 5000 / 1e9 * 150, // naive SOL price
      chain: "solana",
    };
  }

  async getGasPrice(): Promise<GasPrice> {
    if (MODE !== "live") {
      return { chain: "solana", pricePerUnit: 5000n, unit: "lamports", source: "mock" };
    }
    
    const fees = await this.rpc<any>("getRecentPrioritizationFees", [[]]);
    const extraFee = fees && fees.length > 0 ? fees[0].prioritizationFee : 0;
    
    return {
      chain: "solana",
      pricePerUnit: BigInt(5000 + extraFee),
      unit: "lamports",
      source: "live"
    };
  }

  async broadcastTransaction(signedTxBase64: string): Promise<BroadcastResult> {
    if (MODE !== "live") {
      return { txHash: "mock_sig_" + crypto.randomUUID().replace(/-/g, ""), accepted: true };
    }
    const hash = await this.rpc<string>("sendTransaction", [
      signedTxBase64,
      { encoding: "base64", skipPreflight: true }
    ]);
    return {
      txHash: hash || "",
      accepted: !!hash,
      error: hash ? undefined : "Broadcast failed",
    };
  }

  async getTransactionStatus(txHash: string): Promise<TransactionStatus> {
    if (MODE !== "live") {
      return {
        txHash,
        state: "finalized",
        blockNumber: 250000000,
        confirmations: null,
        source: "mock",
      };
    }

    const res = await this.rpc<any>("getSignatureStatuses", [[txHash]]);
    if (!res || !res.value || !res.value[0]) {
      return { txHash, state: "unknown", blockNumber: null, confirmations: null, source: "live" };
    }

    const statusObj = res.value[0];
    let state: TxConfirmationState = "unknown";
    
    if (statusObj.err !== null) state = "failed";
    else if (statusObj.confirmationStatus === "finalized") state = "finalized";
    else if (statusObj.confirmationStatus === "confirmed") state = "confirmed";
    else if (statusObj.confirmationStatus === "processed") state = "pending";

    return {
      txHash,
      state,
      blockNumber: statusObj.slot,
      confirmations: statusObj.confirmations,
      source: "live",
      error: statusObj.err,
    };
  }

  async waitForConfirmation(txHash: string, opts?: ConfirmationOpts): Promise<ConfirmationResult> {
    if (MODE !== "live") {
      return { confirmed: true, status: await this.getTransactionStatus(txHash) };
    }

    const maxTime = opts?.timeoutMs || 30000;
    const interval = opts?.pollIntervalMs || 2000;
    const start = Date.now();

    while (Date.now() - start < maxTime) {
      const status = await this.getTransactionStatus(txHash);
      if (status.state === "failed") {
        return { confirmed: false, status, reason: "Transaction failed" };
      }
      if (status.state === "confirmed" || status.state === "finalized") {
        return { confirmed: true, status };
      }
      await new Promise(r => setTimeout(r, interval));
    }

    return { confirmed: false, status: await this.getTransactionStatus(txHash), reason: "Timeout" };
  }

  async getBlockHeight(): Promise<number> {
    if (MODE !== "live") return 250000000;
    const slot = await this.rpc<number>("getSlot");
    return slot || 0;
  }

  async healthCheck(): Promise<HealthResult> {
    const start = Date.now();
    if (MODE !== "live") {
      // Not connected to a chain: never report healthy, never a block height.
      return { healthy: false, latencyMs: 0, blockHeight: null, source: "mock", error: "INTEGRATION_MODE is not live; no RPC was contacted" };
    }
    const slot = await this.rpc<number>("getSlot");
    return {
      healthy: !!slot,
      latencyMs: Date.now() - start,
      blockHeight: slot,
      source: "live"
    };
  }
}
