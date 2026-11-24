import { lazy, Suspense, useState, type KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ExtractionProject } from '@/core/schemas';
import type { SearchDraft } from './DeepResearch';
import { ResearchDesignArea, ResearchDesignProvider } from '@/modules/researchDesign';
import { Button } from '@/shared/ui/Button';
import { Loading } from '@/shared/ui/StateNote';
import { DeepResearch } from './DeepResearch';
import styles from './extraction.module.css';

const AutoResearch = lazy(() => import('@/modules/autoresearch'));

export function ProjectResearch({
  project,
  onSave,
  onDraftChange,
}: {
  project: ExtractionProject;
  onSave: (next: ExtractionProject) => Promise<void>;
  onDraftChange?: () => void;
}) {
  const [params, setParams] = useSearchParams();
  const activeTab =
    params.get('workspace') === 'auto' || (!params.has('workspace') && params.has('ar')) ? 'auto' : 'design';
  const legacyRunLink = /^S(?:[1-9]|1[0-2])$/u.test(params.get('ar') ?? '');
  const activeAutoView =
    params.get('autoView') === 'run' || (!params.has('autoView') && legacyRunLink) ? 'run' : 'search';
  const defaultDraft: SearchDraft = {
    question: project.researchQuestion,
    queries: project.deep?.plan?.queries.join('\n') ?? '',
    inclusion: project.deep?.plan?.inclusion.join('\n') ?? '',
    exclusion: project.deep?.plan?.exclusion.join('\n') ?? '',
    fromYear: project.deep?.plan?.fromYear ? String(project.deep.plan.fromYear) : '',
    toYear: project.deep?.plan?.toYear ? String(project.deep.plan.toYear) : '',
  };
  const [draftState, setDraftState] = useState<{ projectId: string; value: SearchDraft } | null>(null);
  const draft = draftState?.projectId === project.id ? draftState.value : defaultDraft;
  const [visitedDesign, setVisitedDesign] = useState(activeTab === 'design' || params.has('design'));
  const [visitedAuto, setVisitedAuto] = useState(activeTab === 'auto');
  const showDesign = visitedDesign || activeTab === 'design' || params.has('design');
  const updateParams = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    setParams(next);
  };
  const selectTab = (tab: 'design' | 'auto') => {
    if (tab === 'design') setVisitedDesign(true);
    if (tab === 'auto') setVisitedAuto(true);
    updateParams({ workspace: tab });
  };
  const selectAutoView = (view: 'search' | 'run') => updateParams({ autoView: view });
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const tabs = Array.from(
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [],
    );
    const index = tabs.indexOf(event.currentTarget);
    const nextIndex =
      event.key === 'ArrowRight'
        ? (index + 1) % tabs.length
        : event.key === 'ArrowLeft'
          ? (index + tabs.length - 1) % tabs.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? tabs.length - 1
              : -1;
    if (nextIndex < 0) return;
    event.preventDefault();
    const nextTab = tabs[nextIndex];
    nextTab?.focus();
    selectTab(nextIndex === 0 ? 'design' : 'auto');
  };

  return (
    <div className={styles.projectResearch}>
      <nav className={styles.projectTabs} role="tablist" aria-label="Không gian project">
        <Button
          role="tab"
          tabIndex={activeTab === 'design' ? 0 : -1}
          aria-selected={activeTab === 'design'}
          aria-controls="project-design-panel"
          onKeyDown={onTabKeyDown}
          onClick={() => selectTab('design')}
        >
          Research Design
        </Button>
        <Button
          role="tab"
          tabIndex={activeTab === 'auto' ? 0 : -1}
          aria-selected={activeTab === 'auto'}
          aria-controls="project-auto-panel"
          onKeyDown={onTabKeyDown}
          onClick={() => selectTab('auto')}
        >
          AutoResearch
        </Button>
      </nav>

      <div
        id="project-design-panel"
        role="tabpanel"
        className={styles.projectTabPanel}
        hidden={activeTab !== 'design'}
      >
        {showDesign && <ResearchDesignArea project={project} />}
      </div>
      <section
        id="project-auto-panel"
        role="tabpanel"
        className={styles.projectTabPanel}
        hidden={activeTab !== 'auto'}
      >
        {visitedAuto && (
          <>
            <div className={styles.autoModes} role="tablist" aria-label="Công cụ AutoResearch">
              <Button
                role="tab"
                aria-selected={activeAutoView === 'search'}
                onClick={() => selectAutoView('search')}
              >
                Tìm bài và tổng hợp
              </Button>
              <Button
                role="tab"
                aria-selected={activeAutoView === 'run'}
                onClick={() => selectAutoView('run')}
              >
                Pipeline nghiên cứu
              </Button>
            </div>
            {activeAutoView === 'search' ? (
              <DeepResearch
                key={project.id}
                project={project}
                onSave={onSave}
                draft={draft}
                onDraftChange={(value) => {
                  setDraftState({ projectId: project.id, value });
                  onDraftChange?.();
                }}
              />
            ) : (
              <ResearchDesignProvider project={project}>
                <Suspense fallback={<Loading label="Đang mở pipeline AutoResearch…" />}>
                  <AutoResearch key={project.id} project={project} />
                </Suspense>
              </ResearchDesignProvider>
            )}
          </>
        )}
      </section>
    </div>
  );
}
