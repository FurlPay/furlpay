// Etherscan V2 — indexed EVM data across ~60 chains under one key.
//
// Two verified constraints shape this adapter. First, the free key rate-limits
// hard (the API answers "Max calls per sec rate limit reached (3/sec)"), so the
// limiter is set below that and every caller is expected to be patient. Second,
// some endpoints are Pro-only: `tokenholderlist` returns a NOTOK "you are
// trying to access a PRO endpoint" body with HTTP 200, so success has to be
// judged from the payload, not the status code. `ProEndpointError` makes that
// distinction explicit rather than surfacing an empty list as "no holders".

import { env } from "../config/env.js";
import { Provider } from "./base.js";
import type { ChainRow } from "../types/index.js";

const BASE = "https://api.etherscan.io/v2/api";

export class ProEndpointError extends Error {
  constructor(action: string) {
    super(`Etherscan ${action} requires a paid API plan`);
    this.name = "ProEndpointError";
  }
}

interface EtherscanEnvelope<T> {
  status?: string;
  message?: string;
  result: T | string;
}

export interface EsTx {
  hash: string;
  blockNumber: string;
  timeStamp: string;
  from: string;
  to: string;
  value: string;
  gasUsed?: string;
  isError?: string;
  functionName?: string;
  methodId?: string;
}

export interface EsTokenTx extends EsTx {
  contractAddress: string;
  tokenName: string;
  tokenSymbol: string;
  tokenDecimal: string;
}

export class EtherscanProvider extends Provider {
  constructor() {
    super({
      name: "etherscan",
      kind: "blockchain",
      configured: !!env.etherscanKey,
      // Verified ceiling is 3/sec on this key; 2 keeps a margin.
      rps: 2,
      timeoutMs: 20_000,
      attempts: 2,
      budgetLimit: env.etherscanKey ? 100_000 : null, // documented free daily cap
    });
  }

  supports(chain: ChainRow): boolean {
    return !!env.etherscanKey && chain.etherscanChainId !== null;
  }

  private url(chainId: number, params: Record<string, string | number>): string {
    const u = new URL(BASE);
    u.searchParams.set("chainid", String(chainId));
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
    if (env.etherscanKey) u.searchParams.set("apikey", env.etherscanKey);
    return u.toString();
  }

  /**
   * Unwrap the envelope. Etherscan signals both "no results" and "Pro only"
   * with status "0" and HTTP 200, so the message text is the only way to tell
   * an empty answer from a refused one.
   */
  private async call<T>(chain: ChainRow, params: Record<string, string | number>): Promise<T> {
    if (!this.supports(chain)) {
      throw new Error(`etherscan does not cover ${chain.slug}`);
    }
    const action = String(params.action ?? "unknown");
    const body = await this.request<EtherscanEnvelope<T>>(
      this.url(chain.etherscanChainId!, params),
      {},
      { label: `${chain.slug}.${action}` },
    );

    const resultText = typeof body.result === "string" ? body.result : "";
    if (/PRO endpoint|API Pro|upgrade/i.test(resultText)) throw new ProEndpointError(action);
    if (/rate limit/i.test(resultText)) throw new Error(`etherscan rate limited: ${resultText}`);
    if (/Invalid API Key|Missing.*API Key/i.test(resultText)) {
      throw new Error("etherscan API key rejected");
    }
    if (body.status === "0" && /No transactions found|No records found/i.test(body.message ?? "")) {
      return [] as unknown as T;
    }
    if (body.status === "0" && resultText && !Array.isArray(body.result)) {
      throw new Error(`etherscan ${action}: ${resultText.slice(0, 140)}`);
    }
    return body.result as T;
  }

  /** Normal (external) transactions for an address, newest first. */
  async txList(chain: ChainRow, address: string, limit = 20): Promise<EsTx[]> {
    const r = await this.call<EsTx[]>(chain, {
      module: "account",
      action: "txlist",
      address,
      startblock: 0,
      endblock: 99999999,
      page: 1,
      offset: limit,
      sort: "desc",
    });
    return Array.isArray(r) ? r : [];
  }

  /** ERC-20 transfers touching an address. */
  async tokenTx(chain: ChainRow, address: string, limit = 20): Promise<EsTokenTx[]> {
    const r = await this.call<EsTokenTx[]>(chain, {
      module: "account",
      action: "tokentx",
      address,
      page: 1,
      offset: limit,
      sort: "desc",
    });
    return Array.isArray(r) ? r : [];
  }

  /** Internal transactions — where contract-mediated value movement shows up. */
  async internalTx(chain: ChainRow, address: string, limit = 20): Promise<EsTx[]> {
    const r = await this.call<EsTx[]>(chain, {
      module: "account",
      action: "txlistinternal",
      address,
      page: 1,
      offset: limit,
      sort: "desc",
    });
    return Array.isArray(r) ? r : [];
  }

  async balance(chain: ChainRow, address: string): Promise<bigint | null> {
    try {
      const r = await this.call<string>(chain, { module: "account", action: "balance", address, tag: "latest" });
      return BigInt(r);
    } catch {
      return null;
    }
  }

  /** Contract source metadata — tells us whether an address is a contract. */
  async contractInfo(
    chain: ChainRow,
    address: string,
  ): Promise<{ name: string | null; verified: boolean; proxy: boolean } | null> {
    try {
      const r = await this.call<Array<{ ContractName?: string; SourceCode?: string; Proxy?: string }>>(
        chain,
        { module: "contract", action: "getsourcecode", address },
      );
      const first = Array.isArray(r) ? r[0] : undefined;
      if (!first) return null;
      const verified = !!first.SourceCode && first.SourceCode.length > 0;
      return {
        name: first.ContractName && first.ContractName.length ? first.ContractName : null,
        verified,
        proxy: first.Proxy === "1",
      };
    } catch {
      return null;
    }
  }

  /** Gas oracle — safe/propose/fast in gwei. Ethereum-focused but multi-chain. */
  async gasOracle(
    chain: ChainRow,
  ): Promise<{ safe: number; propose: number; fast: number } | null> {
    try {
      const r = await this.call<{ SafeGasPrice: string; ProposeGasPrice: string; FastGasPrice: string }>(
        chain,
        { module: "gastracker", action: "gasoracle" },
      );
      const safe = Number(r?.SafeGasPrice);
      const propose = Number(r?.ProposeGasPrice);
      const fast = Number(r?.FastGasPrice);
      if (![safe, propose, fast].every(Number.isFinite)) return null;
      return { safe, propose, fast };
    } catch {
      return null;
    }
  }

  async tokenSupply(chain: ChainRow, contract: string): Promise<bigint | null> {
    try {
      const r = await this.call<string>(chain, {
        module: "stats",
        action: "tokensupply",
        contractaddress: contract,
      });
      return BigInt(r);
    } catch {
      return null;
    }
  }

  /**
   * Token holders. Verified Pro-only on this key — kept so the capability
   * matrix can report it accurately and so it starts working the moment the
   * account is upgraded, without a code change.
   */
  async tokenHolders(
    chain: ChainRow,
    contract: string,
    limit = 10,
  ): Promise<Array<{ address: string; quantity: string }>> {
    const r = await this.call<Array<{ TokenHolderAddress: string; TokenHolderQuantity: string }>>(
      chain,
      { module: "token", action: "tokenholderlist", contractaddress: contract, page: 1, offset: limit },
    );
    return (Array.isArray(r) ? r : []).map((h) => ({
      address: h.TokenHolderAddress,
      quantity: h.TokenHolderQuantity,
    }));
  }

  async ping(): Promise<boolean> {
    if (!env.etherscanKey) return false;
    try {
      const eth = { slug: "ethereum", etherscanChainId: 1 } as ChainRow;
      const r = await this.call<string>(eth, { module: "proxy", action: "eth_blockNumber" });
      return typeof r === "string" && r.startsWith("0x");
    } catch {
      return false;
    }
  }
}
