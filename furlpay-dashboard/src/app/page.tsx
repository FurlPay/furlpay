import StatsCard from '@/components/StatsCard';
import PaymentFeed from '@/components/PaymentFeed';

export default function Home() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Welcome back, Merchant!</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatsCard title="Total Payments" value="$12,450" trend="+12%" />
        <StatsCard title="Revenue Today" value="$850" trend="+5%" />
        <StatsCard title="Success Rate" value="99.9%" trend="+0.1%" />
        <StatsCard title="Avg Confirmation" value="400ms" trend="-50ms" />
      </div>

      <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow">
        <h2 className="text-xl font-semibold mb-4">Recent Payments</h2>
        <PaymentFeed limit={5} />
      </div>
    </div>
  );
}
