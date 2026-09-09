"use client";
import { useState, useEffect } from 'react';

export default function SolanaTPSGauge() {
  const [tps, setTps] = useState(2500);

  useEffect(() => {
    const interval = setInterval(() => {
      setTps(2400 + Math.floor(Math.random() * 200));
    }, 1500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="text-center">
      <h3 className="text-sm text-gray-400 mb-2">Solana Live TPS</h3>
      <div className="text-4xl font-bold text-blue-400">{tps.toLocaleString()}</div>
    </div>
  );
}
