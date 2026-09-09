import React from 'react';

export interface QRCodeProps {
  paymentUrl: string;
  size?: number;
  className?: string;
}

export function QRCode({ paymentUrl, size = 128, className }: QRCodeProps) {
  return (
    <div className={`furlpay-qr-code ${className || ''}`} style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <rect width="100" height="100" fill="#fff" />
        <rect width="20" height="20" fill="#000" />
        <rect x="80" width="20" height="20" fill="#000" />
        <rect y="80" width="20" height="20" fill="#000" />
        <text x="50" y="50" fontSize="10" textAnchor="middle" fill="#000">QR Mock</text>
      </svg>
    </div>
  );
}
