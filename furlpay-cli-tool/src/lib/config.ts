import fs from 'fs';
import os from 'os';
import path from 'path';

const configPath = path.join(os.homedir(), '.furlpay.json');

export function saveConfig(config: any) {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

export function loadConfig() {
  if (fs.existsSync(configPath)) {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }
  return {};
}
