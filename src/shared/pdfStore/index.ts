import type { Paper } from '@/core/schemas';

/** PaperLab's PDF proxy to the ResearchHub Files API; every request needs a user access token. */
export const PDF_WORKER_URL: string =
  (import.meta.env.VITE_PDF_WORKER_URL as string | undefined) ||
  (import.meta.env.DEV ? '/paperlab-worker' : 'https://paperlab-pdf-worker.hyperdatalab.workers.dev');

/** The hex digest a paper was imported with, or null for papers that did not come from a file. */
export const paperSha = (paper: Pick<Paper, 'source'>) => {
  const match = /^sha256:([0-9a-f]{64})$/.exec(paper.source.sha256);
  return match ? (match[1] as string) : null;
};
export async function sha256Hex(data: ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** PDF bytes live in the active ResearchHub project; there is no browser-wide PDF cache to clear. */
export const clearSessionPdfs = () => undefined;

export class PdfRemoteError extends Error {
  constructor(public status: number, detail?: string) {
    const message =
      status === 401
        ? 'Phiên đăng nhập đã hết hạn.'
        : status === 403
          ? 'Tài khoản này không được dùng kho tài liệu ResearchHub.'
          : `ResearchHub trả lỗi ${status}.`;
    super(detail ? `${message} ${detail}` : message);
  }
}

async function uploadErrorDetail(response: Response) {
  const value: unknown = await response.json().catch(() => null);
  return value && typeof value === 'object' && 'detail' in value && typeof value.detail === 'string'
    ? value.detail
    : undefined;
}

const url = (sha: string) => `${PDF_WORKER_URL}/pdfs/${sha}`;
const auth = (token: string, projectId: string) => ({
  Authorization: `Bearer ${token}`,
  'X-Project-Id': projectId,
});

/** Reads and writes the ResearchHub copy through the PaperLab Worker. */
export const pdfRemote = {
  async exists(sha: string, projectId: string, token: string): Promise<boolean> {
    const response = await fetch(url(sha), { method: 'HEAD', headers: auth(token, projectId) });
    if (response.status === 404) return false;
    if (!response.ok) throw new PdfRemoteError(response.status);
    return true;
  },
  async download(sha: string, projectId: string, token: string, signal?: AbortSignal): Promise<Blob | null> {
    const response = await fetch(url(sha), { headers: auth(token, projectId), signal });
    if (response.status === 404) return null;
    if (!response.ok) throw new PdfRemoteError(response.status);
    return response.blob();
  },
  async upload(sha: string, projectId: string, fileName: string, blob: Blob, token: string): Promise<void> {
    const response = await fetch(url(sha), {
      method: 'PUT',
      headers: {
        ...auth(token, projectId),
        'Content-Type': 'application/pdf',
        'X-File-Name': encodeURIComponent(fileName),
      },
      body: blob,
    });
    if (!response.ok) throw new PdfRemoteError(response.status, await uploadErrorDetail(response));
  },
};
