export interface NfcPaymentRequest {
  recipient: string; // Solana PublicKey base58
  amount: string; // Token amount or SOL amount
  token?: string; // Token mint address, if empty means SOL
  reference?: string; // Payment reference string
  label?: string; // Store name
  message?: string; // Order description
}

export interface NfcPaymentResponse {
  signature: string; // Transaction signature
  status: 'success' | 'failed' | 'pending';
  error?: string;
}

export interface NfcConfig {
  debug?: boolean;
  timeoutMs?: number;
}
