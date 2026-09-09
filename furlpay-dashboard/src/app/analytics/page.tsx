import FeeSavingsCard from '@/components/FeeSavingsCard';
import SpeedChart from '@/components/SpeedChart';
import VolumeChart from '@/components/VolumeChart';

export default function AnalyticsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Analytics</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <FeeSavingsCard />
        <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow">
            <h3 className="font-semibold mb-4">Network Speed (Median)</h3>
            <SpeedChart />
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow">
        <h3 className="font-semibold mb-4">Volume Over Time</h3>
        <VolumeChart />
      </div>
    </div>
  );
}
