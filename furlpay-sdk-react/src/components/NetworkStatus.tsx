import React, { useState, useEffect } from 'react';

export function NetworkStatus({ className }: { className?: string }) {
  const [health, setHealth] = useState<'HEALTHY' | 'DEGRADED' | 'DOWN'>('HEALTHY');

  useEffect(() => {
    // mock network check
    setHealth('HEALTHY');
  }, []);

  return (
    <div className={`furlpay-network-status ${className || ''}`}>
      {health === 'HEALTHY' && '🟢 Healthy'}
      {health === 'DEGRADED' && '🟡 Degraded'}
      {health === 'DOWN' && '🔴 Down'}
    </div>
  );
}
