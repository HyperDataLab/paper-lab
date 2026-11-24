import { Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ExtractionProject } from '@/core/schemas';
import { Button } from '@/shared/ui/Button';
import { Select } from '@/shared/ui/Select';
import { Loading } from '@/shared/ui/StateNote';
import { researchDesignSections } from './sections';
import { ResearchDesignProvider } from './ResearchDesignProvider';
import { SectionBody } from './SectionBody';
import styles from './researchDesignArea.module.css';

const groups = [
  { label: 'Định hình nghiên cứu', ids: ['topic', 'questions'] },
  { label: 'Phương pháp', ids: ['design', 'measurement', 'analyses'] },
  { label: 'Phân tích và đầu ra', ids: ['bank', 'runs', 'evidence', 'package'] },
] as const;

export function ResearchDesignArea({ project }: { project: ExtractionProject }) {
  const [params, setParams] = useSearchParams();
  const selected =
    researchDesignSections.find((section) => section.id === params.get('design')) ??
    researchDesignSections[0];
  const Section = selected.component;
  const select = (id: string) => {
    const next = new URLSearchParams(params);
    next.set('design', id);
    next.set('workspace', 'design');
    setParams(next);
  };

  return (
    <ResearchDesignProvider project={project}>
      <section className={styles.area} aria-label="Research Design">
        <div className={styles.mobilePicker}>
          <Select label="Mục nghiên cứu" value={selected.id} onChange={(event) => select(event.target.value)}>
            {groups.flatMap((group) =>
              researchDesignSections
                .filter((section) => (group.ids as readonly string[]).includes(section.id))
                .map((section) => (
                  <option key={section.id} value={section.id}>
                    {group.label} · {section.label}
                  </option>
                )),
            )}
          </Select>
        </div>
        <nav className={styles.sectionNav} aria-label="Các mục Research Design">
          {groups.map((group) => (
            <div className={styles.navGroup} key={group.label}>
              <h2>{group.label}</h2>
              {researchDesignSections
                .filter((section) => (group.ids as readonly string[]).includes(section.id))
                .map((section) => (
                  <Button
                    key={section.id}
                    type="button"
                    variant="ghost"
                    className={styles.navItem}
                    data-active={section.id === selected.id}
                    aria-current={section.id === selected.id ? 'page' : undefined}
                    onClick={() => select(section.id)}
                  >
                    {section.label}
                  </Button>
                ))}
            </div>
          ))}
        </nav>
        <main className={styles.sectionPanel} aria-labelledby="research-section-title">
          <header className={styles.sectionHeader}>
            <h2 id="research-section-title">{selected.label}</h2>
            <p>{selected.description}</p>
          </header>
          <Suspense fallback={<Loading label="Đang mở mục nghiên cứu…" />}>
            <SectionBody section={Section} sectionId={selected.id} />
          </Suspense>
        </main>
      </section>
    </ResearchDesignProvider>
  );
}
