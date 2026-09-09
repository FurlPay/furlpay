import type { NfcPaymentRequest } from './types';

export interface NfcAdapter {
  isSupported(): Promise<boolean>;
  isEnabled(): Promise<boolean>;
  startReading(): Promise<void>;
  stopReading(): Promise<void>;
  onMessage(callback: (message: any) => void): void;
}

/**
 * Handles reading NDEF messages and parsing them into FurlPay requests
 */
export class NfcPaymentReader {
  constructor(private adapter: NfcAdapter) {}

  public async start(): Promise<void> {
    const supported = await this.adapter.isSupported();
    if (!supported) throw new Error('NFC not supported');
    
    await this.adapter.startReading();
  }

  public async stop(): Promise<void> {
    await this.adapter.stopReading();
  }

  /**
   * Parses an NDEF message back into a NfcPaymentRequest.
   */
  public parseNdefMessage(message: any): NfcPaymentRequest {
    // Basic implementation parsing the JSON payload emitted by emitter
    if (!message.data) throw new Error('Invalid NDEF message');
    
    try {
      const decoder = new TextDecoder();
      const jsonStr = decoder.decode(message.data);
      return JSON.parse(jsonStr) as NfcPaymentRequest;
    } catch (e) {
      throw new Error('Failed to parse NFC payment data');
    }
  }
}
