import { Command } from 'commander';

export const statusCommand = new Command('status')
  .argument('<paymentId>', 'Payment ID')
  .action((paymentId) => {
    console.log(`Status for payment ${paymentId}: CONFIRMED`);
  });
