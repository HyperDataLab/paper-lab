import { parseGrobidTei } from '@/core/grobid/parseTei';
import { runPaperChecks } from '@/core/paperChecks';
import { GROBID_VERSION, type GrobidRecord, type GrobidResult, type Paper } from '@/core/schemas';
import type { Repositories } from '@/shared/storage/repositories';
import { fetchGrobidTei } from './grobid';
import { paperSha, pdfRemote, PdfRemoteError } from './index';

/** Why GROBID cannot be used for a paper before anything is sent, or null when it can be asked. */
export function grobidBlocker(paper: Pick<Paper, 'source'>, signedIn: boolean): string | null {
  if (paper.source.kind !== 'pdf' || !paperSha(paper)) return 'bài không được nhập từ tệp PDF';
  if (!signedIn) return 'chưa đăng nhập tài khoản lab';
  return null;
}

function reasonOf(cause: unknown): string {
  if (cause instanceof PdfRemoteError)
    return cause.status === 404 ? 'kho của lab chưa có PDF của bài này' : cause.message.replace(/\.$/u, '');
  if (cause instanceof DOMException && cause.name === 'TimeoutError')
    return 'GROBID không trả lời trong 3 phút';
  if (cause instanceof TypeError) return 'không kết nối được máy chủ GROBID';
  return 'kết quả GROBID không đọc được';
}

/**
 * Stored checks are run again so their citation findings follow what is now stored: GROBID's links, or the
 * text patterns again when a refetch failed. Decisions are kept.
 */
async function refreshChecks(repo: Repositories, paperId: string, grobid: GrobidResult | null) {
  const [paper, current] = await Promise.all([repo.papers.get(paperId), repo.paperChecks.get(paperId)]);
  if (!paper || !current) return;
  await repo.paperChecks.save({ ...current, report: runPaperChecks(paper, new Date(), grobid) });
}

/**
 * Asks the lab's GROBID for the paper's structure and stores the result, or the reason it failed. The PDF is
 * sent to the lab's storage first when only this browser has it, since the worker reads it from there.
 */
export async function requestGrobid(
  repo: Repositories,
  paper: Paper,
  getIdToken: () => Promise<string | null>,
  signal?: AbortSignal,
): Promise<GrobidRecord> {
  const sha = paperSha(paper) ?? '';
  const record = (fields: Pick<GrobidRecord, 'status' | 'error' | 'result'>): GrobidRecord => ({
    schemaVersion: 1,
    paperId: paper.id,
    sha256: sha,
    version: GROBID_VERSION,
    fetchedAt: new Date().toISOString(),
    ...fields,
  });
  const store = async (value: GrobidRecord) => {
    const saved = await repo.grobid.save(value);
    // If this fails the earlier checks stay until the reader runs them again; the stored record is kept.
    await refreshChecks(repo, paper.id, saved.result).catch(() => undefined);
    return saved;
  };
  try {
    const token = await getIdToken();
    if (!token) throw new PdfRemoteError(401);
    const local = await repo.pdfFiles.get(sha);
    if (local && !local.uploaded) {
      await pdfRemote.upload(sha, local.blob, token);
      await repo.pdfFiles.markUploaded(sha);
    }
    const result = parseGrobidTei(await fetchGrobidTei(sha, token, signal));
    return await store(record({ status: 'ready', error: null, result }));
  } catch (cause) {
    if (signal?.aborted) throw cause;
    const failed = record({ status: 'failed', error: reasonOf(cause), result: null });
    // A lapsed session is not stored, so the request is made again on its own after signing in.
    if (cause instanceof PdfRemoteError && cause.status === 401) return failed;
    return store(failed);
  }
}
