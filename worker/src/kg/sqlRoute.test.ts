import { expect, it } from 'vitest';
import { handle, type Deps } from '../app';
import { NotAllowedError } from '../auth';
import { testDb } from './testDb';

function setup() {
  const { db, sqlite } = testDb();
  sqlite.exec("INSERT INTO author (id, display_name) VALUES ('A1', 'Synthetic author')");
  const deps: Deps = {
    verifyToken: async (token) => {
      if (token === 'outside') throw new NotAllowedError();
      if (token !== 'lab') throw new Error('Invalid token');
      return { uid: 'synthetic', email: 'synthetic@example.invalid' };
    },
    bucket: {
      head: async () => null,
      get: async () => null,
      list: async () => ({ objects: [], truncated: false }),
      put: async () => null,
    },
    allowedOrigins: [],
    now: () => new Date(),
    kg: { KG: db },
  };
  return (body: unknown, token = 'lab') =>
    handle(
      deps,
      new Request('https://worker.test/v1/kg/sql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
        body: JSON.stringify(body),
      }),
    );
}

it('semantic step 4 requires a signed-in lab user for SQL', async () => {
  const call = setup();
  const body = { sql: 'SELECT id FROM author' };
  expect((await call(body, '')).status).toBe(401);
  expect((await call(body, 'invalid')).status).toBe(401);
  expect((await call(body, 'outside')).status).toBe(403);
});

it.each([
  [{ sql: 'SELECT * FROM doc' }, 'sql_table'],
  [{ sql: 'SELECT missing FROM author' }, 'sql_execution'],
  [{ sql: 'SELECT id FROM author', limit: 0 }, 'bad_request'],
])('semantic step 4 returns 400 with a code for %j', async (body, error) => {
  const response = await setup()(body);
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error, message: expect.any(String) });
});

it('semantic step 4 returns 200 and SQL data from the KG binding alone', async () => {
  const sql = 'SELECT display_name FROM author';
  const response = await setup()({ sql });
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(await response.json()).toEqual({
    sql,
    columns: ['display_name'],
    rows: [['Synthetic author']],
    truncated: false,
    concepts: ['kg-author'],
  });
});
