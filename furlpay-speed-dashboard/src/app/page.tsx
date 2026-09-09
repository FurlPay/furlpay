import SpeedGauge from '@/components/SpeedGauge';
import FinalityCounter from '@/components/FinalityCounter';
import SuccessRate from '@/components/SuccessRate';
import TotalPayments from '@/components/TotalPayments';
import NetworkHealth from '@/components/NetworkHealth';
import SolanaTPSGauge from '@/components/SolanaTPSGauge';
import ComparisonTicker from '@/components/ComparisonTicker';
import AlpenglowBanner from '@/components/AlpenglowBanner';
import SpeedChart from '@/components/SpeedChart';

export default function DashboardPage() {
  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <AlpenglowBanner />
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="col-span-1 md:col-span-2 bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h2 className="text-xl font-semibold mb-4 text-gray-200">Median Confirmation Time</h2>
          <div className="flex justify-center items-center h-64">
            <SpeedGauge />
          </div>
        </div>
        
        <div className="space-y-6">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <FinalityCounter />
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <NetworkHealth />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <SuccessRate />
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <TotalPayments />
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <SolanaTPSGauge />
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <h2 className="text-xl font-semibold mb-4 text-gray-200">Confirmation History (24h)</h2>
        <SpeedChart />
      </div>

      <ComparisonTicker />
    </div>
  );
}
