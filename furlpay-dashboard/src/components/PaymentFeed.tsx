import SettlementStatus from './SettlementStatus';

export default function PaymentFeed({ limit }: { limit?: number }) {
  const dummyData = [
    { id: '1', amount: '25.00 USDC', status: 'finalized', payer: '7Dk...9xR', time: '2 mins ago' },
    { id: '2', amount: '150.00 USDC', status: 'confirmed', payer: 'As4...2bQ', time: '5 mins ago' },
    { id: '3', amount: '1.5 SOL', status: 'pending', payer: '9Po...1zK', time: 'Just now' },
  ];

  const displayData = limit ? dummyData.slice(0, limit) : dummyData;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr className="text-gray-500 text-sm border-b dark:border-gray-700">
            <th className="pb-3 font-medium">Amount</th>
            <th className="pb-3 font-medium">Status</th>
            <th className="pb-3 font-medium">Payer</th>
            <th className="pb-3 font-medium">Time</th>
          </tr>
        </thead>
        <tbody className="divide-y dark:divide-gray-700">
          {displayData.map((tx) => (
            <tr key={tx.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
              <td className="py-3 font-medium">{tx.amount}</td>
              <td className="py-3"><SettlementStatus status={tx.status as any} /></td>
              <td className="py-3 text-gray-500 font-mono text-sm">{tx.payer}</td>
              <td className="py-3 text-gray-500 text-sm">{tx.time}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
