import { defineConfig } from 'tsup';
export default defineConfig({
  entry: ['src/bin/furlpay.ts'],
  format: ['esm'],
  clean: true,
});
