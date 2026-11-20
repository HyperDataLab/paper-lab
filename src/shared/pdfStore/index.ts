import type { Paper } from '@/core/schemas';

/** The lab's PDF worker. Not a secret: it refuses every request without a lab account's token. */
export const PDF_WORKER_URL: string =
  (import.meta.env.VITE_PDF_WORKER_URL as string | undefined) ||
  'https://paperlab-pdf-worker.hyperdatalab.workers.dev';

/** The hex digest a paper was imported with, or null for papers that did not come from a file. */
export const paperSha = (paper: Pick<Paper, 'source'>) => {
  const match = /^sha256:([0-9a-f]{64})$/.exec(paper.source.sha256);
  return match ? (match[1] as string) : null;
};
export async function sha256Hex(data: ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export class PdfRemoteError extends Error {
  constructor(public status: number) {
    super(
      status === 401
        ? 'Phiên đăng nhập đã hết hạn.'
        : status === 403
          ? 'Tài khoản này không được dùng kho PDF của lab.'
          : `Kho PDF của lab trả lỗi ${status}.`,
    );
  }
}

const url = (sha: string) => `${PDF_WORKER_URL}/pdfs/${sha}`;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Reads and writes the lab's copy. Every call needs a lab account's ID token. */
export const pdfRemote = {
  async download(sha: string, token: string, signal?: AbortSignal): Promise<Blob | null> {
    const response = await fetch(url(sha), {
      headers: auth(token),
      cache: 'no-store',
      ...(signal && { signal }),
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new PdfRemoteError(response.status);
    return response.blob();
  },
  async upload(sha: string, blob: Blob, token: string): Promise<void> {
    const response = await fetch(url(sha), {
      method: 'PUT',
      headers: { ...auth(token), 'Content-Type': 'application/pdf' },
      body: blob,
    });
    if (!response.ok) throw new PdfRemoteError(response.status);
    rememberPdf(sha, blob);
  },
};

/** PDFs read from or sent to the lab in this tab, newest last. Nothing is kept once the tab closes. */
const SESSION_PDFS = 8;
const sessionPdfs = new Map<string, Blob>();
function rememberPdf(sha: string, blob: Blob) {
  sessionPdfs.delete(sha);
  sessionPdfs.set(sha, blob);
  for (const oldest of sessionPdfs.keys()) {
    if (sessionPdfs.size <= SESSION_PDFS) break;
    sessionPdfs.delete(oldest);
  }
}

/** The paper's PDF from this tab's memory, else from the lab's storage; null when the lab has no copy. */
export async function loadPdf(sha: string, token: string): Promise<Blob | null> {
  const cached = sessionPdfs.get(sha);
  if (cached) return cached;
  const blob = await pdfRemote.download(sha, token);
  if (blob) rememberPdf(sha, blob);
  return blob;
}

/** Test hook: forgets the PDFs held for this tab. */
export function clearSessionPdfs() {
  sessionPdfs.clear();
}
