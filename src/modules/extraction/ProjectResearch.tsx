import { lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ExtractionProject } from '@/core/schemas';
import { ResearchDesignArea, ResearchDesignProvider } from '@/modules/researchDesign';
import { Button } from '@/shared/ui/Button';
import { Loading } from '@/shared/ui/StateNote';

const AutoResearch = lazy(() => import('@/modules/autoresearch'));

export function ProjectResearch({ project }: { project: ExtractionProject }) {
  const [params, setParams] = useSearchParams();
  const showAutoResearch = params.has('ar');
  const select = (auto: boolean) => {
    const next = new URLSearchParams(params);
    if (auto) next.set('ar', 'S1');
    else next.delete('ar');
    setParams(next);
  };
  return (
    <>
      <nav aria-label="Không gian nghiên cứu">
        <Button aria-pressed={!showAutoResearch} variant="ghost" onClick={() => select(false)}>
          Research design
        </Button>
        <Button aria-pressed={showAutoResearch} variant="ghost" onClick={() => select(true)}>
          AutoResearch
        </Button>
      </nav>
      {showAutoResearch ? (
        <ResearchDesignProvider project={project}>
          <Suspense fallback={<Loading label="Đang mở AutoResearch…" />}>
            <AutoResearch key={project.id} project={project} />
          </Suspense>
        </ResearchDesignProvider>
      ) : (
        <ResearchDesignArea project={project} />
      )}
    </>
  );
}
