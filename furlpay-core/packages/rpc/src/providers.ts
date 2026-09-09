import { RpcProvider } from './types.js';

export function createHeliusProvider(apiKey: string, region?: string): RpcProvider {
    return {
        name: 'Helius',
        endpoint: `https://mainnet.helius-rpc.com/?api-key=${apiKey}`,
        wsEndpoint: `wss://mainnet.helius-rpc.com/?api-key=${apiKey}`,
        staked: true,
        weight: 10,
        region
    };
}

export function createTritonProvider(apiKey: string): RpcProvider {
    return {
        name: 'Triton',
        endpoint: `https://mainnet.rpcpool.com/${apiKey}`,
        wsEndpoint: `wss://mainnet.rpcpool.com/${apiKey}`,
        staked: true,
        weight: 10
    };
}

export function createQuickNodeProvider(endpoint: string): RpcProvider {
    return {
        name: 'QuickNode',
        endpoint: endpoint,
        staked: false,
        weight: 5
    };
}

export function createCustomProvider(name: string, endpoint: string, options?: Partial<RpcProvider>): RpcProvider {
    return {
        name,
        endpoint,
        staked: options?.staked ?? false,
        weight: options?.weight ?? 1,
        ...options
    };
}

export const DEFAULT_MAINNET_PROVIDERS: RpcProvider[] = [
    createCustomProvider('SolanaMainnet', 'https://api.mainnet-beta.solana.com', { weight: 1 })
];

export const DEFAULT_DEVNET_PROVIDERS: RpcProvider[] = [
    createCustomProvider('SolanaDevnet', 'https://api.devnet.solana.com', { weight: 1 })
];
