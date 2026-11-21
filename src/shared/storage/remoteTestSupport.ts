import type { Deps } from '../../../worker/src/deps';
import { handleData } from '../../../worker/src/data/routes';
import { memoryBucket } from '../../../worker/src/data/testBucket';
import { testDb } from '../../../worker/src/kg/testDb';
import { RemoteDocStore } from './remoteDocStore';

export const testId = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;

export function testWorkerData(configured = true) {
  const { db, sqlite } = testDb('migrations-data');
  const deps: Deps = {
    data: configured ? db : undefined,
    bucket: memoryBucket().bucket,
    now: () => new Date('2026-11-20T00:00:00.000Z'),
    allowedOrigins: [],
    verifyToken: async () => ({ uid: 'test', email: 'test@hyperdatalab.org' }),
  };
  const baseUrl = 'https://worker.test';
  const requests: Request[] = [];
  const dispatch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    requests.push(request.clone());
    if (request.headers.get('Authorization') !== 'Bearer lab-test')
      return new Response(null, { status: 401 });
    return handleData(deps, request, new URL(request.url).pathname, 'test@hyperdatalab.org', {}, testId(1));
  };
  const connect = (send = dispatch) =>
    new RemoteDocStore({ baseUrl, fetch: send, getToken: async () => 'lab-test', projectId: testId(1) });
  return { connect, dispatch, requests, sqlite };
}
