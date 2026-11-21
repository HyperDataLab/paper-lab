import { useEffect, useMemo, useState } from 'react';
import { normalizeDoi } from '@/core/library';
import {
  buildPaperKg,
  normalizeSciAtlasDoi,
  normalizeSciAtlasOpenAlexId,
  paperSciAtlasAnchors,
} from '@/core/openkg';
import { buildPaperModel } from '@/core/paperModel';
import type {
  ArgumentRun,
  Finding,
  LibraryItem,
  Paper,
  PaperContextRecord,
  ScgPaperRun,
} from '@/core/schemas';
import { paperDoi } from '@/core/scholarlyContext';
import { RelatedPapersPanel } from '@/shared/openkg/RelatedPapersPanel';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { Loading } from '@/shared/ui/StateNote';
import { OpenKgView } from './OpenKgView';

type Sources = {
  library?: LibraryItem;
  context?: PaperContextRecord;
  scgRun?: ScgPaperRun;
  argumentRun?: ArgumentRun;
  /** Structured reference titles from GROBID, the cleanest titles PaperLab has for SciAtlas. */
  referenceTitles: string[];
  /** DOIs and OpenAlex ids already in the Library, to mark SciAtlas results. */
  held: ReadonlySet<string>;
};

export function PaperOpenKg({
  paper,
  onLocation,
}: {
  paper: Paper;
  onLocation: (location: Finding['locations'][number]) => void;
}) {
  const repo = useRepositories();
  const [sources, setSources] = useState<Sources>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    void Promise.all([
      repo.library.list(),
      repo.paperContext.get(paper.id),
      repo.scg.get(paper.id),
      repo.paperInsights.get(paper.id),
      repo.grobid.get(paper.id),
    ])
      .then(([items, context, scgRun, insights, grobid]) => {
        if (!active) return;
        const doi = normalizeDoi(context?.metadata?.doi ?? context?.paperDoi ?? paperDoi(paper) ?? '');
        const library =
          items.find((item) => item.paper_id === paper.id) ?? items.find((item) => item.doi === doi);
        const held = new Set(
          items.flatMap((item) =>
            [normalizeSciAtlasDoi(item.doi), normalizeSciAtlasOpenAlexId(item.openalex_id)].filter(
              (id): id is string => Boolean(id),
            ),
          ),
        );
        setSources({
          library,
          context,
          scgRun,
          argumentRun: insights?.argumentRuns.at(-1),
          referenceTitles: (grobid?.result?.references ?? []).flatMap(({ title }) => (title ? [title] : [])),
          held,
        });
      })
      .catch((cause: unknown) => {
        if (active) setError(String(cause));
      });
    return () => {
      active = false;
    };
  }, [paper, repo]);
  const data = useMemo(() => {
    if (!sources) return null;
    const model = buildPaperModel({
      paper,
      metadata: sources.context?.metadata ?? null,
      now: new Date(paper.updatedAt),
    });
    const { library, scgRun, argumentRun } = sources;
    const kg = buildPaperKg({ paper, model, library, scgRun, argumentRun });
    return {
      kg,
      sentences: model.sentences,
      anchors: paperSciAtlasAnchors(kg, sources.referenceTitles),
    };
  }, [paper, sources]);

  if (error)
    return (
      <div>
        <p role="alert">Không đọc được dữ liệu của đồ thị tri thức.</p>
        <details>
          <summary>Chi tiết kỹ thuật</summary>
          {error}
        </details>
      </div>
    );
  if (!sources || !data) return <Loading label="Đang tải đồ thị tri thức…" />;

  const { held } = sources;
  return (
    <>
      <OpenKgView
        kg={data.kg}
        sentences={data.sentences}
        hasLookup={Boolean(sources.library?.openalex_id || sources.library?.keywords)}
        hasScg={Boolean(sources.scgRun)}
        hasArguments={Boolean(sources.argumentRun)}
        onLocation={onLocation}
      />
      <RelatedPapersPanel
        anchors={data.anchors}
        known={(result) =>
          (result.doi && held.has(result.doi)) || (result.openalexId && held.has(result.openalexId))
            ? 'Đã có trong Library'
            : undefined
        }
      />
    </>
  );
}
