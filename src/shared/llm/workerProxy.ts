import { PDF_WORKER_URL, projectScopedUrl } from '@/shared/pdfStore';

const ROUTER_HOSTS = new Set(['9router.dcloud.io.vn', '9router.oraltest.site']);

/** Routes the configured 9router hosts through the authenticated PaperLab Worker to avoid upstream CORS. */
export function createLlmWorkerFetch(
  baseUrl: string,
  projectId: string | null,
  getAccessToken: () => Promise<string | null>,
  send: typeof fetch = fetch,
): typeof fetch {
  return async (input, init) => {
    let source: Request;
    try {
      source = new Request(input, init);
    } catch {
      return send(input, init);
    }
    const sourceUrl = new URL(source.url);
    if (!ROUTER_HOSTS.has(sourceUrl.hostname.toLowerCase())) return send(input, init);
    if (!projectId)
      return Response.json({ error: 'Mở PaperLab từ một project ResearchHub trước khi gọi 9router.' }, { status: 400 });
    const key = /^Bearer (.+)$/u.exec(source.headers.get('Authorization') ?? '')?.[1];
    if (!key) return Response.json({ error: 'Thiếu API key 9router.' }, { status: 400 });
    const token = await getAccessToken();
    if (!token) return Response.json({ error: 'Phiên ResearchHub chưa sẵn sàng.' }, { status: 401 });

    const headers = new Headers(source.headers);
    headers.set('Authorization', `Bearer ${token}`);
    headers.set('X-Project-Id', projectId);
    headers.set('X-LLM-API-Key', key);
    headers.set('X-LLM-Base-URL', baseUrl.replace(/\/$/u, ''));
    headers.delete('content-length');
    const url = projectScopedUrl(`${PDF_WORKER_URL}/v1/llm/chat/completions`, projectId);
    return send(url, {
      method: source.method,
      headers,
      body: await source.arrayBuffer(),
      signal: source.signal,
    });
  };
}
