import type { Paper } from '@/core/schemas';
import { PAPER_PARSER_VERSION, segmentPaper } from '@/core/paper';
import { guardPaperSize } from '@/shared/paper/sizeGuard';
import { parseLatex } from '@/shared/paper/latexParser';
import { parseMarkdown, parsePlainText } from '@/shared/paper/markdownParser';
import type { Repositories } from '@/shared/storage/types';

/** Reads a file in the browser and stores it as a paper. The same file imported twice is one paper. */
export async function importPaperFile(
  file: File,
  repo: Repositories,
  options: { title?: string | null; onProgress?: (message: string) => void; reuseExisting?: boolean } = {},
): Promise<Paper> {
  guardPaperSize(file.size);
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext !== 'pdf' && ext !== 'tex' && ext !== 'md' && ext !== 'txt')
    throw new Error('Định dạng tệp không được hỗ trợ.');
  const data = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', data);
  const sha256 = `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  // The original file is kept here so the paper can be read as a PDF; it reaches the lab's storage only
  // when a lab account is signed in (see shared/pdfStore).
  if (ext === 'pdf')
    await repo.pdfFiles.put(sha256.slice('sha256:'.length), new Blob([data], { type: 'application/pdf' }));
  if (options.reuseExisting) {
    const existing = await repo.papers.findBySourceHash(sha256);
    if (existing) return existing;
  }
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
  const at = new Date().toISOString();
  return repo.papers.create({
    schemaVersion: 1,
    id: crypto.randomUUID(),
    title: options.title || file.name.replace(/\.[^.]+$/, ''),
    createdAt: at,
    updatedAt: at,
    source: {
      kind: ext === 'tex' ? 'latex' : ext === 'md' ? 'markdown' : ext === 'txt' ? 'text' : 'pdf',
      fileName: file.name,
      pageCount,
      sha256,
      parserVersion: PAPER_PARSER_VERSION,
    },
    ...parsed,
  });
}
