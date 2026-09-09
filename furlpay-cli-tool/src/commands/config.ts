import { Command } from 'commander';

export const configCommand = new Command('config');

configCommand.command('set <key> <value>').action((k, v) => console.log(`Set ${k}=${v}`));
configCommand.command('get <key>').action((k) => console.log(`Get ${k}`));
configCommand.command('list').action(() => console.log('List config'));
