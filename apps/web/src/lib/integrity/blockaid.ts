import BlockaidClient from '@blockaid/client';
import type { TransactionScanResponse } from '@blockaid/client/resources/evm/transaction';
import type { SiteScanHitResponse, SiteScanMissResponse } from '@blockaid/client/resources/site';

const BLOCKAID_API_KEY = process.env.BLOCKAID_API_KEY || '';

const client = new BlockaidClient({
  apiKey: BLOCKAID_API_KEY,
});

export interface SimulationResult {
  status: 'clean' | 'malicious' | 'warning' | 'unavailable';
  description?: string;
  error?: string;
}

/**
 * Simulate an EVM transaction before signing.
 * Fails open with status: 'unavailable' if Blockaid is down or unconfigured.
 */
export async function simulateEvmTransaction(params: {
  accountAddress: string;
  from: string;
  to: string;
  data: string;
  value: string;
  chain: string;
}): Promise<SimulationResult> {
  if (!BLOCKAID_API_KEY) {
    return { status: 'unavailable', error: 'Blockaid API key not configured' };
  }

  try {
    const req = client.evm.transaction.scan({
      account_address: params.accountAddress,
      chain: params.chain,
      data: {
        from: params.from,
        to: params.to,
        data: params.data,
        value: params.value,
      },
      metadata: { domain: 'https://furlpay.com' },
      options: ['simulation', 'validation'],
    });

    const timeout = new Promise<SimulationResult>((resolve) =>
      setTimeout(() => resolve({ status: 'unavailable', error: 'timeout' }), 5000),
    );

    const result = await Promise.race([req, timeout]);
    if ('error' in result) return result as SimulationResult;

    const response = result as TransactionScanResponse;
    const validation = response.validation;
    if (validation && 'result_type' in validation) {
      const resultType = (validation as { result_type: string }).result_type;
      if (resultType === 'Malicious') {
        return { status: 'malicious', description: (validation as { description?: string }).description };
      }
      if (resultType === 'Warning') {
        return { status: 'warning', description: (validation as { description?: string }).description };
      }
    }
    return { status: 'clean' };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { status: 'unavailable', error: message };
  }
}

/**
 * Scan a dApp URL for phishing / malicious patterns.
 */
export async function scanDappUrl(url: string): Promise<SimulationResult> {
  if (!BLOCKAID_API_KEY) {
    return { status: 'unavailable', error: 'Blockaid API key not configured' };
  }

  try {
    const req = client.site.scan({ url, metadata: {} });
    const timeout = new Promise<SimulationResult>((resolve) =>
      setTimeout(() => resolve({ status: 'unavailable', error: 'timeout' }), 3000),
    );

    const result = await Promise.race([req, timeout]);
    if ('error' in result) return result as SimulationResult;

    const response = result as SiteScanHitResponse | SiteScanMissResponse;
    if (response.status === 'hit') {
      const hit = response as SiteScanHitResponse;
      if (hit.is_malicious) {
        return { status: 'malicious', description: `Malicious site (score: ${hit.malicious_score})` };
      }
    }
    return { status: 'clean' };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { status: 'unavailable', error: message };
  }
}
