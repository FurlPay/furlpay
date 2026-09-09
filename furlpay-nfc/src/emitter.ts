import { FURLPAY_NFC_AID, FurlPayNdefType, encodeAmount } from './protocol';
import type { NfcPaymentRequest } from './types';

/**
 * Handles encoding of payment requests into NDEF messages
 * suitable for NFC transmission.
 */
export class NfcPaymentEmitter {
  /**
   * Encodes a payment request into a binary payload.
   * Format: version(1) + recipient(32) + amount(8) + token(32) + ref(32) + label(len+val) + message(len+val)
   * This is a simplified encoding for demonstration.
   */
  public encodePayment(request: NfcPaymentRequest): Uint8Array {
    const payload = JSON.stringify(request);
    const encoder = new TextEncoder();
    return encoder.encode(payload);
  }

  /**
   * Builds an NDEF record from the encoded payment data.
   */
  public buildNdefRecord(request: NfcPaymentRequest): any {
    const payload = this.encodePayment(request);
    
    // In a real implementation, this would construct a proper NDEF record structure
    // compatible with web-nfc or react-native-nfc-manager
    return {
      recordType: 'unknown',
      mediaType: FurlPayNdefType,
      data: payload
    };
  }
}
