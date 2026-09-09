export default function PayoutsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Payouts</h1>
      
      <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow">
        <div className="flex justify-between items-center mb-6">
            <div>
                <p className="text-gray-500">Available Balance</p>
                <p className="text-3xl font-bold text-furlpay-500">145.50 SOL</p>
            </div>
            <button className="bg-furlpay-600 hover:bg-furlpay-500 text-white px-6 py-2 rounded-lg font-medium">Initiate Payout</button>
        </div>
        
        <h3 className="font-semibold mb-4">Payout History</h3>
        <table className="w-full text-left">
            <thead>
                <tr className="text-gray-500 border-b dark:border-gray-700">
                    <th className="pb-2">Date</th>
                    <th className="pb-2">Amount</th>
                    <th className="pb-2">Destination</th>
                    <th className="pb-2">Status</th>
                </tr>
            </thead>
            <tbody>
                <tr className="border-b dark:border-gray-700">
                    <td className="py-4">2024-03-10</td>
                    <td>50.00 SOL</td>
                    <td>HN7c...3qw</td>
                    <td><span className="text-green-500 bg-green-100 dark:bg-green-900/30 px-2 py-1 rounded text-sm">Completed</span></td>
                </tr>
            </tbody>
        </table>
      </div>
    </div>
  );
}
