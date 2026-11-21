import type { CorpusMember } from '@/core/schemas/corpus';
import type { Paper } from '@/core/schemas';
import { createScholarClient } from '@/shared/scholar/client';
import { getScholarEmail } from '@/shared/scholar/settings';
import type { Repositories } from '@/shared/storage/types';
import { importPaperFile } from '@/modules/paper-import';
import { downloadOpenAlexPdf } from '@/shared/pdfStore/openAlexDownload';

export const doiPdfName = (doi: string) => `${doi.replace(/[^a-z0-9.-]+/giu, '_')}.pdf`;

export function retrievedMember(member: CorpusMember, paper: Paper): CorpusMember {
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
}

export async function acquireMember(
  member: CorpusMember,
  repo: Repositories,
  projectId: string,
  getIdToken: () => Promise<string | null>,
  signal?: AbortSignal,
  onImported?: (paper: Paper) => void,
): Promise<CorpusMember> {
  try {
    const doi = member.identifiers.doi;
    if (!doi) throw new Error('Thiếu DOI');
    const client = createScholarClient({ email: getScholarEmail() });
    const result = await client.lookupDoi(doi, signal);
    if (!result.found) throw new Error('Không tìm thấy bản mở');
    const { patch } = result;
    let file: File | undefined;
    const name = doiPdfName(doi);
    let failure = 'Không tìm thấy PDF mở';
    if (patch.arxiv_id) {
      try {
        file = await client.downloadArxivPdf(patch.arxiv_id, name, signal);
      } catch (cause) {
        if (signal?.aborted) throw cause;
        failure = String(cause);
      }
    }
    const pdfUrls = patch.oa_sources?.flatMap((source) => (source.pdf_url ? [source.pdf_url] : [])) ?? [];
    if (!file && patch.access === 'open' && pdfUrls.length > 0) {
      const token = await getIdToken();
      if (!token) throw new Error('Hãy đăng nhập tài khoản lab để tải PDF Open Access.');
      for (const pdfUrl of pdfUrls) {
        try {
          const data = await downloadOpenAlexPdf(doi, pdfUrl, token, projectId, signal);
          file = new File([data], name, { type: 'application/pdf' });
          break;
        } catch (cause) {
          if (signal?.aborted) throw cause;
          failure = cause instanceof Error ? cause.message : String(cause);
        }
      }
    }
    if (!file) throw new Error(failure);
    const paper = await importPaperFile(file, repo, {
      projectId,
      getIdToken,
      title: member.title ?? patch.title,
      reuseExisting: true,
    });
    try {
      onImported?.(paper);
    } catch {
      // Background processing must not change the outcome of importing the PDF.
    }
    return retrievedMember(member, paper);
  } catch (cause) {
    if (signal?.aborted) throw cause;
    return { ...member, retrieval: 'not_retrieved', retrievalReason: String(cause) };
  }
}
