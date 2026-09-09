import { PublicKey, Transaction } from '@solana/web3.js';
export interface PaymentComposerConfig { rpcUrl: string; }
export interface PaymentParams { recipient: PublicKey; amount: number; mint?: PublicKey; memo: string; invoiceId: string; merchantId: string; }
export interface ComposedTransaction { tx: Transaction; }
export interface RetryConfig { maxAttempts: number; }
export interface SimulationResult { success: boolean; error?: any; }
