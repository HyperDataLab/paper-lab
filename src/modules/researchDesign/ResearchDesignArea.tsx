import { Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/shared/ui/Button';
import { Loading } from '@/shared/ui/StateNote';
import { Tabs } from '@/shared/ui/Tabs';
import { researchDesignSections } from './sections';
import type { ExtractionProject } from '@/core/schemas';
import { ResearchDesignProvider } from './ResearchDesignProvider';
import { SectionBody } from './SectionBody';

export function ResearchDesignArea({ project }: { project: ExtractionProject }) {
  const [params, setParams] = useSearchParams();
  const selected =
    researchDesignSections.find((section) => section.id === params.get('design')) ??
    researchDesignSections[0];
  const Section = selected.component;
  return (
    <ResearchDesignProvider project={project}>
      <section aria-labelledby="research-design-heading">
        <h2 id="research-design-heading">Thiết kế nghiên cứu</h2>
        <Tabs label="Thiết kế nghiên cứu">
          {researchDesignSections.map((section) => (
            <Button
              key={section.id}
              role="tab"
              id={`research-design-tab-${section.id}`}
              aria-selected={section.id === selected.id}
              aria-controls="research-design-panel"
              onClick={() => {
                const next = new URLSearchParams(params);
                next.set('design', section.id);
                setParams(next);
              }}
            >
              {section.label}
            </Button>
          ))}
        </Tabs>
        <div
          role="tabpanel"
          id="research-design-panel"
          aria-labelledby={`research-design-tab-${selected.id}`}
        >
          <p>{selected.description}</p>
          <Suspense fallback={<Loading label="Đang tải mục…" />}>
            <SectionBody section={Section} />
          </Suspense>
        </div>
      </section>
    </ResearchDesignProvider>
  );
}
