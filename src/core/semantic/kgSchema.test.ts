import { expect, it } from 'vitest';
import { KgSqlOutputSchema } from '../schemas/kgSql';
import { CONCEPTS } from './concepts';
import { buildKgSqlPrompt } from './kgSchema';

it('semantic step 4 prompts with every KG table, its columns and relations', () => {
  const question = 'Bài nào có nhiều citations nhất?';
  const { system, user } = buildKgSqlPrompt(question);
  expect(user).toBe(question);
  for (const { store, fields, description } of CONCEPTS) {
    if (store.kind !== 'kg') continue;
    expect(system).toContain(`\n${store.table}: ${description}`);
    for (const field of fields) expect(system).toContain(`${field.name} (${field.description})`);
  }
  expect(system).toContain('refers-to keyword via keyword_id');
  expect(system).not.toContain('paperRuns');
  expect(system).not.toContain('paperlab/pdfs/');
});

it('semantic step 4 requires SQL and an explanation in the model response', () => {
  const output = { sql: 'SELECT title FROM paper', explanation: 'Reads the titles.' };
  expect(KgSqlOutputSchema.parse(output)).toEqual(output);
  expect(KgSqlOutputSchema.safeParse({ sql: output.sql }).success).toBe(false);
});
