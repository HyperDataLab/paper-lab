/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    server: env.LLM_PROXY_TARGET
      ? {
          proxy: {
            '/llm': {
              target: env.LLM_PROXY_TARGET,
              changeOrigin: true,
              rewrite: (path) => path.replace(/^\/llm/, ''),
              headers: env.LLM_PROXY_API_KEY ? { Authorization: `Bearer ${env.LLM_PROXY_API_KEY}` } : {},
            },
          },
        }
      : undefined,
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      coverage: {
        provider: 'v8',
        include: ['src/core/**/*.{ts,tsx}', 'src/shared/llm/**/*.{ts,tsx}'],
        thresholds: { 'src/core/**': { lines: 90 }, 'src/shared/llm/**': { lines: 90 } },
      },
    },
  };
});
