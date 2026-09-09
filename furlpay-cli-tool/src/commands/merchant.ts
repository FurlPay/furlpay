import { Command } from 'commander';

export const merchantCommand = new Command('merchant')
  .description('Merchant commands');

merchantCommand.command('balance').action(() => { console.log('Balance: 1000 USDC'); });
merchantCommand.command('payouts').action(() => { console.log('Payouts: []'); });
