import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// The worker runs on Cloudflare, not in a browser: its tests use Node's fetch and Web Crypto.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
