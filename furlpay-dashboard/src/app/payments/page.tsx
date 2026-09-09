import PaymentFeed from '@/components/PaymentFeed';

export default function PaymentsPage() {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Payments</h1>
        <div className="flex gap-2">
            <input type="text" placeholder="Search Tx..." className="px-4 py-2 rounded bg-white dark:bg-gray-800 border dark:border-gray-700" />
            <select className="px-4 py-2 rounded bg-white dark:bg-gray-800 border dark:border-gray-700">
                <option>All Statuses</option>
                <option>Pending</option>
                <option>Confirmed</option>
                <option>Finalized</option>
            </select>
        </div>
      </div>
      
      <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow">
        <PaymentFeed />
      </div>
    </div>
  );
}
