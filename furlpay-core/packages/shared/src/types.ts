import { PublicKey } from '@solana/web3.js';

export enum PaymentStatus {
  CREATED = 'CREATED',
  SIGNED = 'SIGNED',
  SUBMITTED = 'SUBMITTED',
  LANDED = 'LANDED',
  CONFIRMED = 'CONFIRMED',
  FINALIZED = 'FINALIZED',
  FAILED = 'FAILED',
  EXPIRED = 'EXPIRED'
}
export interface PaymentRequest { id: string; amount: number; }
export interface PaymentResult { id: string; status: PaymentStatus; }
export interface MerchantConfig { id: string; }
export enum SettlementTier { INSTANT = 'INSTANT', STANDARD = 'STANDARD', HIGH_VALUE = 'HIGH_VALUE', INSTITUTIONAL = 'INSTITUTIONAL' }
export enum NetworkHealth { HEALTHY = 'HEALTHY', DEGRADED = 'DEGRADED', DOWN = 'DOWN' }
export enum FinalityMode { TOWER_BFT = 'TOWER_BFT', ALPENGLOW = 'ALPENGLOW' }
export type StablecoinMint = PublicKey;
export interface TransactionLifecycle { status: PaymentStatus; }
export interface WebhookEvent { type: string; }
export interface RpcProviderConfig { url: string; }
export interface FeeEstimate { amount: number; }
export interface SettlementReceipt { id: string; }
