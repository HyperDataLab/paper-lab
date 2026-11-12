import { useEffect, useState } from 'react';
import {
  addFields,
  addPapers,
  catalogField,
  FIELD_TEMPLATES,
  newProject,
  paperBibtex,
  paperRis,
  projectPaperFromPaper,
} from '@/core/extraction';
import { paperIdentity } from '@/core/paperIdentity';
import type { ExtractionProject, Paper, PaperMetadata } from '@/core/schemas';
import { ExtractionMatrix } from '@/modules/extraction';
import { downloadText } from '@/shared/calibration/download';
import type { Repositories } from '@/shared/storage/repositories';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { Loading } from '@/shared/ui/StateNote';

/**
 * The extraction table that belongs to a paper, made on first visit with this paper as its row and the default
 * template as its columns. A table from before that lost the paper's row gets it back.
 */
async function paperProject(repo: Repositories, paper: Paper, metadata: PaperMetadata | null) {
  const existing = await repo.extraction.forPaper(paper.id);
  const row = projectPaperFromPaper(paper, undefined, metadata);
  if (existing)
    return existing.papers.some((item) => item.key === row.key)
      ? existing
      : repo.extraction.save(addPapers(existing, [row]));
  const base = {
    ...newProject({
      id: crypto.randomUUID(),
      title: paperIdentity(paper, { metadata }).title,
      researchQuestion: '',
      now: new Date().toISOString(),
    }),
    paperId: paper.id,
  };
  const fields = (FIELD_TEMPLATES[0]?.keys ?? []).flatMap((key) => {
    const field = catalogField(key);
    return field ? [field] : [];
  });
  return repo.extraction.save(addFields(addPapers(base, [row]), fields));
}

/** The paper's Trích xuất tab: the extraction matrix for this paper alone, already chosen. */
export function PaperExtraction({ paper }: { paper: Paper }) {
  const repo = useRepositories();
  const [project, setProject] = useState<ExtractionProject | null>(null);
  const [metadata, setMetadata] = useState<PaperMetadata | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void repo.paperContext
      .get(paper.id)
      .then(async (context) => {
        const found = context?.metadata ?? null;
        const value = await paperProject(repo, paper, found);
        if (!active) return;
        setMetadata(found);
        setProject(value);
      })
      .catch((cause: unknown) => {
        if (active) setError(String(cause));
      });
    return () => {
      active = false;
    };
  }, [paper, repo]);
  if (error) return <p role="alert">Không mở được bảng trích xuất: {error}</p>;
  if (!project) return <Loading label="Đang mở bảng trích xuất…" />;
  const citation = {
    title: metadata?.title || paperIdentity(paper).title,
    authors: metadata?.authors ?? [],
    year: metadata?.year ?? null,
    venue: metadata?.venue ?? null,
    doi: metadata?.doi ?? null,
    volume: metadata?.volume ?? null,
    issue: metadata?.issue ?? null,
    pages: metadata?.pages ?? null,
  };
  return (
    <ExtractionMatrix
      project={project}
      papers={new Map([[paper.id, paper]])}
      paperKey={projectPaperFromPaper(paper, undefined, metadata).key}
      onChange={setProject}
      extraExports={[
        {
          label: 'RIS của bài này',
          onSelect: () =>
            downloadText('paper.ris', paperRis(citation), 'application/x-research-info-systems'),
        },
        {
          label: 'BibTeX của bài này',
          onSelect: () => downloadText('paper.bib', paperBibtex(citation), 'text/plain;charset=utf-8'),
        },
      ]}
    />
  );
}
