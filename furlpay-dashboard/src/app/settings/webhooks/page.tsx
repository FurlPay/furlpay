export default function WebhooksPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Webhooks</h1>
      
      <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow">
        <div className="flex justify-between mb-4">
            <h3 className="font-semibold text-xl">Endpoints</h3>
            <button className="bg-furlpay-600 text-white px-4 py-2 rounded text-sm">Add Endpoint</button>
        </div>
        
        <div className="border border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-8 text-center text-gray-500">
            No webhook endpoints configured. Add one to receive real-time payment updates.
        </div>
      </div>
    </div>
  );
}
