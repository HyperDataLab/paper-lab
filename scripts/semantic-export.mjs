// Regenerates docs/semantic/registry.json from src/core/semantic (the lab MCP server ships a copy of it).
import { spawnSync } from 'node:child_process';

const result = spawnSync('npx', ['vitest', 'run', 'src/core/semantic/registryFile.test.ts'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, UPDATE_SEMANTIC: '1' },
});
process.exit(result.status ?? 1);
