"use client";
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function PaymentProgress({ paymentId, successUrl }: { paymentId: string; successUrl: string }) {
  const [status, setStatus] = useState<'pending' | 'confirmed' | 'settled'>('pending');
  const router = useRouter();

  useEffect(() => {
    const eventSource = new EventSource(`/api/status/${paymentId}`);
    
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.status === 'completed') {
        setStatus('settled');
        setTimeout(() => {
          if (successUrl) router.push(successUrl);
        }, 2000);
      } else if (data.status === 'confirmed') {
        setStatus('confirmed');
      }
    };

    return () => eventSource.close();
  }, [paymentId, successUrl, router]);

  return (
    <div className="flex justify-between items-center text-sm font-medium">
      <div className={`flex flex-col items-center ${status === 'pending' ? 'text-blue-600' : 'text-gray-400'}`}>
        <div className={`w-4 h-4 rounded-full mb-1 ${status === 'pending' ? 'bg-blue-600 animate-pulse' : 'bg-gray-300'}`} />
        Waiting
      </div>
      <div className="flex-1 h-0.5 bg-gray-200 mx-2" />
      <div className={`flex flex-col items-center ${status === 'confirmed' ? 'text-blue-600' : 'text-gray-400'}`}>
        <div className={`w-4 h-4 rounded-full mb-1 ${status === 'confirmed' ? 'bg-blue-600 animate-pulse' : 'bg-gray-300'}`} />
        Confirmed
      </div>
      <div className="flex-1 h-0.5 bg-gray-200 mx-2" />
      <div className={`flex flex-col items-center ${status === 'settled' ? 'text-green-600' : 'text-gray-400'}`}>
        <div className={`w-4 h-4 rounded-full mb-1 ${status === 'settled' ? 'bg-green-600' : 'bg-gray-300'}`} />
        Settled
      </div>
    </div>
  );
}
