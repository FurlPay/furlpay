import { Command } from 'commander';

export const payCommand = new Command('pay')
  .argument('<address>', 'Recipient address')
  .argument('<amount>', 'Amount to pay')
  .option('--currency <currency>', 'Currency', 'USDC')
  .action((address, amount, options) => {
    console.log(`Paying ${amount} ${options.currency} to ${address}`);
  });
