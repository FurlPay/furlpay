import { Command } from 'commander';
import { saveConfig } from '../lib/config.js';

export const initCommand = new Command('init')
  .description('Interactive setup wizard')
  .action(async () => {
    console.log('Initializing FurlPay...');
    saveConfig({ apiKey: 'mock_key', environment: 'sandbox' });
    console.log('Config saved to ~/.furlpay.json');
  });
