import { parseGrobidTei } from '@/core/grobid/parseTei';
import { runPaperChecks } from '@/core/paperChecks';
import { GROBID_VERSION, type GrobidRecord, type GrobidResult, type Paper } from '@/core/schemas';
import type { Repositories } from '@/shared/storage/repositories';
import { fetchGrobidTei } from './grobid';
import { paperSha, PdfRemoteError } from './index';

/** Why GROBID cannot be used for a paper before anything is sent, or null when it can be asked. */
export function grobidBlocker(paper: Pick<Paper, 'source'>, signedIn: boolean): string | null {
  if (paper.source.kind !== 'pdf' || !paperSha(paper)) return 'bài không được nhập từ tệp PDF';
  if (!signedIn) return 'chưa đăng nhập tài khoản lab';
  return null;
}

function reasonOf(cause: unknown): string {
  if (cause instanceof PdfRemoteError)
    return cause.status === 404 ? 'ResearchHub chưa có PDF của bài này' : cause.message.replace(/\.$/u, '');
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
 * sent to ResearchHub first when only this browser has it, since the Worker reads it from there.
 */
export async function requestGrobid(
  repo: Repositories,
  paper: Paper,
  projectId: string,
  getIdToken: () => Promise<string | null>,
  signal?: AbortSignal,
  replace = false,
): Promise<GrobidRecord> {
  const sha = paperSha(paper) ?? '';
  const previous = await repo.grobid.get(paper.id);
  const good = previous?.sha256 === sha && previous.status === 'ready' && previous.result ? previous : null;
  const record = (fields: Pick<GrobidRecord, 'status' | 'error' | 'result'>): GrobidRecord => ({
    schemaVersion: 3,
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
    const result = parseGrobidTei(await fetchGrobidTei(sha, projectId, token, signal));
    if (good && !replace) {
      const old = good.result;
      const fewer = (next: number, before: number) => before >= 2 && next < before / 2;
      if (
        !result.bodyPresent ||
        (old &&
          (fewer(result.references.length, old.references.length) ||
            fewer(result.citations.length, old.citations.length)))
      ) {
        return repo.grobid.save({
          ...good,
          lastFailedAttempt: {
            at: new Date().toISOString(),
            reason: 'Kết quả mới thiếu nội dung hoặc có ít tài liệu, trích dẫn hơn nhiều',
          },
        });
      }
    }
    return await store(record({ status: 'ready', error: null, result }));
  } catch (cause) {
    if (signal?.aborted) throw cause;
    const failed = record({ status: 'failed', error: reasonOf(cause), result: null });
    if (good)
      return repo.grobid.save({
        ...good,
        lastFailedAttempt: { at: failed.fetchedAt, reason: failed.error ?? 'Không rõ lý do' },
      });
    // A lapsed session is not stored, so the request is made again on its own after signing in.
    if (cause instanceof PdfRemoteError && cause.status === 401) return failed;
    return store(failed);
  }
}
