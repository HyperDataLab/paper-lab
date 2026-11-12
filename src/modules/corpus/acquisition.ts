import type { CorpusMember } from '@/core/schemas/corpus';
import { guardPaperSize } from '@/shared/paper/sizeGuard';
import { createScholarClient } from '@/shared/scholar/client';
import { getScholarEmail } from '@/shared/scholar/settings';
import type { Repositories } from '@/shared/storage/repositories';
import { importPaperFile } from '../paper-import/importPaperFile';

export async function acquireMember(
  member: CorpusMember,
  repo: Repositories,
  signal?: AbortSignal,
): Promise<CorpusMember> {
  try {
    const doi = member.identifiers.doi;
    if (!doi) throw new Error('Thiếu DOI');
    const client = createScholarClient({ email: getScholarEmail() });
    const result = await client.lookupDoi(doi, signal);
    if (!result.found) throw new Error('Không tìm thấy bản mở');
    const { patch } = result;
    let file: File | undefined;
    const name = `${doi.replace(/[^a-z0-9.-]+/giu, '_')}.pdf`;
    let failure = 'Không tìm thấy PDF mở';
    if (patch.arxiv_id) {
      try {
        file = await client.downloadArxivPdf(patch.arxiv_id, name, signal);
      } catch (cause) {
        if (signal?.aborted) throw cause;
        failure = String(cause);
      }
    }
    for (const source of patch.oa_sources ?? []) {
      if (file) break;
      if (!source.pdf_url || patch.access !== 'open') continue;
      try {
        const response = await fetch(source.pdf_url, { signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.arrayBuffer();
        guardPaperSize(data.byteLength);
        if (new TextDecoder().decode(data.slice(0, 5)) !== '%PDF-') throw new Error('Không phải PDF');
        file = new File([data], name, { type: 'application/pdf' });
      } catch (cause) {
        if (signal?.aborted) throw cause;
        failure = String(cause);
      }
    }
    if (!file) throw new Error(failure);
    const paper = await importPaperFile(file, repo, {
      title: member.title ?? patch.title,
      reuseExisting: true,
    });
    return {
      ...member,
      retrieval: 'retrieved',
      retrievalReason: undefined,
      textRead: 'FULL_TEXT',
      identifiers: {
        ...member.identifiers,
        paperIds: [...new Set([...member.identifiers.paperIds, paper.id])],
        sha256: [...new Set([...member.identifiers.sha256, paper.source.sha256])],
      },
    };
  } catch (cause) {
    if (signal?.aborted) throw cause;
    return { ...member, retrieval: 'not_retrieved', retrievalReason: String(cause) };
  }
}
