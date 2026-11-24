import { projectHeader } from '@/shared/scope';
import { PDF_WORKER_URL, PdfRemoteError, projectScopedUrl } from './index';

const TIMEOUT_MS = 180_000;

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

/** Wait for the cold container, within a three-minute total deadline. */
export async function fetchGrobidTei(
  sha: string,
  projectId: string,
  token: string,
  signal?: AbortSignal,
): Promise<string> {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const deadline = Date.now() + TIMEOUT_MS;
  const timeout = setTimeout(
    () => controller.abort(new DOMException('GROBID timed out', 'TimeoutError')),
    TIMEOUT_MS,
  );
  try {
    for (;;) {
      const response = await fetch(
        projectScopedUrl(`${PDF_WORKER_URL}/grobid/fulltext/${encodeURIComponent(sha)}`, projectId),
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, ...projectHeader(projectId) },
          signal: controller.signal,
        },
      );
      if (response.ok) return await response.text();
      if (response.status !== 503) throw new PdfRemoteError(response.status);
      const retry = response.headers.get('Retry-After');
      const seconds = retry === null ? NaN : Number(retry);
      const wait = Number.isFinite(seconds)
        ? Math.max(0, seconds * 1000)
        : Math.max(0, (Date.parse(retry ?? '') || Date.now() + 5000) - Date.now());
      if (Date.now() + wait >= deadline) throw new DOMException('GROBID timed out', 'TimeoutError');
      await delay(wait, controller.signal);
    }
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}
