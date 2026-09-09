import { SanctionsResult } from './types';

export interface SanctionsProvider {
  screenAddress(address: string): Promise<SanctionsResult>;
}

export async function screenWallet(address: string, provider: SanctionsProvider): Promise<SanctionsResult> {
  return provider.screenAddress(address);
}
