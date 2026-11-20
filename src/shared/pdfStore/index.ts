import type { Paper } from '@/core/schemas';
import type { Repositories } from '@/shared/storage/repositories';

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
  async download(sha: string, projectId: string, token: string): Promise<Blob | null> {
    const response = await fetch(url(sha), { headers: auth(token, projectId) });
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

/** Sends pending PDFs to ResearchHub for the active project; failures are left for the next sync. */
export async function syncPendingPdfs(
  repo: Repositories,
  projectId: string | null,
  getIdToken: () => Promise<string | null>,
) {
  if (!projectId) return 0;
  const token = await getIdToken();
  if (!token) return 0;
  const namesBySha = new Map(
    (await repo.papers.list()).map((paper) => [paperSha(paper), paper.source.fileName] as const),
  );
  let sent = 0;
  for (const record of await repo.pdfFiles.pending()) {
    try {
      await pdfRemote.upload(
        record.sha256,
        projectId,
        namesBySha.get(record.sha256) || `${record.sha256}.pdf`,
        record.blob,
        token,
      );
      await repo.pdfFiles.markUploaded(record.sha256);
      sent += 1;
    } catch {
      /* kept locally; tried again on the next sync */
    }
  }
  return sent;
}
