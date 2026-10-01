// ---------------------------------------------------------------------------
// EVM Chain Adapter
//
// Implements the canonical ChainAdapter for Ethereum and EVM rollups.
// Uses JSON-RPC over HTTP to avoid dragging in heavy web3 dependencies.
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
  ChainVm
} from './chainAdapter';
import { 
  ARC_MAINNET_CHAIN_ID, 
  ARC_TESTNET_CHAIN_ID, 
  ARC_USDC_ERC20, 
  toErc20Units,
  ARC_ERC20_DECIMALS
} from './arc';

const MODE = process.env.INTEGRATION_MODE || "mock";
const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11";

export interface EvmAdapterOpts {
  chainSlug: string;
  chainId: number;
  rpcUrl: string;
  timeoutMs?: number;
}

export class EvmAdapter implements ChainAdapter {
  readonly vm: ChainVm;
  readonly chainSlug: string;
  readonly chainId: number;
  private readonly rpcUrl: string;
  private readonly timeoutMs: number;

  constructor(opts: EvmAdapterOpts) {
    this.chainSlug = opts.chainSlug;
    this.chainId = opts.chainId;
    this.rpcUrl = opts.rpcUrl;
    this.timeoutMs = opts.timeoutMs || 5000;
    this.vm = (this.chainSlug === "arc" || this.chainId === ARC_MAINNET_CHAIN_ID || this.chainId === ARC_TESTNET_CHAIN_ID) ? "arc" : "evm";
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
        rawAmount: "1000000000000000000",
        decimals: 18,
        amount: 1.0,
        blockNumber: 1234567,
      };
    }

    if (!token) {
      const hex = await this.rpc<string>("eth_getBalance", [address, "latest"]);
      if (!hex) return null;
      let rawBalance = BigInt(hex);
      let decimals = 18;

      if (this.vm === "arc") {
        // Arc has 18dp native gas but we often treat it as 6dp USDC. 
        // We will return it as 18dp for native, or caller should ask for ERC20.
        // The ERC-20 equivalent is handled via ARC_USDC_ERC20 as token.
      }

      return {
        token: "native",
        rawAmount: rawBalance.toString(),
        decimals,
        amount: Number(rawBalance) / 10**decimals,
        blockNumber: await this.getBlockHeight(),
      };
    }

    // Call balanceOf on token
    const data = "0x70a08231000000000000000000000000" + address.slice(2).toLowerCase();
    const hex = await this.rpc<string>("eth_call", [{ to: token, data }, "latest"]);
    if (!hex) return null;
    
    const rawBalance = BigInt(hex === "0x" ? "0x0" : hex);
    let decimals = 18;
    
    // Quick ERC20 decimals check
    const decHex = await this.rpc<string>("eth_call", [{ to: token, data: "0x313ce567" }, "latest"]);
    if (decHex && decHex !== "0x") {
      decimals = parseInt(decHex, 16);
    } else if (this.vm === "arc" && token.toLowerCase() === ARC_USDC_ERC20.toLowerCase()) {
      decimals = ARC_ERC20_DECIMALS;
    }

    return {
      token,
      rawAmount: rawBalance.toString(),
      decimals,
      amount: Number(rawBalance) / 10**decimals,
      blockNumber: await this.getBlockHeight(),
    };
  }

  async getTokenBalances(address: string, tokens: string[]): Promise<(TokenBalance | null)[]> {
    if (MODE !== "live") {
      return tokens.map(t => ({
        token: t,
        rawAmount: "1000000000000000000",
        decimals: 18,
        amount: 1.0,
        blockNumber: 1234567,
      }));
    }
    
    // Fallback to sequential for simplicity in this abstraction layer,
    // though real implementation might construct Multicall3 call data.
    const results = [];
    for (const token of tokens) {
      results.push(await this.getBalance(address, token));
    }
    return results;
  }

  async estimateGas(params: { to: string; data?: string; value?: bigint }): Promise<GasEstimate> {
    if (MODE !== "live") {
      return {
        gasUnits: 21000n,
        gasPricePerUnit: 1000000000n, // 1 gwei
        totalCost: 21000000000000n,
        totalCostUsd: 0.05,
        chain: this.chainSlug,
      };
    }

    const valueHex = params.value ? "0x" + params.value.toString(16) : undefined;
    const gasHex = await this.rpc<string>("eth_estimateGas", [{
      to: params.to,
      data: params.data,
      value: valueHex
    }]);

    const gasUnits = BigInt(gasHex || "0x5208"); // 21000 default
    const price = await this.getGasPrice();
    const totalCost = gasUnits * price.pricePerUnit;

    return {
      gasUnits,
      gasPricePerUnit: price.pricePerUnit,
      totalCost,
      totalCostUsd: Number(totalCost) / 10**18 * 3000, // naive ETH price
      chain: this.chainSlug,
    };
  }

  async getGasPrice(): Promise<GasPrice> {
    if (MODE !== "live") {
      return { chain: this.chainSlug, pricePerUnit: 1000000000n, unit: "gwei", source: "mock" };
    }
    const hex = await this.rpc<string>("eth_gasPrice");
    return {
      chain: this.chainSlug,
      pricePerUnit: BigInt(hex || "0x3b9aca00"), // 1 gwei default
      unit: "gwei",
      source: "live"
    };
  }

  async broadcastTransaction(signedTx: string): Promise<BroadcastResult> {
    if (MODE !== "live") {
      return { txHash: "0xmock" + crypto.randomUUID().replace(/-/g, ""), accepted: true };
    }
    const hash = await this.rpc<string>("eth_sendRawTransaction", [signedTx]);
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
        state: "confirmed",
        blockNumber: 1234567,
        confirmations: 10,
        source: "mock",
      };
    }

    const receipt = await this.rpc<any>("eth_getTransactionReceipt", [txHash]);
    if (!receipt) {
      return { txHash, state: "unknown", blockNumber: null, confirmations: null, source: "live" };
    }

    const currentBlock = await this.getBlockHeight();
    const receiptBlock = parseInt(receipt.blockNumber, 16);
    const confs = Math.max(0, currentBlock - receiptBlock);

    let state: "pending" | "confirmed" | "failed" | "finalized" = "confirmed";
    if (receipt.status === "0x0") state = "failed";
    if (confs > 64) state = "finalized"; // Heuristic

    return {
      txHash,
      state,
      blockNumber: receiptBlock,
      confirmations: confs,
      source: "live",
    };
  }

  async waitForConfirmation(txHash: string, opts?: ConfirmationOpts): Promise<ConfirmationResult> {
    if (MODE !== "live") {
      return { confirmed: true, status: await this.getTransactionStatus(txHash) };
    }

    const maxTime = opts?.timeoutMs || 30000;
    const interval = opts?.pollIntervalMs || 2000;
    const reqConfs = opts?.requiredConfirmations || 1;
    const start = Date.now();

    while (Date.now() - start < maxTime) {
      const status = await this.getTransactionStatus(txHash);
      if (status.state === "failed") {
        return { confirmed: false, status, reason: "Transaction reverted" };
      }
      if ((status.state === "confirmed" || status.state === "finalized") && (status.confirmations ?? 0) >= reqConfs) {
        return { confirmed: true, status };
      }
      await new Promise(r => setTimeout(r, interval));
    }

    return { confirmed: false, status: await this.getTransactionStatus(txHash), reason: "Timeout" };
  }

  async getBlockHeight(): Promise<number> {
    if (MODE !== "live") return 1234567;
    const hex = await this.rpc<string>("eth_blockNumber");
    return hex ? parseInt(hex, 16) : 0;
  }

  async healthCheck(): Promise<HealthResult> {
    const start = Date.now();
    if (MODE !== "live") {
      // Not connected to a chain: never report healthy, never a block height.
      return { healthy: false, latencyMs: 0, blockHeight: null, source: "mock", error: "INTEGRATION_MODE is not live; no RPC was contacted" };
    }
    const hex = await this.rpc<string>("eth_blockNumber");
    return {
      healthy: !!hex,
      latencyMs: Date.now() - start,
      blockHeight: hex ? parseInt(hex, 16) : null,
      source: "live"
    };
  }
}
