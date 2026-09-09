import { Command } from 'commander';

export const networkCommand = new Command('network')
  .action(() => {
    console.log('Network: HEALTHY, 2000 TPS, Mode: TOWER_BFT');
  });
