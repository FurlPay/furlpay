"use client";
import { useEffect, useState } from 'react';

export default function SpeedGauge() {
  const [speed, setSpeed] = useState(418);

  useEffect(() => {
    const interval = setInterval(() => {
      setSpeed(400 + Math.floor(Math.random() * 40));
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="relative w-48 h-48 flex items-center justify-center rounded-full border-4 border-blue-500 border-t-transparent animate-[spin_4s_linear_infinite]">
      <div className="absolute inset-0 flex items-center justify-center flex-col animate-[spin_4s_linear_infinite_reverse]">
        <span className="text-4xl font-bold text-white">{speed}</span>
        <span className="text-sm text-blue-400">ms</span>
      </div>
    </div>
  );
}
