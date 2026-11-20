import { MAX_PDF_BYTES } from './limits';

const DOI_PATTERN = /^10\.\d{4,9}\/[\S]+$/iu;
const MAX_REDIRECTS = 5;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/u;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
export type OpenAlexPdfDependencies = { fetch: typeof fetch };

const json = (status: number, error: string, message: string, headers: Record<string, string>) =>
  new Response(JSON.stringify({ error, message }), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });

function normalizeDoi(value: string) {
  return value
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//iu, '')
    .toLowerCase();
}

function publicHttpsUrl(value: string, base?: string): URL | null {
  try {
    const url = new URL(value, base);
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      (url.port && url.port !== '443') ||
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      host === 'metadata.google.internal' ||
      host.includes(':') ||
      IPV4.test(host)
    )
      return null;
    return url;
  } catch {
    return null;
  }
}

async function readPdf(response: Response): Promise<ArrayBuffer | null> {
  const declaredSize = Number(response.headers.get('content-length'));
  if (declaredSize > MAX_PDF_BYTES) {
    await response.body?.cancel();
    return null;
  }
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_PDF_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  if (size < 5) return null;
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') return null;
  return bytes.buffer;
}

async function fetchPdf(url: string, fetcher: typeof fetch): Promise<ArrayBuffer | null> {
  let current = publicHttpsUrl(url);
  if (!current) return null;
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetcher(current.href, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { Accept: 'application/pdf' },
      });
      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location || redirect === MAX_REDIRECTS) return null;
        current = publicHttpsUrl(location, current.href);
        if (!current) return null;
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        return null;
      }
      return await readPdf(response);
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
  return null;
}

/** Fetches a PDF URL the signed-in PaperLab client received from an OpenAlex OA lookup. */
export async function handleOpenAlexPdf(
  request: Request,
  headers: Record<string, string>,
  deps: OpenAlexPdfDependencies,
): Promise<Response> {
  if (request.method !== 'POST') return json(405, 'method_not_allowed', 'Use POST.', headers);
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json'))
    return json(415, 'content_type', 'Expected application/json.', headers);
  const declaredSize = Number(request.headers.get('content-length'));
  if (declaredSize > 2048) return json(413, 'body_too_large', 'Request body is too large.', headers);

  let bodyText: string;
  try {
    bodyText = await request.text();
  } catch {
    return json(400, 'invalid_json', 'Request body must be valid JSON.', headers);
  }
  if (new TextEncoder().encode(bodyText).byteLength > 2048)
    return json(413, 'body_too_large', 'Request body is too large.', headers);
  let body: { doi?: unknown; pdfUrl?: unknown };
  try {
    body = JSON.parse(bodyText) as { doi?: unknown; pdfUrl?: unknown };
  } catch {
    return json(400, 'invalid_json', 'Request body must be valid JSON.', headers);
  }
  if (typeof body.doi !== 'string') return json(400, 'invalid_doi', 'A DOI is required.', headers);
  const doi = normalizeDoi(body.doi);
  if (doi.length > 300 || !DOI_PATTERN.test(doi))
    return json(400, 'invalid_doi', 'The DOI is not valid.', headers);
  if (typeof body.pdfUrl !== 'string' || body.pdfUrl.length > 2048)
    return json(400, 'invalid_pdf_url', 'An Open Access PDF URL is required.', headers);
  const pdfUrl = publicHttpsUrl(body.pdfUrl);
  if (!pdfUrl) return json(400, 'invalid_pdf_url', 'The PDF URL must use a public HTTPS host.', headers);

  const pdf = await fetchPdf(pdfUrl.href, deps.fetch);
  if (!pdf)
    return json(
      502,
      'pdf_unavailable',
      `The OpenAlex PDF URL did not return a valid PDF for ${doi}.`,
      headers,
    );
  const fileName = `${doi.replace(/[^a-z0-9.-]+/giu, '_')}.pdf`;
  return new Response(pdf, {
    headers: {
      ...headers,
      'Content-Type': 'application/pdf',
      'Content-Length': String(pdf.byteLength),
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
