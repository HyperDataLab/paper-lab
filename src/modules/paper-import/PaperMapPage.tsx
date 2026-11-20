import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { paperIdentity } from '@/core/paperIdentity';
import { type Paper, type Section, type Finding, type PaperMetadata as Metadata } from '@/core/schemas';
import { mergeGrobidMetadata, usableGrobid } from '@/core/grobid/merge';
import { runPaperChecks } from '@/core/paperChecks';
import type { FindingStatus, PaperFinding, PaperMark } from '@/core/paperFindings';
import { analyzeText } from '@/core/text';
import { detectCandidates } from '@/core/detectors';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { Button } from '@/shared/ui/Button';
import { Tabs } from '@/shared/ui/Tabs';
import { Drawer } from '@/shared/ui/Drawer';
import { captureCalibration } from '@/shared/calibration/data';
import { Loading } from '@/shared/ui/StateNote';
import { AnalysisColumn } from './AnalysisColumn';
import type { Criterion } from './criteria';
import { decideFinding } from './decideFinding';
import { EvidencePanel } from './EvidencePanel';
import { FindingsList } from './FindingsList';
import { GrobidContext } from './grobidContext';
import type { IssuesKit } from './IssuesBlock';
import { JobProgress } from './JobProgress';
import { lookupPaperMetadata } from './lookupPaperMetadata';
import { ModeTab } from './ModeTab';
import { PaneTab } from './PaneTab';
import type { BlockKit } from './PaperBlock';
import { PaperColumn } from './PaperColumn';
import { PaperFind } from './PaperFind';
import { PaperHeader } from './PaperHeader';
import { JobsContext, StoredChangedContext, type JobId } from './paperJobs';
import { PaperMetadata } from './PaperMetadata';
import { BLOCKS, BLOCK_IDS, JOBS, JOB_IDS, MODES, PANES, type ViewId } from './paperPlaces';
import { pdfMarks, pdfNeedle } from './pdfMarks';
import type { PdfTarget } from './PdfViewer';
import { useBatchRun } from './useBatchRun';
import { useGrobid } from './useGrobid';
import { useJobReports } from './useJobReports';
import { usePaperFindings } from './usePaperFindings';
import { usePaperNavigation } from './usePaperNavigation';
import pdfStyles from './pdf.module.css';
import styles from './page.module.css';

function BatchWorkspace({
  paper,
  children,
}: {
  paper: Paper;
  children: (batch: ReturnType<typeof useBatchRun>) => ReactNode;
}) {
  const batch = useBatchRun(paper);
  return <>{children(batch)}</>;
}

export default function PaperMapPage() {
  const { id } = useParams();
  const [query] = useSearchParams();
  const repo = useRepositories();
  const { rightColumn, centreColumn, ...nav } = usePaperNavigation();
  const { pane, mode, wide, splitWanted, setTab, toggleSplit, focusFulltext } = nav;
  const [paper, setPaper] = useState<Paper | null>(null);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [counts, setCounts] = useState<{ sentences: number; words: number } | null>(null);
  const [candidateCounts, setCandidateCounts] = useState<Record<string, number>>({});
  const { jobs, jobFacts, reportJob } = useJobReports();
  const [runProgress, setRunProgress] = useState<import('./paperJobs').RunProgress | null>(null);
  const linkP = query.get('p');
  const linkS = query.get('s');
  const linkE = query.get('e');
  const [evidence, setEvidence] = useState<Finding['locations'][number] | null>(null);
  const [filter, setFilter] = useState<string[] | null>(null);
  const [highlight, setHighlight] = useState<Finding['locations'][number] | null>(null);
  const [shownTitle, setShownTitle] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const metadataLookups = useRef(new Map<string, ReturnType<typeof lookupPaperMetadata>>());
  const [infoOpen, setInfoOpen] = useState(false);
  const [layers, setLayers] = useState<Criterion[]>(['claim', 'evidence', 'context']);
  const [focusFinding, setFocusFinding] = useState<string | null>(null);
  const [markDrawer, setMarkDrawer] = useState<string | null>(null);
  const [pdfTarget, setPdfTarget] = useState<PdfTarget | null>(null);
  const { checks, setChecks, stored, findings, marks, notifyStoredChanged } = usePaperFindings({
    id,
    paper,
    doneJobs: JOB_IDS.filter((job) => jobFacts[job]?.done).join(','),
    place: `${pane}:${mode}`,
    onError: setError,
  });
  // Asked in the background once the paper is open; the parsed text is used alone until (or unless) it arrives.
  const grobid = useGrobid(paper, notifyStoredChanged);
  const shownMetadata = useMemo(
    () => (paper ? mergeGrobidMetadata(metadata, grobid.record, paper).metadata : metadata),
    [paper, metadata, grobid.record],
  );
  // The same marks on the PDF, limited to the layers that are switched on.
  const marksOnPdf = useMemo(
    () =>
      paper
        ? pdfMarks(
            paper,
            marks.filter((mark) => layers.includes(mark.criterion)),
            (mark) => mark.label,
          )
        : [],
    [paper, marks, layers],
  );
  useEffect(() => {
    if (pane === 'fulltext' && highlight)
      document
        .getElementById(`paper-paragraph-${highlight.paragraphId}`)
        ?.scrollIntoView?.({ block: 'center' });
  }, [pane, selected, highlight]);
  useEffect(() => {
    let active = true;
    if (!id) return;
    void repo.papers
      .get(id)
      .then((value) => {
        if (!active) return;
        setPaper(value ?? null);
        if (value)
          void repo.paperContext
            .get(value.id)
            .then(async (context) => {
              if (!context?.metadata) {
                let lookup = metadataLookups.current.get(value.id);
                if (!lookup) {
                  lookup = lookupPaperMetadata(value, context, (record) =>
                    repo.paperContext.save(record),
                  ).catch(() => context);
                  metadataLookups.current.set(value.id, lookup);
                }
                context = await lookup;
              }
              if (active) {
                setShownTitle(paperIdentity(value, { metadata: context?.metadata }).title);
                setMetadata(context?.metadata ?? null);
              }
            })
            .catch(() => undefined);
        // A link from a grounded citation (?p=&s=&e=) opens the reader on that passage.
        const linked = value?.paragraphs.find((item) => item.id === linkP);
        const start = Number(linkS);
        const end = Number(linkE);
        setSelected(linked?.sectionId ?? value?.sections[0]?.id ?? '');
        if (linked) {
          const whole = !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start;
          setHighlight({
            paragraphId: linked.id,
            start: whole ? 0 : start,
            end: whole ? Math.max(1, Array.from(linked.text).length) : end,
          });
          focusFulltext();
        }
        setLoading(false);
        if (value)
          void Promise.all(
            value.paragraphs
              .filter((p) => p.kind === 'body')
              .map(async (p) => ({ id: p.id, text: await analyzeText(p.text) })),
          )
            .then((analyses) => {
              if (active) {
                setCounts({
                  sentences: analyses.reduce((n, a) => n + a.text.sentences.length, 0),
                  words: analyses.reduce(
                    (n, a) => n + a.text.tokens.filter((t) => t.kind === 'word').length,
                    0,
                  ),
                });
                setCandidateCounts(
                  Object.fromEntries(analyses.map((a) => [a.id, detectCandidates(a.text, null).length])),
                );
              }
            })
            .catch((cause: unknown) => {
              if (active) setError(String(cause));
            });
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(String(cause));
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [id, repo, linkP, linkS, linkE, focusFulltext]);
  async function editRole(role: Section['role']) {
    if (!paper) return;
    try {
      setPaper(await repo.papers.editRole(paper.id, selected, role));
    } catch (cause) {
      setError(String(cause));
    }
  }
  if (loading) return <Loading label="Đang tải bài báo…" />;
  if (!paper)
    return (
      <div>
        <p role="alert">Không tìm thấy bài báo.</p>
        <Link to="/papers">Quay lại danh sách</Link>
        {error && (
          <details>
            <summary>Chi tiết kỹ thuật</summary>
            {error}
          </details>
        )}
      </div>
    );
  const showPage = (page: number | null | undefined) => {
    if (page) setPdfTarget((old) => ({ page, nonce: (old?.nonce ?? 0) + 1 }));
  };
  /** In the PDF the passage's page is shown; the exact words are highlighted in Text. */
  const showPassage = (paragraph: Paper['paragraphs'][number], location: Finding['locations'][number]) => {
    const page = paragraph.pageStart;
    const passage = pdfNeedle(paper, location, '__selected');
    if (page) setPdfTarget((old) => ({ page, nonce: (old?.nonce ?? 0) + 1, passage }));
  };
  const openInReader = (location: Finding['locations'][number]) => {
    const paragraph = paper.paragraphs.find((item) => item.id === location.paragraphId);
    if (!paragraph) return;
    setFilter(null);
    setSelected(paragraph.sectionId);
    setHighlight(location);
    setEvidence(null);
    showPassage(paragraph, location);
    nav.enterReader();
  };
  const openLocation = (location: Finding['locations'][number]) => {
    const paragraph = paper.paragraphs.find((item) => item.id === location.paragraphId);
    if (!paragraph) return setEvidence(location);
    if (nav.inSpace) return setEvidence(location);
    setFilter(null);
    setSelected(paragraph.sectionId);
    setHighlight(location);
    if (!nav.centreVisible && !wide) {
      nav.setPanelPreference(false);
      nav.focusFulltext();
    }
    nav.showFulltext();
    showPassage(paragraph, location);
  };
  const backButton = nav.returnTo && (
    <Button size="sm" variant="ghost" className={pdfStyles.back} onClick={nav.goBack}>
      ← Quay lại {nav.returnTo.label}
    </Button>
  );
  const find = (
    <PaperFind
      paper={paper}
      onGo={openLocation}
      onSection={(sectionId) => {
        const first = paper.paragraphs.find(
          (paragraph) => paragraph.sectionId === sectionId && paragraph.pageStart,
        );
        setSelected(sectionId);
        showPage(first?.pageStart ?? paper.sections.find((section) => section.id === sectionId)?.pageStart);
      }}
    />
  );
  const runChecks = () => {
    void captureCalibration(repo)
      .then((calibrationSnapshot) =>
        repo.paperChecks.save({
          schemaVersion: 1,
          paperId: paper.id,
          report: runPaperChecks(paper, new Date(), usableGrobid(grobid.record)),
          decisions: [],
          calibrationSnapshot,
        }),
      )
      .then(setChecks)
      .catch((cause: unknown) => setError(String(cause)));
  };
  const decide = (finding: PaperFinding, status: FindingStatus) => {
    void decideFinding(repo, paper.id, finding, status, setChecks)
      ?.then(notifyStoredChanged)
      .catch((cause: unknown) => setError(String(cause)));
  };
  /** A mark on the paper opens the finding it stands for, or the block that described it. */
  const openMark = (mark: PaperMark) => {
    if (!mark.findingId) return setTab(mark.view as ViewId);
    if (!wide) {
      setMarkDrawer(mark.findingId);
      return;
    }
    setFocusFinding(mark.findingId);
    setTab('issues');
    // With the analysis hidden the finding would open out of sight: show the column again.
    if (!splitWanted) toggleSplit();
  };
  const kit: BlockKit = {
    jobFacts,
    openBlocks: nav.openBlocks,
    viewOf: nav.viewOf,
    sectionLabel: (sectionId) =>
      paper.sections.find((section) => section.id === sectionId)?.heading ?? sectionId,
    onView: setTab,
    onToggle: nav.toggleBlock,
    onStart: (block, job) => {
      nav.openBlock(block);
      void jobs.current[job]?.start?.();
    },
    onRunSection: (job, sectionId) => {
      const block = BLOCK_IDS.find((id) => BLOCKS[id].job === job);
      if (block) nav.openBlock(block);
      void jobs.current[job]?.sectionRun?.start(sectionId);
    },
  };
  const issues: IssuesKit = {
    paper,
    findings,
    onLocation: openLocation,
    onOpenSource: setTab,
    onDecide: decide,
    onRunChecks: runChecks,
  };
  const jobLabels = Object.fromEntries(JOB_IDS.map((job) => [job, JOBS[job].label])) as Record<JobId, string>;
  const runningJobs = JOB_IDS.filter((job) => jobFacts[job]?.running);
  const analysisOpen = wide ? nav.showRight : nav.focus === 'right' && !nav.inSpace;
  const pdfReader = pane === 'fulltext' && paper.source.kind === 'pdf';
  const toggleAnalysis = () => {
    if (wide) nav.toggleSplit();
    else if (analysisOpen) {
      nav.setPanelPreference(false);
      nav.focusFulltext();
    } else {
      nav.setPanelPreference(true);
      nav.openMode(mode === 'citations' ? 'citations' : 'issues');
    }
  };
  const progressChip = (
    <JobProgress
      running={runningJobs.map((job) => JOBS[job].label)}
      sequence={runProgress}
      count={findings.length}
      onOpen={() => {
        setTab('issues');
        if (wide && !splitWanted) toggleSplit();
      }}
    />
  );
  const errorBox = (title: string) =>
    error && (
      <div role="alert">
        {title}
        <details>
          <summary>Chi tiết kỹ thuật</summary>
          {error}
        </details>
      </div>
    );
  return (
    <GrobidContext.Provider value={grobid}>
      <div className={`${styles.page} ${styles.paperPage}`}>
        <PaperHeader
          nav={nav}
          paper={paper}
          title={
            shownMetadata?.title && shownMetadata.title !== metadata?.title
              ? paperIdentity(paper, { metadata: shownMetadata }).title
              : shownTitle
          }
          metadata={shownMetadata}
          counts={counts}
          findings={findings}
          onInfo={() => setInfoOpen(true)}
        />
        <Drawer
          open={infoOpen}
          onClose={() => {
            setInfoOpen(false);
            void repo.paperContext.get(paper.id).then((context) => setMetadata(context?.metadata ?? null));
          }}
          side="right"
          label="Thông tin bài báo"
          title="Thông tin bài báo"
        >
          {infoOpen && <PaperMetadata paper={paper} />}
        </Drawer>
        <Drawer
          open={markDrawer !== null}
          onClose={() => setMarkDrawer(null)}
          side="right"
          label="Issue"
          title="Issue"
        >
          {markDrawer && (
            <FindingsList
              paper={paper}
              findings={findings.filter((finding) => finding.id === markDrawer)}
              focusId={markDrawer}
              onLocation={(location) => {
                setMarkDrawer(null);
                openLocation(location);
              }}
              onOpenSource={(view) => {
                setMarkDrawer(null);
                setTab(view as ViewId);
              }}
              onDecide={decide}
            />
          )}
        </Drawer>
        <StoredChangedContext.Provider value={notifyStoredChanged}>
          <BatchWorkspace paper={paper}>
            {(batch) => (
              <JobsContext.Provider value={reportJob}>
                {!wide && (
                  <div className={styles.paperTabs}>
                    <Tabs label="Bài báo">
                      {PANES.map((item) => (
                        <PaneTab key={item.id} item={item} nav={nav} />
                      ))}
                      {progressChip}
                      <span className={styles.tabDivider} aria-hidden="true" />
                      {MODES.map((item) => (
                        <ModeTab key={item.id} item={item} nav={nav} />
                      ))}
                    </Tabs>
                  </div>
                )}
                <EvidencePanel
                  paper={paper}
                  location={evidence}
                  onClose={() => setEvidence(null)}
                  onOpenReader={openInReader}
                />
                <div
                  className={`${wide && nav.showRight && !nav.inSpace && nav.centreVisible ? styles.workspace : styles.workspaceSingle} ${pdfReader ? styles.pdfWorkspace : ''}`}
                >
                  <PaperColumn
                    nav={nav}
                    columnRef={centreColumn}
                    paper={paper}
                    progressChip={progressChip}
                    issueCount={findings.length}
                    analysisOpen={analysisOpen}
                    onToggleAnalysis={toggleAnalysis}
                    keepReaderVisible={!wide && analysisOpen}
                    runAll={{
                      jobs,
                      facts: jobFacts,
                      labels: jobLabels,
                      onProgress: setRunProgress,
                      onPrepare: nav.prepareAll,
                      onOpen: (job) => {
                        if (job === 'digest') setTab('profile');
                        else if (job === 'arguments') nav.openSpace('arguments');
                        else if (job === 'batch') nav.openSpace('writing');
                        else setTab(JOBS[job].views[0] ?? 'profile');
                      },
                      onRunChecks: () => {
                        if (!checks) runChecks();
                      },
                    }}
                    error={errorBox('Không thể xử lý bài báo.')}
                    pdf={{
                      target: pdfTarget,
                      marks: marksOnPdf,
                      onMark: (id) => {
                        const mark = marks.find((item) => item.id === id);
                        if (mark) openMark(mark);
                      },
                      back: backButton,
                      find,
                    }}
                    reader={{
                      paper,
                      selected,
                      onSelect: setSelected,
                      filter,
                      onClearFilter: () => setFilter(null),
                      highlight,
                      candidateCounts,
                      batch,
                      onEditRole: (role) => void editRole(role),
                      marks,
                      layers,
                      onLayers: setLayers,
                      onMark: openMark,
                    }}
                    onLocation={openLocation}
                    onDigestStart={() => {
                      if (!jobFacts.snapshot?.done) void jobs.current.snapshot?.start?.();
                    }}
                  />
                  {wide || nav.inSpace ? <AnalysisColumn
                    nav={nav}
                    columnRef={rightColumn}
                    paper={paper}
                    kit={kit}
                    issues={issues}
                    focusFinding={focusFinding}
                    batch={batch}
                    checks={checks}
                    stored={stored}
                    onLocation={openLocation}
                    onFilter={(ids) => {
                      setFilter(ids);
                      const first = paper.paragraphs.find((paragraph) => ids.includes(paragraph.id));
                      if (first) setSelected(first.sectionId);
                      showPage(first?.pageStart);
                      setTab('map');
                    }}
                  /> : (
                    <Drawer
                      open={analysisOpen}
                      onClose={() => {
                        nav.setPanelPreference(false);
                        nav.focusFulltext();
                      }}
                      side="right"
                      size="lg"
                      label="Vấn đề và trích dẫn"
                      title="Vấn đề và trích dẫn"
                    >
                      <AnalysisColumn
                        nav={nav}
                        columnRef={rightColumn}
                        paper={paper}
                        kit={kit}
                        issues={issues}
                        focusFinding={focusFinding}
                        batch={batch}
                        checks={checks}
                        stored={stored}
                        onLocation={openLocation}
                        onFilter={(ids) => {
                          setFilter(ids);
                          const first = paper.paragraphs.find((paragraph) => ids.includes(paragraph.id));
                          if (first) setSelected(first.sectionId);
                          showPage(first?.pageStart);
                          setTab('map');
                        }}
                        inDrawer
                      />
                    </Drawer>
                  )}
                </div>
              </JobsContext.Provider>
            )}
          </BatchWorkspace>
        </StoredChangedContext.Provider>
      </div>
    </GrobidContext.Provider>
  );
}
