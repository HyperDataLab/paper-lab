import { ArrowLeft } from 'lucide-react';
import { useState, type RefObject } from 'react';
import type { Finding, Paper, PaperChecksRecord } from '@/core/schemas';
import type { FindingInputs } from '@/core/paperFindings';
import type { Criterion } from './criteria';
import { Button } from '@/shared/ui/Button';
import { Tabs } from '@/shared/ui/Tabs';
import { ArgumentsSpace } from './ArgumentsSpace';
import { FindingsList } from './FindingsList';
import { IssuesBlock, type IssuesKit } from './IssuesBlock';
import { ModeTab } from './ModeTab';
import { OrphanedChecks } from './OrphanedChecks';
import { PaperBlock, type BlockKit } from './PaperBlock';
import { PaperContribution } from './PaperContribution';
import { PaperScg } from './PaperScg';
import { PaperExtraction } from './PaperExtraction';
import { PaperMetadata } from './PaperMetadata';
import { PaperOpenKg } from './PaperOpenKg';
import { MODES, SPACES, type ViewId } from './paperPlaces';
import { PaperReferences } from './PaperReferences';
import { SpaceOverview } from './SpaceOverview';
import type { useBatchRun } from './useBatchRun';
import type { PaperNavigation } from './usePaperNavigation';
import { WritingSpace } from './WritingSpace';
import styles from './page.module.css';

const CITATION_CRITERIA: Criterion[] = ['context'];

/**
 * The right column: the tab the reader has open (Issues, Citations, Paper info), or, full width, one of the
 * spaces behind the paper.
 */
export function AnalysisColumn({
  nav,
  columnRef,
  paper,
  kit,
  issues,
  focusFinding,
  batch,
  checks,
  stored,
  onLocation,
  onFilter,
  inDrawer = false,
}: {
  nav: PaperNavigation;
  columnRef: RefObject<HTMLElement | null>;
  paper: Paper;
  kit: BlockKit;
  issues: IssuesKit;
  /** A finding opened from its mark on the paper. */
  focusFinding: string | null;
  batch: ReturnType<typeof useBatchRun>;
  checks?: PaperChecksRecord;
  stored: Pick<FindingInputs, 'insights' | 'measurements'>;
  onLocation: (location: Finding['locations'][number]) => void;
  onFilter: (ids: string[]) => void;
  inDrawer?: boolean;
}) {
  const { mode, inSpace, wide } = nav;
  // Keep visited reader tabs mounted so their filters, fetched context, and expanded rows survive tab switches.
  const [tabHistory, setTabHistory] = useState(() => ({ mode, visited: new Set([mode]) }));
  if (tabHistory.mode !== mode) {
    setTabHistory({ mode, visited: new Set([...tabHistory.visited, mode]) });
  }
  const keepIssues = mode === 'issues' || tabHistory.visited.has('issues');
  const keepCitations = mode === 'citations' || tabHistory.visited.has('citations');
  return (
    <section
      ref={columnRef}
      className={wide && !inDrawer ? styles.column : undefined}
      aria-label={inSpace ? (SPACES.find((item) => item.id === mode)?.label ?? 'Space') : 'Analysis'}
      hidden={inDrawer ? false : wide ? !nav.showRight : nav.focus !== 'right'}
    >
      {inSpace ? (
        <div className={styles.spaceHead}>
          <Button
            variant="ghost"
            size="sm"
            leadingIcon={<ArrowLeft size={16} aria-hidden="true" />}
            onClick={nav.leaveSpace}
          >
            Quay lại bài
          </Button>
          <span className={styles.spaceDivider} aria-hidden="true" />
          <h2>{SPACES.find((item) => item.id === mode)?.label}</h2>
        </div>
      ) : (
        <>
          {(wide || inDrawer) && (
            <div className={styles.columnTabs}>
              <Tabs label="Analysis">
                {MODES.map((item) => (
                  <ModeTab key={item.id} item={item} nav={nav} />
                ))}
              </Tabs>
            </div>
          )}
        </>
      )}
      <div hidden={mode !== 'issues'} className={styles.blocks}>
        {/* Kept mounted after first visit so filters and expanded issue rows persist across tabs. */}
        {keepIssues && (
          <>
            <OrphanedChecks record={checks} />
            <FindingsList
              paper={paper}
              findings={issues.findings}
              focusId={focusFinding}
              onLocation={onLocation}
              onOpenSource={(view) => issues.onOpenSource(view as ViewId)}
              onDecide={issues.onDecide}
              onRunChecks={issues.onRunChecks}
            />
          </>
        )}
      </div>
      <div hidden={mode !== 'citations'} className={styles.blocks}>
        <IssuesBlock
          id="citationIssues"
          only={CITATION_CRITERIA}
          visible={keepCitations}
          kit={kit}
          issues={issues}
          idPrefix="citation-"
        />
        <PaperBlock id="references" kit={kit}>
          {keepCitations && kit.openBlocks.includes('references') && (
            <PaperReferences paper={paper} onLocation={onLocation} />
          )}
        </PaperBlock>
        {keepCitations && (
          <SpaceOverview
            paper={paper}
            analyses={batch.analyses}
            checks={checks}
            jobFacts={kit.jobFacts}
            onOpen={nav.setTab}
            only={['context']}
            label="Context overview"
          />
        )}
      </div>
      <div hidden={mode !== 'info'} className={styles.blocks}>
        <PaperBlock id="metadata" kit={kit}>
          {mode === 'info' && kit.openBlocks.includes('metadata') && <PaperMetadata paper={paper} />}
        </PaperBlock>
      </div>
      {mode === 'extract' && <PaperExtraction paper={paper} />}
      {mode === 'data' && <PaperContribution paper={paper} onLocation={onLocation} />}
      {mode === 'data' && <PaperScg paper={paper} onLocation={onLocation} />}
      {mode === 'openkg' && <PaperOpenKg key={paper.id} paper={paper} onLocation={onLocation} />}
      <ArgumentsSpace
        active={mode === 'arguments'}
        paper={paper}
        kit={kit}
        issues={issues}
        analyses={batch.analyses}
        checks={checks}
        insights={stored.insights}
        measurements={stored.measurements}
        shown={nav.shown}
        onLocation={onLocation}
        onOpen={nav.setTab}
      />
      <WritingSpace
        active={mode === 'writing'}
        paper={paper}
        kit={kit}
        issues={issues}
        batch={batch}
        checks={checks}
        shown={nav.shown}
        onLocation={onLocation}
        onOpen={nav.setTab}
        onFilter={onFilter}
      />
    </section>
  );
}
