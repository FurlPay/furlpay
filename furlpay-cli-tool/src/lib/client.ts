import { loadConfig } from './config.js';
export function getClient() {
  const config = loadConfig();
  return { apiKey: config.apiKey };
}
