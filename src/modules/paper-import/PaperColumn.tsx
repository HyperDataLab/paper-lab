import type { ComponentProps, ReactNode, RefObject } from 'react';
import type { Finding, Paper } from '@/core/schemas';
import { Tabs } from '@/shared/ui/Tabs';
import { PaneTab } from './PaneTab';
import { PaperDigest } from './PaperDigest';
import { PaperPdf } from './PaperPdf';
import { PANES } from './paperPlaces';
import { PaperReader } from './PaperReader';
import { PaperSnapshot } from './PaperSnapshot';
import { RunAllCard } from './RunAllCard';
import type { PaperNavigation } from './usePaperNavigation';
import styles from './page.module.css';

/** The centre column: the paper itself, as its PDF or parsed text, or its summary. */
export function PaperColumn({
  nav,
  columnRef,
  paper,
  progressChip,
  runAll,
  error,
  pdf,
  reader,
  onLocation,
  onDigestStart,
}: {
  nav: PaperNavigation;
  columnRef: RefObject<HTMLElement | null>;
  paper: Paper;
  /** What is running, beside the column's tabs. */
  progressChip: ReactNode;
  runAll: Omit<ComponentProps<typeof RunAllCard>, 'compact'>;
  /** Why the paper could not be processed, if it could not. */
  error: ReactNode;
  pdf: Pick<ComponentProps<typeof PaperPdf>, 'target' | 'marks' | 'onMark' | 'back' | 'find'>;
  reader: Omit<ComponentProps<typeof PaperReader>, 'outlineOpen'>;
  onLocation: (location: Finding['locations'][number]) => void;
  /** The summary was asked for: the key facts are written with it. */
  onDigestStart: () => void;
}) {
  const { wide, pane } = nav;
  const fullText = <PaperReader {...reader} outlineOpen={!(wide && nav.showRight)} />;
  return (
    <section
      ref={columnRef}
      className={wide ? styles.column : undefined}
      aria-label="Paper"
      hidden={nav.inSpace || !nav.centreVisible}
    >
      {wide && (
        <div className={styles.columnTabs}>
          <Tabs label="Paper">
            {PANES.map((item) => (
              <PaneTab key={item.id} item={item} nav={nav} />
            ))}
          </Tabs>
          {progressChip}
          <RunAllCard compact {...runAll} />
        </div>
      )}
      {!wide && <RunAllCard compact {...runAll} />}
      {pane === 'fulltext' && error}
      {/* A PDF paper is read as its PDF; the parsed text is only shown when the PDF is not here. */}
      {pane === 'fulltext' && paper.source.kind === 'pdf' && (
        <PaperPdf paper={paper} {...pdf} fallback={fullText} />
      )}
      {pane === 'fulltext' && paper.source.kind !== 'pdf' && pdf.back}
      {pane === 'fulltext' && paper.source.kind !== 'pdf' && fullText}

      <div hidden={pane !== 'summary'} className={styles.blocks}>
        {/* A reader's summary written by AI from the whole paper, with one button to make it. */}
        {nav.shown('snapshot') && <PaperSnapshot compact paper={paper} onLocation={onLocation} />}
        {/* Kept mounted while another tab shows, so a summary being written is not lost. */}
        <PaperDigest paper={paper} onLocation={onLocation} onStart={onDigestStart} />
      </div>
    </section>
  );
}
