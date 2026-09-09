export const FURLPAY_NFC_AID = 'F055524C504159'; // FURLPAY hex representation
export const FurlPayNdefType = 'application/vnd.furlpay.payment';
export const PROTOCOL_VERSION = 1;

/**
 * Encodes an amount to a consistent precision (e.g., 6 decimals for USDC)
 * Returning as a BigInt string representation.
 */
export function encodeAmount(amountStr: string, decimals: number = 6): string {
  const parts = amountStr.split('.');
  let integerPart = parts[0] || '0';
  let fractionalPart = parts[1] || '';
  
  if (fractionalPart.length > decimals) {
    fractionalPart = fractionalPart.substring(0, decimals);
  } else {
    fractionalPart = fractionalPart.padEnd(decimals, '0');
  }
  
  // Remove leading zeros from integer part if it's strictly > 0
  integerPart = integerPart.replace(/^0+/, '');
  if (integerPart === '') integerPart = '0';
  
  const total = integerPart + fractionalPart;
  // Clear possible leading zeros in total
  return total.replace(/^0+/, '') || '0';
}

export function decodeAmount(encodedStr: string, decimals: number = 6): string {
  const padded = encodedStr.padStart(decimals + 1, '0');
  const integerPart = padded.slice(0, -decimals);
  const fractionalPart = padded.slice(-decimals);
  
  return `${integerPart}.${fractionalPart}`;
}
