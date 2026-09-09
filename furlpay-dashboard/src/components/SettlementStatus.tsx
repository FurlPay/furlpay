export default function SettlementStatus({ status }: { status: 'pending' | 'confirmed' | 'finalized' }) {
  const styles = {
    pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-500',
    confirmed: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-500',
    finalized: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-500'
  };

  const icons = {
    pending: '⏳',
    confirmed: '✅',
    finalized: '🔒'
  };

  const labels = {
    pending: 'Pending',
    confirmed: 'Confirmed',
    finalized: 'Finalized'
  };

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${styles[status]}`}>
      <span>{icons[status]}</span>
      {labels[status]}
    </span>
  );
}
