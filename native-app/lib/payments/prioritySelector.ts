import { prefGet, prefSet } from "@/lib/db";

export type PaymentAsset = 'USDC' | 'USDT' | 'SOL' | 'ETH' | 'BTC' | 'FURL';

const DEFAULT_ORDER: PaymentAsset[] = ['USDC', 'USDT', 'SOL', 'ETH', 'BTC', 'FURL'];
const PREF_KEY = 'payment_priority_order';

export async function getPaymentPriority(): Promise<PaymentAsset[]> {
  const pref = prefGet(PREF_KEY);
  if (!pref) return DEFAULT_ORDER;
  try {
    const parsed = JSON.parse(pref);
    if (Array.isArray(parsed) && parsed.length > 0) {
      // Validate that all elements are valid PaymentAssets
      const validAssets = parsed.filter(a => DEFAULT_ORDER.includes(a as PaymentAsset));
      // Append any missing default assets
      const missing = DEFAULT_ORDER.filter(a => !validAssets.includes(a));
      return [...validAssets, ...missing] as PaymentAsset[];
    }
  } catch {}
  return DEFAULT_ORDER;
}

export async function setPaymentPriority(order: PaymentAsset[]): Promise<void> {
  prefSet(PREF_KEY, JSON.stringify(order));
}
