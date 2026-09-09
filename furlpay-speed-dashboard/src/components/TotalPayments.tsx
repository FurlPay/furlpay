"use client";
import { useState, useEffect } from 'react';

export default function TotalPayments() {
  const [count, setCount] = useState(1450230);

  useEffect(() => {
    const interval = setInterval(() => {
      setCount(c => c + Math.floor(Math.random() * 5));
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="text-center">
      <h3 className="text-sm text-gray-400 mb-2">Total Processed</h3>
      <div className="text-4xl font-bold text-white">{count.toLocaleString()}</div>
    </div>
  );
}
