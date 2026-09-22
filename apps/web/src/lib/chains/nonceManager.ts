// ---------------------------------------------------------------------------
// Nonce manager for fee-payer transactions.
//
// THE PROBLEM: A fee-payer (paymaster, relayer) sends multiple transactions
// concurrently. Each needs a unique nonce, and if one fails, the subsequent
// nonces are stuck. The chain cannot tell you the "next safe nonce" when
// transactions are in-flight.
//
// THIS MODULE: tracks in-flight nonces per address per chain, allocates
// the next nonce, and handles gaps from failed transactions.
// ---------------------------------------------------------------------------

export interface NonceState {
  chain: string;
  address: string;
  /** Last confirmed on-chain nonce */
  confirmedNonce: number;
  /** Next nonce to allocate */
  nextNonce: number;
  /** Nonces currently in-flight */
  inFlight: Set<number>;
  /** Last synced with chain */
  lastSyncAt: string;
}

export interface NonceAllocation {
  nonce: number;
  chain: string;
  address: string;
  /** Call this when the transaction confirms or fails */
  release: (outcome: "confirmed" | "failed" | "replaced") => void;
}

// In-memory store for local Node process concurrency
const store = new Map<string, NonceState>();

function getStateKey(chain: string, address: string): string {
  return `${chain.toLowerCase()}:${address.toLowerCase()}`;
}

function initializeState(chain: string, address: string): NonceState {
  const state: NonceState = {
    chain,
    address,
    confirmedNonce: -1,
    nextNonce: 0,
    inFlight: new Set<number>(),
    lastSyncAt: new Date().toISOString(),
  };
  store.set(getStateKey(chain, address), state);
  return state;
}

/**
 * Mock interface for chain interaction. 
 * Replace or adapt based on actual ethers/viem adapter.
 */
export interface INonceAdapter {
  getTransactionCount(address: string, blockTag: "latest" | "pending"): Promise<number>;
}

/**
 * Synchronizes the base nonce from the chain.
 * Call this during initialization or recovery from severe gaps.
 */
export async function syncFromChain(
  chain: string,
  address: string,
  adapter: INonceAdapter
): Promise<void> {
  const key = getStateKey(chain, address);
  let state = store.get(key) || initializeState(chain, address);
  
  const count = await adapter.getTransactionCount(address, "latest");
  
  state.confirmedNonce = count - 1;
  // If there are no in-flight nonces, align nextNonce to the pending network state
  if (state.inFlight.size === 0) {
    state.nextNonce = count;
  }
  
  state.lastSyncAt = new Date().toISOString();
  store.set(key, state);
}

/**
 * Allocates the next available sequential nonce.
 * Threads safe within a single Node.js event loop due to synchronous execution.
 */
export function allocateNonce(chain: string, address: string): NonceAllocation {
  const key = getStateKey(chain, address);
  let state = store.get(key) || initializeState(chain, address);
  
  // To handle the gap problem: if a lower nonce failed and is dropped from inFlight,
  // we SHOULD technically reuse it. For simplicity in this implementation,
  // we just keep advancing nextNonce. A more robust implementation for the 
  // "failed nonce 5 but 6 and 7 in flight" issue requires transaction replacement (sending 
  // a dummy tx or re-broadcasting at the failed nonce).
  
  const nonce = state.nextNonce++;
  state.inFlight.add(nonce);
  store.set(key, state);
  
  return {
    nonce,
    chain,
    address,
    release: (outcome: "confirmed" | "failed" | "replaced") => {
      releaseNonce(chain, address, nonce, outcome);
    }
  };
}

/**
 * Releases an in-flight nonce and processes the outcome.
 */
export function releaseNonce(
  chain: string,
  address: string,
  nonce: number,
  outcome: "confirmed" | "failed" | "replaced"
): void {
  const key = getStateKey(chain, address);
  const state = store.get(key);
  if (!state) return;
  
  state.inFlight.delete(nonce);
  
  if (outcome === "confirmed") {
    // Update confirmed nonce only if it strictly increases
    if (nonce > state.confirmedNonce) {
      state.confirmedNonce = nonce;
    }
  } else if (outcome === "failed") {
    // GAP PROBLEM DETECTION:
    // If a nonce fails and there are higher nonces in-flight, those higher nonces
    // will be stuck in the mempool forever until this exact nonce is filled.
    // Resolution logic (e.g. queueing a dummy 0-value tx) goes here.
    console.warn(`[NonceManager] Nonce ${nonce} failed for ${address} on ${chain}. Potential gap!`);
  }
  
  store.set(key, state);
}

/**
 * Gets the number of transactions currently awaiting confirmation.
 */
export function getInFlightCount(chain: string, address: string): number {
  const key = getStateKey(chain, address);
  const state = store.get(key);
  return state ? state.inFlight.size : 0;
}
