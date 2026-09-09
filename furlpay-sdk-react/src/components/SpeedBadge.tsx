import React from 'react';

export interface SpeedBadgeProps {
  confirmationMs: number;
  finalityMs?: number;
}

export function SpeedBadge({ confirmationMs, finalityMs }: SpeedBadgeProps) {
  const time = finalityMs || confirmationMs;
  return (
    <span className="furlpay-speed-badge">
      Settled in {time}ms
    </span>
  );
}
