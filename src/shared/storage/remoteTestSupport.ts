import type { Deps } from '../../../worker/src/deps';
import { handleData } from '../../../worker/src/data/routes';
import { memoryBucket } from '../../../worker/src/data/testBucket';
import { testDb } from '../../../worker/src/kg/testDb';
import { PDF_WORKER_URL } from '@/shared/pdfStore';
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
    const rawUrl = input instanceof Request ? input.url : input.toString();
    const request = new Request(new URL(rawUrl, baseUrl), init);
    requests.push(request.clone());
    if (request.headers.get('Authorization') !== 'Bearer lab-test')
      return new Response(null, { status: 401 });
    const requestPath = new URL(request.url).pathname;
    if (requestPath.endsWith('/v1/me')) {
      return Response.json({ project: { name: 'ResearchHub test project' }, email: 'test@hyperdatalab.org' });
    }
    return handleData(
      deps,
      request,
      requestPath.replace(/^\/paperlab-worker/u, ''),
      'test@hyperdatalab.org',
      {},
      testId(1),
    );
  };
  const connect = (send = dispatch) =>
    new RemoteDocStore({ baseUrl, fetch: send, getToken: async () => 'lab-test', projectId: testId(1) });
  /**
   * The worker as the app reaches it through the global `fetch` and PDF_WORKER_URL, which is a same-origin
   * proxy path in dev and tests. It answers StorageProvider's project check for testId(1) and sends every
   * other route to `dispatch`.
   */
  const appFetch: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.origin);
    const prefix = new URL(PDF_WORKER_URL, url).pathname.replace(/\/$/u, '');
    const path = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : url.pathname;
    if (path === '/v1/me') {
      const project = new Headers(init?.headers).get('X-Project-Id');
      if (project !== testId(1)) return Response.json({ error: 'project not found' }, { status: 404 });
      return Response.json({
        email: 'test@hyperdatalab.org',
        admin: false,
        project: { id: project, name: 'Test project' },
      });
    }
    return dispatch(`${baseUrl}${path}${url.search}`, init);
  };
  return { connect, dispatch, appFetch, requests, sqlite };
}
