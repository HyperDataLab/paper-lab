import type { Paper } from '@/core/schemas';
import { PAPER_PARSER_VERSION, segmentPaper } from '@/core/paper';
import { guardPaperSize } from '@/shared/paper/sizeGuard';
import { parseLatex } from '@/shared/paper/latexParser';
import { parseMarkdown, parsePlainText } from '@/shared/paper/markdownParser';
import type { Repositories } from '@/shared/storage/types';
import { pdfRemote, PdfRemoteError, sha256Hex } from '@/shared/pdfStore';

type ImportOptions = {
  projectId: string;
  getIdToken: () => Promise<string | null>;
  title?: string | null;
  onProgress?: (message: string) => void;
  reuseExisting?: boolean;
};

/** Reads a file in the browser and stores it as a paper. The same file imported twice is one paper. */
export function importPaperFile(file: File, repo: Repositories, options: ImportOptions): Promise<Paper> {
  return importFile(file, file.name, repo, options);
}

/** Imports a PDF copied to the lab bucket by another worker. Read it through PaperLab's own PDF worker. */
export async function importStoredPdf(
  { sha256, sizeBytes }: { sha256: string; sizeBytes: number },
  fileName: string,
  repo: Repositories,
  options: ImportOptions,
  signal?: AbortSignal,
): Promise<Paper> {
  guardPaperSize(sizeBytes);
  const token = await options.getIdToken();
  signal?.throwIfAborted();
  if (!token) throw new PdfRemoteError(401);
  const file = await pdfRemote.download(sha256, options.projectId, token, signal);
  if (!file) throw new Error('Chưa tìm thấy PDF trong kho lab.');
  if (file.size !== sizeBytes) throw new Error('Kích thước PDF trong kho lab không khớp.');
  return importFile(file, fileName, repo, options, { sha256, signal });
}

async function importFile(
  file: Blob,
  fileName: string,
  repo: Repositories,
  options: ImportOptions,
  storedPdf?: { sha256: string; signal?: AbortSignal },
): Promise<Paper> {
  guardPaperSize(file.size);
  const ext = fileName.split('.').pop()?.toLowerCase();
  if (ext !== 'pdf' && ext !== 'tex' && ext !== 'md' && ext !== 'txt')
    throw new Error('Định dạng tệp không được hỗ trợ.');
  const data = await file.arrayBuffer();
  const digest = await sha256Hex(data);
  if (storedPdf && storedPdf.sha256 !== digest)
    throw new Error('Mã SHA-256 của PDF trong kho lab không khớp.');
  const sha256 = `sha256:${digest}`;
  const existing = options.reuseExisting ? await repo.papers.findBySourceHash(sha256) : undefined;
  if (ext === 'pdf' && !storedPdf) {
    const token = await options.getIdToken();
    if (!token) throw new PdfRemoteError(401);
    options.onProgress?.('Đang lưu PDF vào kho lab…');
    await pdfRemote.upload(digest, options.projectId, fileName, file, token);
  }
  if (existing) return existing;
  let parsed: Awaited<ReturnType<typeof segmentPaper>>;
  let pageCount: number | null = null;
  if (ext === 'pdf') {
    const { extractPdfText } = await import('@/shared/paper/pdfParser');
    const extracted = await extractPdfText(data, (done, total) =>
      options.onProgress?.(`Đang xử lý trang ${done} / ${total}`),
    );
    pageCount = extracted.pageCount;
    parsed = await segmentPaper(extracted.lines);
  } else {
    const text = new TextDecoder().decode(data);
    parsed = await (ext === 'tex'
      ? parseLatex(text)
      : ext === 'md'
        ? parseMarkdown(text)
        : parsePlainText(text));
  }
  storedPdf?.signal?.throwIfAborted();
  const at = new Date().toISOString();
  return repo.papers.create({
    schemaVersion: 1,
    id: crypto.randomUUID(),
    title: options.title || fileName.replace(/\.[^.]+$/, ''),
    createdAt: at,
    updatedAt: at,
    source: {
      kind: ext === 'tex' ? 'latex' : ext === 'md' ? 'markdown' : ext === 'txt' ? 'text' : 'pdf',
      fileName,
      pageCount,
      sha256,
      parserVersion: PAPER_PARSER_VERSION,
    },
    ...parsed,
  });
}
