import type { Paper } from '@/core/schemas';
import type { Repositories } from '@/shared/storage/repositories';

/** The lab's PDF worker. Not a secret: it refuses every request without a lab account's token. */
export const PDF_WORKER_URL: string =
  (import.meta.env.VITE_PDF_WORKER_URL as string | undefined) ||
  'https://paperlab-pdf-worker.fgrading.workers.dev';

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
  async download(sha: string, token: string): Promise<Blob | null> {
    const response = await fetch(url(sha), { headers: auth(token) });
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
  },
};

/** Sends every PDF kept here that the lab's storage does not have yet. Failures are left for next time. */
export async function syncPendingPdfs(repo: Repositories, getIdToken: () => Promise<string | null>) {
  const token = await getIdToken();
  if (!token) return 0;
  let sent = 0;
  for (const record of await repo.pdfFiles.pending()) {
    try {
      await pdfRemote.upload(record.sha256, record.blob, token);
      await repo.pdfFiles.markUploaded(record.sha256);
      sent += 1;
    } catch {
      /* kept locally; tried again on the next sync */
    }
  }
  return sent;
}
