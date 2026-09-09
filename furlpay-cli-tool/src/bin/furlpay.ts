#!/usr/bin/env node
import { Command } from 'commander';
import { initCommand } from '../commands/init.js';
import { payCommand } from '../commands/pay.js';
import { statusCommand } from '../commands/status.js';
import { networkCommand } from '../commands/network.js';
import { merchantCommand } from '../commands/merchant.js';
import { configCommand } from '../commands/config.js';

const program = new Command();
program.name('furlpay').description('FurlPay CLI').version('0.1.0');

program.addCommand(initCommand);
program.addCommand(payCommand);
program.addCommand(statusCommand);
program.addCommand(networkCommand);
program.addCommand(merchantCommand);
program.addCommand(configCommand);

program.parse(process.argv);
