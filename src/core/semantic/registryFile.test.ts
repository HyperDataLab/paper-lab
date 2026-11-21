/// <reference types="node" />
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { toJson } from './index';

// The lab MCP server ships a copy of this file instead of importing app code (docs/plans/SEMANTIC_LAYER.md, step 3).
const FILE = resolve(process.cwd(), 'docs/semantic/registry.json');
const expected = `${JSON.stringify(toJson(), null, 2)}\n`;

it('docs/semantic/registry.json matches the semantic registry (refresh: npm run semantic:export)', () => {
  if (process.env.UPDATE_SEMANTIC === '1') {
    mkdirSync(dirname(FILE), { recursive: true });
    writeFileSync(FILE, expected);
  }
  expect(existsSync(FILE), 'run npm run semantic:export').toBe(true);
  expect(readFileSync(FILE, 'utf8').replace(/\r\n/gu, '\n')).toBe(expected);
});
