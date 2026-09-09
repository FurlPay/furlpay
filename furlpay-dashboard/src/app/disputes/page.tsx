export default function DisputesPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Dispute Center</h1>
      
      <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow">
        <p className="text-gray-500 mb-4">Manage chargebacks and disputes.</p>
        
        <div className="border border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-8 text-center text-gray-500">
            No active disputes! 🎉
        </div>
      </div>
    </div>
  );
}
