import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { planContractFiles } from './contract';

const files = planContractFiles();
it.each(files.filter(([name]) => name.startsWith('schemas/')).map(([name, value]) => [name.slice(8), value]))(
  'schemas/%s matches the Zod schema',
  (name, value) => {
    const path = join(process.cwd(), 'schemas', name as string);
    expect(existsSync(path), `${String(name)} is missing: run npm run schema:paper-model`).toBe(true);
    expect(JSON.parse(readFileSync(path, 'utf8')) as unknown).toEqual(value);
  },
);
it.each(files.filter(([name]) => name.startsWith('public/')))('%s matches the Zod schema', (name, value) => {
  const path = join(process.cwd(), name);
  expect(existsSync(path), `${name} is missing: run npm run schema:paper-model`).toBe(true);
  expect(JSON.parse(readFileSync(path, 'utf8')) as unknown).toEqual(value);
});
