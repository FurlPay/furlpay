// Chain-head readers for the non-EVM networks.
//
// Alchemy does not cover NEAR, Polkadot, Stellar, Injective, Cardano, Hedera,
// ICP, Cosmos, Osmosis or Algorand, and its free app does not have TRON, Sui or
// Aptos enabled. Rather than pretend one RPC shape fits all of them, each chain
// family gets a small reader against its own public endpoint — every one of
// which was probed before being written down here.
//
// These read chain *liveness and height* only. None of them do whale scanning:
// that would need per-chain transfer indexing which is not free, and claiming
// otherwise would put invented data in front of users.

import { Provider } from "./base.js";
import type { ChainRow } from "../types/index.js";

export interface HeadReading {
  height: number | null;
  timestamp: number | null;
  latencyMs: number;
  source: string;
}

export class NonEvmProvider extends Provider {
  constructor() {
    super({
      name: "public-chain-api",
      kind: "blockchain",
      configured: true,
      rps: 5,
      timeoutMs: 12_000,
      attempts: 2,
    });
  }

  /** Dispatch on chain family; returns nulls rather than throwing on no-data. */
  async head(chain: ChainRow): Promise<HeadReading> {
    const base = chain.publicRpc[0];
    if (!base) return { height: null, timestamp: null, latencyMs: 0, source: "none" };
    const t0 = Date.now();
    const host = safeHost(base);
    const done = (height: number | null, ts: number | null): HeadReading => ({
      height,
      timestamp: ts,
      latencyMs: Date.now() - t0,
      source: host,
    });

    switch (chain.chainType) {
      case "cosmos": {
        const d = await this.request<{ block?: { header?: { height?: string; time?: string } } }>(
          `${base}/cosmos/base/tendermint/v1beta1/blocks/latest`,
          {},
          { label: `${chain.slug}.head` },
        );
        const h = Number(d?.block?.header?.height);
        const ts = d?.block?.header?.time ? Date.parse(d.block.header.time) : null;
        return done(Number.isFinite(h) ? h : null, ts);
      }

      case "near": {
        const d = await this.rpc<{ sync_info?: { latest_block_height?: number; latest_block_time?: string } }>(
          base,
          "status",
          [null],
          { label: `${chain.slug}.status` },
        );
        const ts = d?.sync_info?.latest_block_time
          ? Date.parse(d.sync_info.latest_block_time)
          : null;
        return done(d?.sync_info?.latest_block_height ?? null, ts);
      }

      case "substrate": {
        const d = await this.rpc<{ number?: string }>(base, "chain_getHeader", [], {
          label: `${chain.slug}.header`,
        });
        const h = d?.number ? Number.parseInt(d.number, 16) : NaN;
        return done(Number.isFinite(h) ? h : null, null);
      }

      case "stellar": {
        const d = await this.request<{
          _embedded?: { records?: Array<{ sequence: number; closed_at: string }> };
        }>(`${base}/ledgers?order=desc&limit=1`, {}, { label: `${chain.slug}.ledgers` });
        const r = d?._embedded?.records?.[0];
        return done(r?.sequence ?? null, r?.closed_at ? Date.parse(r.closed_at) : null);
      }

      case "algorand": {
        const d = await this.request<{ "last-round"?: number }>(`${base}/v2/status`, {}, {
          label: `${chain.slug}.status`,
        });
        return done(d?.["last-round"] ?? null, null);
      }

      case "aptos": {
        const d = await this.request<{ ledger_version?: string; ledger_timestamp?: string }>(
          base,
          {},
          { label: `${chain.slug}.ledger` },
        );
        const h = Number(d?.ledger_version);
        // Aptos reports microseconds since epoch.
        const ts = d?.ledger_timestamp ? Math.floor(Number(d.ledger_timestamp) / 1000) : null;
        return done(Number.isFinite(h) ? h : null, Number.isFinite(ts as number) ? ts : null);
      }

      case "sui": {
        const seq = await this.rpc<string>(base, "sui_getLatestCheckpointSequenceNumber", [], {
          label: `${chain.slug}.checkpoint`,
        });
        const h = Number(seq);
        return done(Number.isFinite(h) ? h : null, null);
      }

      case "tron": {
        const d = await this.request<{
          block_header?: { raw_data?: { number?: number; timestamp?: number } };
        }>(`${base}/wallet/getnowblock`, { method: "POST" }, { label: `${chain.slug}.nowblock` });
        return done(
          d?.block_header?.raw_data?.number ?? null,
          d?.block_header?.raw_data?.timestamp ?? null,
        );
      }

      case "cardano": {
        const d = await this.request<Array<{ block_no?: number; block_time?: number }>>(
          `${base}/tip`,
          {},
          { label: `${chain.slug}.tip` },
        );
        const r = Array.isArray(d) ? d[0] : undefined;
        return done(r?.block_no ?? null, r?.block_time ? r.block_time * 1000 : null);
      }

      case "hedera": {
        const d = await this.request<{ transactions?: Array<{ consensus_timestamp?: string }> }>(
          `${base}/transactions?limit=1&order=desc`,
          {},
          { label: `${chain.slug}.transactions` },
        );
        const ts = d?.transactions?.[0]?.consensus_timestamp;
        // Hedera has no block height; consensus timestamp is the liveness proof.
        return done(null, ts ? Math.floor(Number(ts) * 1000) : null);
      }

      case "icp": {
        const d = await this.request<{ block_height?: Array<[number, string]> }>(
          `${base}/metrics/block-height`,
          {},
          { label: `${chain.slug}.block-height` },
        );
        const pair = d?.block_height?.[0];
        const h = pair ? Number(pair[1]) : NaN;
        return done(Number.isFinite(h) ? h : null, pair ? pair[0] * 1000 : null);
      }

      case "starknet": {
        const h = await this.rpc<number>(base, "starknet_blockNumber", [], {
          label: `${chain.slug}.blockNumber`,
        });
        return done(typeof h === "number" ? h : null, null);
      }

      default:
        return done(null, null);
    }
  }

  async ping(): Promise<boolean> {
    try {
      const d = await this.request<{ "last-round"?: number }>(
        "https://mainnet-api.algonode.cloud/v2/status",
        {},
        { label: "ping" },
      );
      return typeof d?.["last-round"] === "number";
    } catch {
      return false;
    }
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "unknown";
  }
}
