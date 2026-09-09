import { PublicKey } from '@solana/web3.js';
export function buildSolanaPayUrl(params: any): string { return `solana:${params.recipient.toBase58()}?amount=${params.amount}&reference=${params.reference}`; }
export function parseSolanaPayUrl(url: string): any { return { url }; }
