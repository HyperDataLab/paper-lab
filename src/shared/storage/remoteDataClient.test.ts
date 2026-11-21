import { expect, it } from 'vitest';
import { RemoteDataClient } from './remoteDataClient';

const client = (etag: string) =>
  new RemoteDataClient({
    getToken: async () => 'synthetic-token',
    projectId: '00000000-0000-4000-8000-000000000001',
    baseUrl: 'https://worker.test',
    fetch: async () =>
      new Response(JSON.stringify({ id: 'c1' }), {
        status: 200,
        headers: { ETag: etag, 'Content-Type': 'application/json' },
      }),
  });

it('reads the version from a strong ETag', async () => {
  await expect(client('"v3"').get('corpora', 'c1')).resolves.toEqual({ doc: { id: 'c1' }, version: 3 });
});

it('reads the version from a weak ETag, as Cloudflare sends after compressing a response', async () => {
  await expect(client('W/"v7"').get('corpora', 'c1')).resolves.toEqual({ doc: { id: 'c1' }, version: 7 });
});
