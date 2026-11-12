import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { paperIdentity } from '@/core/paperIdentity';
import {
  type Paper,
  type Section,
  type Finding,
  type PaperChecksRecord,
  type PaperMetadata as Metadata,
} from '@/core/schemas';
import { runPaperChecks } from '@/core/paperChecks';
import {
  collectFindings,
  collectMarks,
  type FindingInputs,
  type FindingStatus,
  type PaperFinding,
  type PaperMark,
} from '@/core/paperFindings';
import type { DimensionId, ProfileView } from '@/core/paperProfile';
import { analyzeText } from '@/core/text';
import { detectCandidates } from '@/core/detectors';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { Button } from '@/shared/ui/Button';
import { Tabs } from '@/shared/ui/Tabs';
import { EvidencePanel } from './EvidencePanel';
import { PaperArguments } from './PaperArguments';
import { PaperMetadata } from './PaperMetadata';
import { lookupPaperMetadata } from './lookupPaperMetadata';
import { PaperProfile } from './PaperProfile';
import { PaperSnapshot } from './PaperSnapshot';
import { PaperReferences } from './PaperReferences';
import { PaperRhetoric } from './PaperRhetoric';
import { PaperVocabulary } from './PaperVocabulary';
import { PaperProbe } from './PaperProbe';
import { PaperReader } from './PaperReader';
import { PaperAtomics } from './PaperAtomics';
import { PaperDigest } from './PaperDigest';
import { PaperFind } from './PaperFind';
import { PaperPdf } from './PaperPdf';
import pdfStyles from './pdf.module.css';
import { pdfMarks, pdfNeedle } from './pdfMarks';
import type { PdfTarget } from './PdfViewer';
import { PaperMeasurement } from './PaperMeasurement';
import { PaperStance } from './PaperStance';
import styles from './page.module.css';
import {
  JobsContext,
  StoredChangedContext,
  RUN_ALL,
  type JobFacts,
  type JobId,
  type JobReport,
  type JobReporter,
} from './paperJobs';
import { RunAllCard } from './RunAllCard';
import { JobProgress } from './JobProgress';
import { FindingsList } from './FindingsList';
import { PaperSummary } from './PaperSummary';
import { SectionBlock, type BlockStatus } from './SectionBlock';
import type { Criterion } from './criteria';
import { Drawer } from '@/shared/ui/Drawer';
import { BatchPanel } from './BatchPanel';
import { useBatchRun } from './useBatchRun';
import { PaperOverview } from './PaperOverview';
import { PaperReview } from './PaperReview';
import type { ReactNode } from 'react';
import { PaperDataViews } from './PaperDataViews';
import { Transparency } from '@/shared/report/Transparency';
import { captureCalibration } from '@/shared/calibration/data';
import { Loading } from '@/shared/ui/StateNote';

type ViewId =
  | 'data-table'
  | 'profile'
  | 'snapshot'
  | 'metadata'
  | 'map'
  | 'review'
  | 'gap'
  | 'main-claims'
  | 'atomics'
  | 'arguments-issues'
  | 'writing-issues'
  | 'citation-issues'
  | 'issues'
  | ProfileView;
/** The centre column holds the paper: its full text, or its summary. */
type Pane = 'fulltext' | 'summary';
/**
 * The right column holds what needs the reader's decision and what is known about the paper: Issues,
 * Citations and Paper info. Arguments and Writing style are spaces behind the paper: each opens full width.
 */
type Mode = 'issues' | 'citations' | 'info' | Space;
type Space = 'arguments' | 'writing' | 'data';
type Place = 'summary' | Mode;
type BlockId =
  | 'argIssues'
  | 'writingIssues'
  | 'citationIssues'
  | 'gap'
  | 'mainClaims'
  | 'atomics'
  | 'snapshot'
  | 'checks'
  | 'citationChecks'
  | 'argChecks'
  | 'review'
  | 'measure'
  | 'rhetoric'
  | 'arguments'
  | 'batch'
  | 'stance'
  | 'vocabulary'
  | 'references'
  | 'probe'
  | 'metadata';
/**
 * Every analysis is one block in one place: the paper's Summary in the centre column, a tab of the right
 * column, or one of the two spaces. Names are the scientific terms a researcher already uses; the help line under
 * each says, in Vietnamese, what the block answers. Every former view id still opens its block.
 */
const BLOCKS: Record<
  BlockId,
  {
    place: Place;
    title: string;
    criterion: Criterion;
    job?: JobId;
    views: { id: ViewId; label: string }[];
  }
> = {
  argIssues: {
    place: 'arguments',
    title: 'Issues',
    criterion: 'claim',
    views: [{ id: 'arguments-issues', label: 'Issues' }],
  },
  argChecks: {
    place: 'arguments',
    title: 'Automated checks',
    criterion: 'evidence',
    views: [{ id: 'science-checks', label: 'Numbers & claims' }],
  },
  gap: {
    place: 'arguments',
    title: 'Research gap & contribution',
    criterion: 'claim',
    views: [{ id: 'gap', label: 'Research gap & contribution' }],
  },
  mainClaims: {
    place: 'arguments',
    title: 'Claims & grounds',
    criterion: 'claim',
    views: [{ id: 'main-claims', label: 'Claims & grounds' }],
  },
  atomics: {
    place: 'arguments',
    title: 'Atomic sentences',
    criterion: 'evidence',
    views: [{ id: 'atomics', label: 'Atomic sentences' }],
  },
  snapshot: {
    place: 'summary',
    title: 'Key facts',
    criterion: 'evidence',
    job: 'snapshot',
    views: [{ id: 'snapshot', label: 'Key facts' }],
  },
  references: {
    place: 'citations',
    title: 'References',
    criterion: 'context',
    views: [{ id: 'context-references', label: 'References' }],
  },
  metadata: {
    place: 'info',
    title: 'Publication info',
    criterion: 'context',
    views: [{ id: 'metadata', label: 'Publication info' }],
  },
  arguments: {
    place: 'arguments',
    title: 'Claims & reasoning',
    criterion: 'claim',
    job: 'arguments',
    views: [
      { id: 'toulmin', label: 'Toulmin model' },
      { id: 'aif', label: 'AIF graph' },
    ],
  },
  measure: {
    place: 'arguments',
    title: 'Evidence & measurement',
    criterion: 'evidence',
    job: 'measure',
    views: [{ id: 'measure', label: 'Evidence & measurement' }],
  },
  rhetoric: {
    place: 'arguments',
    title: 'Validity & rhetorical moves',
    criterion: 'claim',
    job: 'rhetoric',
    views: [
      { id: 'reporting', label: 'Validity & data availability' },
      { id: 'moves', label: 'Rhetorical moves & abstract' },
    ],
  },
  writingIssues: {
    place: 'writing',
    title: 'Issues',
    criterion: 'writing',
    views: [{ id: 'writing-issues', label: 'Issues' }],
  },
  checks: {
    place: 'writing',
    title: 'Automated checks',
    criterion: 'writing',
    views: [
      { id: 'discourse-checks', label: 'Figures & tables' },
      { id: 'writing-checks', label: 'Acronyms & claim strength' },
    ],
  },
  batch: {
    place: 'writing',
    title: 'Coherence & sentences',
    criterion: 'writing',
    job: 'batch',
    views: [
      { id: 'organization', label: 'Paragraph structure & flow' },
      { id: 'language', label: 'Sentences & word choice' },
    ],
  },
  stance: {
    place: 'writing',
    title: 'Stance & engagement',
    criterion: 'writing',
    job: 'stance',
    views: [{ id: 'stance', label: 'Stance & engagement' }],
  },
  vocabulary: {
    place: 'writing',
    title: 'Vocabulary & phrases',
    criterion: 'writing',
    views: [{ id: 'vocabulary', label: 'Vocabulary & phrases' }],
  },
  probe: {
    place: 'writing',
    title: 'Score robustness',
    criterion: 'writing',
    job: 'probe',
    views: [{ id: 'probe', label: 'Score robustness' }],
  },
  citationIssues: {
    place: 'citations',
    title: 'Issues',
    criterion: 'context',
    views: [{ id: 'citation-issues', label: 'Issues' }],
  },
  citationChecks: {
    place: 'citations',
    title: 'Citation checks',
    criterion: 'context',
    views: [{ id: 'context-checks', label: 'Citations ↔ references' }],
  },
  review: {
    place: 'arguments',
    title: 'AI peer review',
    criterion: 'claim',
    job: 'review',
    views: [{ id: 'review', label: 'AI peer review' }],
  },
};
const BLOCK_IDS = Object.keys(BLOCKS) as BlockId[];
const blockOf = (view: ViewId) => BLOCK_IDS.find((id) => BLOCKS[id].views.some((item) => item.id === view));
/** Where a view opens: the centre column (full text or summary) or a tab of the right column. */
const placeOf = (view: ViewId): Pane | Mode => {
  if (view === 'data-table') return 'data';
  if (view === 'issues') return 'issues';
  if (view === 'map') return 'fulltext';
  if (view === 'profile') return 'summary';
  const block = blockOf(view);
  return block ? BLOCKS[block].place : 'summary';
};
const isPane = (place: Pane | Mode): place is Pane => place === 'fulltext' || place === 'summary';
const blocksIn = (place: Place) => BLOCK_IDS.filter((id) => BLOCKS[id].place === place);
const PANES: { id: Pane; label: string }[] = [
  { id: 'fulltext', label: 'Full text' },
  { id: 'summary', label: 'Summary' },
];
const MODES: { id: Mode; label: string }[] = [
  { id: 'issues', label: 'Issues' },
  { id: 'citations', label: 'Citations' },
];
const SPACES: { id: Space; label: string }[] = [
  { id: 'arguments', label: 'Arguments' },
  { id: 'writing', label: 'Writing style' },
  { id: 'data', label: 'Data table' },
];
const isSpace = (mode: Mode): mode is Space => mode === 'arguments' || mode === 'writing' || mode === 'data';
const DEFAULT_VIEW: Record<Mode, ViewId> = {
  data: 'data-table',
  arguments: 'gap',
  writing: 'organization',
  issues: 'issues',
  citations: 'context-references',
  info: 'metadata',
};
const VIEW_HELP: Record<ViewId, string> = {
  'data-table': 'Data table',
  issues: 'Mọi phát hiện về bài ở một chỗ.',
  'arguments-issues':
    'Phát hiện về luận điểm và bằng chứng của bài. Được chấp nhận mặc định; bác bỏ những gì không đúng.',
  'writing-issues': 'Phát hiện về cách viết của bài. Được chấp nhận mặc định; bác bỏ những gì không đúng.',
  'citation-issues':
    'Phát hiện về nguồn và trích dẫn của bài. Được chấp nhận mặc định; bác bỏ những gì không đúng.',
  gap: 'Tác giả nói lĩnh vực còn thiếu gì và bài này đóng góp gì, bằng chính câu trong bài.',
  'main-claims':
    'Các luận điểm chính, căn cứ (Grounds) và giới hạn tác giả tự nêu. Bản đầy đủ theo Toulmin ở Claims & reasoning.',
  atomics:
    'Bài được tách thành các câu nguyên tử: mỗi câu một ý kiểm được, có vai trò và câu gốc. Tách khi chạy Evidence & measurement.',
  snapshot: 'Bảy thông tin cốt lõi của nghiên cứu, mỗi giá trị kèm câu trích trong bài.',
  metadata: 'Thông tin xuất bản của bài từ OpenAlex hoặc Thư viện DOI.',
  toulmin:
    'Luận điểm của tác giả và các thành phần theo mô hình Toulmin. Mô tả cấu trúc, không kết luận đúng hay sai.',
  aif: 'Tiền đề dẫn tới kết luận qua bước suy luận nào, và bị phản bác ở đâu.',
  profile:
    'Mỗi chiều trả lời một câu hỏi riêng nên không có điểm tổng. Số có ghi “AI” là ứng viên từ mô hình, bạn có thể bác bỏ khi xem chi tiết.',
  map: 'Đọc bài theo mục lục, xem bảng và đoạn gốc.',
  measure:
    'Bài báo đo gì, bằng metric nào, dưới protocol nào, kết quả ra sao, và các câu nguyên tử làm căn cứ.',
  'science-checks': 'Đối chiếu tự động số liệu và khẳng định trong bài. Không dùng AI.',
  reporting:
    'Tác giả nêu giới hạn validity nào và có công bố dữ liệu, code không. Mô tả việc báo cáo, không kết luận bài đúng hay sai.',
  moves: 'Bài dẫn dắt người đọc thế nào (CARS, các bước ở phần Bàn luận) và Tóm tắt có khớp nội dung không.',
  organization: 'Cách đoạn văn được tổ chức và nối với nhau. Không phải điểm của bài báo.',
  'discourse-checks': 'Hình và bảng có được nhắc đến và đánh số đúng không. Không dùng AI.',
  language: 'Cấu trúc câu và lựa chọn từ theo từng mục. Không phải điểm của bài báo.',
  stance:
    'Cách tác giả thể hiện lập trường và tương tác với người đọc. Đây là số liệu mô tả, không phải điểm.',
  vocabulary: 'Từ vựng, cụm từ lặp lại và so sánh với các bài khác. Không dùng AI.',
  'writing-checks': 'Kiểm tra tự động chữ viết tắt và mức độ khẳng định. Không dùng AI.',
  probe: 'Đo xem điểm của AI có đổi khi chỉ đổi văn phong hay không.',
  'context-checks': 'Trích dẫn trong bài có tài liệu tham khảo tương ứng không. Không dùng AI.',
  'context-references': 'Độ mới của danh sách tài liệu và tình trạng rút bài. Không dùng AI.',
  review: 'Các góc nhìn phản biện của AI, kèm câu trích trong bài. Xuyên suốt các chiều.',
};

/** Where each AI analysis lives, and what it is called in the running-work strip. */
const JOBS: Record<JobId, { label: string; views: ViewId[] }> = {
  digest: { label: 'Tóm tắt', views: ['profile'] },
  snapshot: { label: 'Key facts', views: ['snapshot'] },
  measure: { label: 'Evidence & measurement', views: ['measure'] },
  rhetoric: { label: 'Validity & rhetorical moves', views: ['reporting', 'moves'] },
  arguments: { label: 'Claims & reasoning', views: ['toulmin', 'aif'] },
  batch: { label: 'Coherence & sentences', views: ['organization', 'language'] },
  stance: { label: 'Stance & engagement', views: ['stance'] },
  probe: { label: 'Score robustness', views: ['probe'] },
  review: { label: 'AI peer review', views: ['review'] },
};
const JOB_IDS = Object.keys(JOBS) as JobId[];
/** The analyses whose result is per section and can take a run of one section merged into it. */
const SECTION_JOBS: JobId[] = ['rhetoric', 'arguments', 'stance', 'batch'];
const isView = (value: string | null): value is ViewId => value !== null && value in VIEW_HELP;
/** The tab of the right column a view belongs to; a centre view leaves the right column on Issues. */
const modeOf = (view: ViewId): Mode => {
  const place = placeOf(view);
  return isPane(place) ? 'issues' : place;
};

const WIDE = '(min-width: 1024px)';
/** True on screens wide enough to show the paper and its analysis as two columns. */
function useWide() {
  const [wide, setWide] = useState(
    () => typeof window.matchMedia === 'function' && window.matchMedia(WIDE).matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(WIDE);
    const update = () => setWide(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return wide;
}
function readSplit() {
  try {
    return localStorage.getItem('paper-split') !== 'false';
  } catch {
    return true;
  }
}

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

/** How far a column, or the page when the column does not scroll, has been scrolled. */
function scrollOf(column: HTMLElement | null) {
  const element = column && column.scrollHeight > column.clientHeight ? column : document.scrollingElement;
  return element?.scrollTop ?? 0;
}
function setScroll(column: HTMLElement | null, top: number) {
  const element = column && column.scrollHeight > column.clientHeight ? column : document.scrollingElement;
  if (element) element.scrollTop = top;
}

export default function PaperMapPage() {
  const { id } = useParams();
  const [query, setQuery] = useSearchParams();
  const repo = useRepositories();
  const [paper, setPaper] = useState<Paper | null>(null);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [counts, setCounts] = useState<{ sentences: number; words: number } | null>(null);
  const [candidateCounts, setCandidateCounts] = useState<Record<string, number>>({});
  // The right column's view; the centre column's pane; and, on a narrow screen, which of the two shows.
  const initial = (() => {
    const view = query.get('view');
    return isView(view) ? view : null;
  })();
  const [tab, setTabState] = useState<ViewId>(() =>
    initial && !isPane(placeOf(initial)) ? initial : DEFAULT_VIEW.issues,
  );
  const [pane, setPaneState] = useState<Pane>(() => {
    const asked = query.get('pane');
    if (asked === 'fulltext' || asked === 'summary') return asked;
    const place = initial ? placeOf(initial) : 'fulltext';
    return isPane(place) ? place : 'fulltext';
  });
  const [focus, setFocus] = useState<'centre' | 'right'>(() =>
    initial && !isPane(placeOf(initial)) ? 'right' : 'centre',
  );
  // An AI panel stays mounted once opened, so its run keeps going while the reader looks elsewhere.
  const [opened, setOpened] = useState<JobId[]>(RUN_ALL);
  const [openBlocks, setOpenBlocks] = useState<BlockId[]>(() => {
    const first = initial && blockOf(initial);
    return first ? [first] : [];
  });
  const [blockView, setBlockView] = useState<Partial<Record<BlockId, ViewId>>>(() => {
    const first = initial && blockOf(initial);
    return first && initial ? { [first]: initial } : {};
  });
  const jobs = useRef<Partial<Record<JobId, JobReport>>>({});
  // Leaving a space returns to the tab of the right column the reader came from.
  const beforeSpace = useRef<ViewId>(DEFAULT_VIEW.issues);
  const rightColumn = useRef<HTMLElement>(null);
  const centreColumn = useRef<HTMLElement>(null);
  // Where the reader was before a source took them to the PDF, so one press brings them back there.
  const [returnTo, setReturnTo] = useState<{ view: ViewId; label: string; scroll: number } | null>(null);
  const [jobFacts, setJobFacts] = useState<Partial<Record<JobId, JobFacts>>>({});
  const [runProgress, setRunProgress] = useState<{ label: string; index: number; total: number } | null>(
    null,
  );
  const reportJob = useCallback<JobReporter>((jobId, report) => {
    if (report) jobs.current[jobId] = report;
    else delete jobs.current[jobId];
    setJobFacts((old) => {
      const before = old[jobId];
      if (!report) {
        if (!before) return old;
        const next = { ...old };
        delete next[jobId];
        return next;
      }
      if (
        before &&
        before.running === report.running &&
        before.done === report.done &&
        JSON.stringify(before.stale) === JSON.stringify(report.stale) &&
        before.estimate === report.estimate &&
        before.ready === report.ready &&
        before.startable === (report.start !== null) &&
        JSON.stringify(before.sections) === JSON.stringify(report.sectionRun?.sections ?? [])
      )
        return old;
      const { running, done, estimate, ready, stale } = report;
      return {
        ...old,
        [jobId]: {
          running,
          done,
          estimate,
          ready,
          stale,
          startable: report.start !== null,
          sections: report.sectionRun?.sections ?? [],
        },
      };
    });
  }, []);
  /** Opens a view in its column and records it in the address, so a reload or a shared link lands there. */
  const setTab = (view: ViewId) => {
    const place = placeOf(view);
    // Going anywhere but the paper ends the way back.
    if (view !== 'map') setReturnTo(null);
    if (!isPane(place) && isSpace(place) && !isSpace(modeOf(tab))) beforeSpace.current = tab;
    const block = blockOf(view);
    // Every analysis of the place being shown is mounted, so each row can say what a run would cost.
    // What is left keeps its panels too, so nothing running there is interrupted.
    const jobsOf = (target: Place) =>
      blocksIn(target)
        .map((id) => BLOCKS[id].job)
        .filter((job): job is JobId => job !== undefined);
    const kept = [...jobsOf(modeOf(tab)), ...(isPane(place) ? jobsOf('summary') : jobsOf(place))];
    setOpened((old) => [...new Set([...old, ...kept])]);
    if (isPane(place)) {
      setPaneState(place);
      setFocus('centre');
      // Choosing the paper leaves a space: the right column comes back as it was.
      if (isSpace(modeOf(tab))) setTabState(beforeSpace.current);
    } else {
      setTabState(view);
      setFocus('right');
    }
    if (block) {
      setOpenBlocks((old) => (old.includes(block) ? old : [...old, block]));
      setBlockView((old) => ({ ...old, [block]: view }));
      window.setTimeout(
        () => document.getElementById(`block-${block}`)?.scrollIntoView?.({ block: 'start' }),
        0,
      );
    }
    setQuery(
      (old) => {
        const next = new URLSearchParams(old);
        next.set('view', view);
        if (isPane(place)) next.set('pane', place);
        return next;
      },
      { replace: true },
    );
  };
  const linkP = query.get('p');
  const linkS = query.get('s');
  const linkE = query.get('e');
  const [evidence, setEvidence] = useState<Finding['locations'][number] | null>(null);
  const [filter, setFilter] = useState<string[] | null>(null);
  const [checks, setChecks] = useState<PaperChecksRecord>();
  const [highlight, setHighlight] = useState<Finding['locations'][number] | null>(null);
  const [shownTitle, setShownTitle] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const metadataLookups = useRef(new Map<string, ReturnType<typeof lookupPaperMetadata>>());
  const [infoOpen, setInfoOpen] = useState(false);
  // What the analyses have stored, read again whenever one of them finishes or a decision is made here.
  const [stored, setStored] = useState<Omit<FindingInputs, 'paper' | 'checks'>>({});
  const [storedTick, setStoredTick] = useState(0);
  const notifyStoredChanged = useCallback(() => setStoredTick((tick) => tick + 1), []);
  const [layers, setLayers] = useState<Criterion[]>(['claim', 'evidence', 'context']);
  const [focusFinding, setFocusFinding] = useState<string | null>(null);
  const [markDrawer, setMarkDrawer] = useState<string | null>(null);
  const [pdfTarget, setPdfTarget] = useState<PdfTarget | null>(null);
  const wide = useWide();
  const [splitWanted, setSplitWanted] = useState(readSplit);
  useEffect(() => {
    let active = true;
    if (id)
      void repo.paperChecks
        .get(id)
        .then(async (value) => {
          if (!active) return;
          if (value) return setChecks(value);
          // Nothing checked yet: the rule checks use no AI, so they run on their own when the paper opens.
          const stored = await repo.papers.get(id);
          if (!stored || !active) return;
          const saved = await repo.paperChecks.save({
            schemaVersion: 1,
            paperId: stored.id,
            report: runPaperChecks(stored),
            decisions: [],
            calibrationSnapshot: await captureCalibration(repo),
          });
          if (active) setChecks(saved);
        })
        .catch((cause: unknown) => {
          if (active) setError(String(cause));
        });
    return () => {
      active = false;
    };
  }, [id, repo, storedTick]);
  const doneJobs = JOB_IDS.filter((job) => jobFacts[job]?.done).join(',');
  const storedMode = `${pane}:${modeOf(tab)}`;
  useEffect(() => {
    let active = true;
    if (!id) return;
    void Promise.all([
      repo.paperReviews.get(id),
      repo.analyses.listByPaper(id),
      repo.paperOverviews.get(id),
      repo.measurements.get(id),
      repo.paperInsights.get(id),
      repo.stance.get(id),
    ])
      .then(([reviews, analyses, overview, measurements, insights, stance]) => {
        if (active) setStored({ reviews, analyses, overview, measurements, insights, stance });
      })
      .catch((cause: unknown) => {
        if (active) setError(String(cause));
      });
    return () => {
      active = false;
    };
    // Entering a mode re-reads too, so a decision made inside a block shows in the list and on the text.
  }, [id, repo, doneJobs, storedMode, storedTick]);
  const findings = useMemo(
    () => (paper ? collectFindings({ paper, checks, ...stored }) : []),
    [paper, checks, stored],
  );
  const marks = useMemo(
    () => (paper ? collectMarks({ paper, checks, ...stored }, findings) : []),
    [paper, checks, stored, findings],
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
          setPaneState('fulltext');
          setFocus('centre');
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
  }, [id, repo, linkP, linkS, linkE]);
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
  const bodyCount = paper.paragraphs.filter((item) => item.kind === 'body').length;
  const openInReader = (location: Finding['locations'][number]) => {
    const paragraph = paper.paragraphs.find((item) => item.id === location.paragraphId);
    if (!paragraph) return;
    setFilter(null);
    setSelected(paragraph.sectionId);
    setHighlight(location);
    setEvidence(null);
    const page = paragraph.pageStart;
    const passage = pdfNeedle(paper, location, '__selected');
    if (page) setPdfTarget((old) => ({ page, nonce: (old?.nonce ?? 0) + 1, passage }));
    const space = SPACES.find((item) => item.id === modeOf(tab));
    setTab('map');
    if (space) setReturnTo({ view: tab, label: space.label, scroll: scrollOf(rightColumn.current) });
    else if (pane === 'summary')
      setReturnTo({ view: 'profile', label: 'Summary', scroll: scrollOf(centreColumn.current) });
  };
  // The paper is the centre of the page: on a wide screen it is always beside the analysis, so a quote opens
  // there. On a narrow screen showing the analysis, the quote opens in a drawer to keep the reader's place.
  // A space takes the whole width; the paper's passages then open in the evidence drawer.
  const inSpace = isSpace(modeOf(tab));
  const showRight = !wide || splitWanted || inSpace;
  const centreVisible = !inSpace && (wide || focus === 'centre');
  const openLocation = (location: Finding['locations'][number]) => {
    const paragraph = paper.paragraphs.find((item) => item.id === location.paragraphId);
    if (!paragraph || !centreVisible) return setEvidence(location);
    setFilter(null);
    setSelected(paragraph.sectionId);
    setHighlight(location);
    if (pane === 'summary')
      setReturnTo({ view: 'profile', label: 'Summary', scroll: scrollOf(centreColumn.current) });
    setPaneState('fulltext');
    // In the PDF the passage's page is shown; the exact words are highlighted in Text.
    const page = paragraph.pageStart;
    const passage = pdfNeedle(paper, location, '__selected');
    if (page) setPdfTarget((old) => ({ page, nonce: (old?.nonce ?? 0) + 1, passage }));
  };
  /** Back to where the source was opened from, at the same scroll position. */
  const goBack = () => {
    if (!returnTo) return;
    const { view, scroll } = returnTo;
    setTab(view);
    const column = isSpace(modeOf(view)) ? rightColumn : centreColumn;
    // After the tab has shown and setTab's own scroll to its block.
    window.setTimeout(() => setScroll(wide ? column.current : null, scroll), 50);
  };
  const backButton = returnTo && (
    <Button size="sm" variant="ghost" className={pdfStyles.back} onClick={goBack}>
      ← Quay lại {returnTo.label}
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
        const page =
          first?.pageStart ?? paper.sections.find((section) => section.id === sectionId)?.pageStart;
        setSelected(sectionId);
        if (page) setPdfTarget((old) => ({ page, nonce: (old?.nonce ?? 0) + 1 }));
      }}
    />
  );
  const toggleSplit = () => {
    const next = !splitWanted;
    setSplitWanted(next);
    try {
      localStorage.setItem('paper-split', String(next));
    } catch {
      /* Storage may be unavailable. */
    }
  };
  const runChecks = () => {
    void captureCalibration(repo)
      .then((calibrationSnapshot) =>
        repo.paperChecks.save({
          schemaVersion: 1,
          paperId: paper.id,
          report: runPaperChecks(paper),
          decisions: [],
          calibrationSnapshot,
        }),
      )
      .then(setChecks)
      .catch((cause: unknown) => setError(String(cause)));
  };
  const viewOf = (id: BlockId) => blockView[id] ?? BLOCKS[id].views[0]?.id ?? 'profile';
  const decide = (finding: PaperFinding, status: FindingStatus) => {
    const next: 'candidate' | 'confirmed_by_human' | 'dismissed_by_human' =
      status === 'confirmed'
        ? 'confirmed_by_human'
        : status === 'dismissed'
          ? 'dismissed_by_human'
          : 'candidate';
    const itemId = finding.id.slice(finding.source.length + 1);
    const previousStatus = async (
      analysisId: string,
      issueId: string,
      transition: boolean,
    ): Promise<'candidate' | 'confirmed_by_model'> => {
      const { items } = await repo.audit.listByAnalysis(analysisId);
      const event = items.findLast((entry) => {
        if (entry.issueId !== issueId) return false;
        if (
          transition ? entry.action !== 'review_transition' : !['confirm', 'dismiss'].includes(entry.action)
        )
          return false;
        return (
          entry.before !== null &&
          typeof entry.before === 'object' &&
          'status' in entry.before &&
          (entry.before.status === 'candidate' || entry.before.status === 'confirmed_by_model')
        );
      });
      return event?.before &&
        typeof event.before === 'object' &&
        'status' in event.before &&
        event.before.status === 'confirmed_by_model'
        ? 'confirmed_by_model'
        : 'candidate';
    };
    let done: Promise<unknown>;
    if (finding.source === 'checks') done = repo.paperChecks.review(paper.id, itemId, next).then(setChecks);
    else if (finding.source === 'review') done = repo.paperReviews.review(paper.id, itemId, next);
    else if (finding.source === 'transition')
      done = (status === 'open' ? previousStatus(paper.id, itemId, true) : Promise.resolve(next)).then(
        (restored) => repo.paperOverviews.reviewTransition(paper.id, itemId, restored),
      );
    else if (finding.source === 'writing') {
      const separator = itemId.indexOf(':');
      const analysisId = itemId.slice(0, separator);
      const issueId = itemId.slice(separator + 1);
      done = (status === 'open' ? previousStatus(analysisId, issueId, false) : Promise.resolve(next)).then(
        (restored) => repo.analyses.reviewIssue(analysisId, issueId, { status: restored }),
      );
    } else if (finding.runId) {
      done = repo.measurements.decide(paper.id, {
        run_id: finding.runId,
        item_id: itemId,
        field: null,
        decision: status === 'confirmed' ? 'accept' : status === 'dismissed' ? 'reject' : 'reopen',
        previous_value: null,
        new_value: null,
        note: null,
      });
    } else return;
    void done
      .then(() => setStoredTick((tick) => tick + 1))
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
  const sectionLabel = (sectionId: string) =>
    paper.sections.find((section) => section.id === sectionId)?.heading ?? sectionId;
  const runSection = (job: JobId, sectionId: string) => {
    const block = BLOCK_IDS.find((id) => BLOCKS[id].job === job);
    if (block) setOpenBlocks((old) => (old.includes(block) ? old : [...old, block]));
    void jobs.current[job]?.sectionRun?.start(sectionId);
  };
  const jobLabels = Object.fromEntries(JOB_IDS.map((job) => [job, JOBS[job].label])) as Record<JobId, string>;
  const mode = modeOf(tab);
  // The findings table offers section runs, so the analyses that can do one are mounted there too.
  const shown = (job: JobId) =>
    opened.includes(job) ||
    blocksIn(mode).some((id) => BLOCKS[id].job === job) ||
    (pane === 'summary' && blocksIn('summary').some((id) => BLOCKS[id].job === job)) ||
    (mode === 'issues' && SECTION_JOBS.includes(job));
  const runningJobs = JOB_IDS.filter((job) => jobFacts[job]?.running);
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
  const toggleBlock = (id: BlockId) =>
    setOpenBlocks((old) => (old.includes(id) ? old.filter((item) => item !== id) : [...old, id]));
  /** One analysis as a folding block. `body` is rendered by the caller so kept panels stay mounted. */
  const block = (id: BlockId, body: ReactNode, title?: string) => {
    const def = BLOCKS[id];
    const fact = def.job ? jobFacts[def.job] : undefined;
    const status: BlockStatus | undefined = !def.job
      ? undefined
      : !fact?.ready
        ? 'loading'
        : fact.running
          ? 'running'
          : fact.done
            ? 'done'
            : 'todo';
    const job = def.job;
    return (
      <SectionBlock
        key={id}
        id={id}
        title={title ?? def.title}
        help={VIEW_HELP[viewOf(id)]}
        criterion={def.criterion}
        status={status}
        stale={fact?.stale}
        sectionRun={
          job && fact && !fact.running && fact.sections.length > 0
            ? {
                sections: fact.sections.map((choice) => ({ ...choice, label: sectionLabel(choice.id) })),
                onRun: (sectionId: string) => runSection(job, sectionId),
              }
            : undefined
        }
        estimate={fact?.estimate}
        onRun={
          job && (status === 'todo' || Boolean(fact?.stale)) && fact?.startable
            ? () => {
                setOpenBlocks((old) => (old.includes(id) ? old : [...old, id]));
                void jobs.current[job]?.start?.();
              }
            : undefined
        }
        open={openBlocks.includes(id)}
        onToggle={() => toggleBlock(id)}
        views={def.views}
        view={viewOf(id)}
        onView={(view) => setTab(view as ViewId)}
      >
        {body}
      </SectionBlock>
    );
  };
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
  const paneTab = (item: { id: Pane; label: string }) => (
    <Button
      key={item.id}
      role="tab"
      aria-selected={pane === item.id && (wide || focus === 'centre')}
      onClick={() => setTab(item.id === 'fulltext' ? 'map' : 'profile')}
    >
      {item.label}
    </Button>
  );
  const openSpace = (space: Space) => {
    // The parts that cost nothing are open on arrival.
    const free: BlockId[] = space === 'arguments' ? ['gap', 'mainClaims', 'atomics'] : ['vocabulary'];
    setOpenBlocks((old) => [...new Set<BlockId>([...old, ...free])]);
    const first = BLOCK_IDS.find((id) => BLOCKS[id].place === space);
    setTab((first && blockView[first]) ?? DEFAULT_VIEW[space]);
    // A space is entered at its top, where its overview is; after setTab's own scroll to the block.
    window.setTimeout(() => {
      const column = rightColumn.current;
      // On a wide screen the column scrolls on its own; on a narrow one the page does.
      if (wide) column?.scrollTo?.({ top: 0 });
      else column?.scrollIntoView?.({ block: 'start' });
    }, 0);
  };
  /** The findings of some criteria, as a folding block in the place that is about them. */
  const issuesBlock = (id: BlockId, only: Criterion[], visible: boolean) => {
    const checkViews: Partial<Record<BlockId, ViewId[]>> = {
      argIssues: ['science-checks'],
      writingIssues: ['discourse-checks', 'writing-checks'],
      citationIssues: ['context-checks'],
    };
    const own = findings.filter(
      (item) =>
        only.includes(item.criterion) ||
        (item.source === 'checks' && checkViews[id]?.includes(item.view as ViewId)),
    );
    return block(
      id,
      visible && openBlocks.includes(id) && (
        <FindingsList
          paper={paper}
          findings={own}
          only={only}
          focusId={null}
          onLocation={openLocation}
          onOpenSource={(view) => setTab(view as ViewId)}
          onDecide={decide}
          onRunChecks={runChecks}
        />
      ),
      `Issues (${own.length})`,
    );
  };
  /** The profile's dimensions that answer what a tab or space is about, read again when an analysis ends. */
  const overview = (only: DimensionId[], label: string, batch: ReturnType<typeof useBatchRun>) => (
    <PaperProfile
      key={JOB_IDS.filter((job) => jobFacts[job]?.done).join(',')}
      paper={paper}
      analyses={batch.analyses}
      checks={checks}
      onOpen={setTab}
      only={only}
      label={label}
    />
  );
  const modeTab = (item: { id: Mode; label: string }) => (
    <Button
      key={item.id}
      role="tab"
      aria-selected={mode === item.id && (wide || focus === 'right')}
      onClick={() => {
        // A tab reopens the view the reader last had in it; a tab with no blocks has just its own view.
        const first = BLOCK_IDS.find((id) => BLOCKS[id].place === item.id);
        setTab((first && blockView[first]) ?? DEFAULT_VIEW[item.id]);
        if (!splitWanted && wide) toggleSplit();
      }}
    >
      {item.label}
    </Button>
  );
  return (
    <div className={styles.page}>
      <header className={styles.paperHead}>
        <Link to="/papers">← Bài báo đã nhập</Link>
        <div className={styles.titleRow}>
          <h1>{shownTitle ?? paperIdentity(paper).title}</h1>
          <div className={styles.row}>
            {wide && (
              <Button size="sm" aria-pressed={!splitWanted} onClick={toggleSplit}>
                {splitWanted ? 'Ẩn phân tích' : 'Hiện phân tích'}
              </Button>
            )}
            <Transparency
              paper={paper}
              parserCounts={`${paper.source.pageCount ?? 'Không rõ'} trang · ${paper.sections.length} mục · ${bodyCount} đoạn nội dung${counts ? ` · ${counts.sentences} câu · ${counts.words} từ` : ''}`}
            />
            <Button size="sm" onClick={() => setInfoOpen(true)}>
              Thông tin xuất bản
            </Button>
          </div>
        </div>
        <p className={styles.paperMeta}>
          {[
            metadata?.authors[0] && `${metadata.authors[0]}${metadata.authors.length > 1 ? ' et al.' : ''}`,
            metadata?.venue,
            metadata?.year,
          ]
            .filter(Boolean)
            .join(' · ')}
          {metadata?.doi && (
            <>
              {' '}
              ·{' '}
              <a href={`https://doi.org/${metadata.doi}`} target="_blank" rel="noreferrer">
                DOI↗
              </a>
            </>
          )}
        </p>
      </header>
      <div className={styles.spaceTabs}>
        <Tabs label="Spaces">
          <Button role="tab" aria-selected={!inSpace} onClick={() => setTab('map')}>
            Bài báo
          </Button>
          {SPACES.map((item) => {
            const count = findings.filter((finding) =>
              item.id === 'arguments'
                ? finding.criterion === 'claim' || finding.criterion === 'evidence'
                : item.id === 'writing' && finding.criterion === 'writing',
            ).length;
            return (
              <Button
                key={item.id}
                role="tab"
                aria-selected={mode === item.id}
                onClick={() => openSpace(item.id)}
              >
                {item.label}
                {item.id !== 'data' && ` · ${count} issues`}
              </Button>
            );
          })}
        </Tabs>
      </div>
      <Drawer
        open={infoOpen}
        onClose={() => {
          setInfoOpen(false);
          void repo.paperContext.get(paper.id).then((context) => setMetadata(context?.metadata ?? null));
        }}
        side="right"
        label="Thông tin xuất bản"
      >
        <Button
          onClick={() => {
            setInfoOpen(false);
            void repo.paperContext.get(paper.id).then((context) => setMetadata(context?.metadata ?? null));
          }}
        >
          Đóng
        </Button>
        {infoOpen && <PaperMetadata paper={paper} />}
      </Drawer>
      <Drawer open={markDrawer !== null} onClose={() => setMarkDrawer(null)} side="right" label="Issue">
        <Button onClick={() => setMarkDrawer(null)}>Đóng</Button>
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
                    {PANES.map(paneTab)}
                    {progressChip}
                    <span className={styles.tabDivider} aria-hidden="true" />
                    {MODES.map(modeTab)}
                  </Tabs>
                </div>
              )}
              <EvidencePanel
                paper={paper}
                location={evidence}
                onClose={() => setEvidence(null)}
                onOpenReader={openInReader}
              />
              <div className={wide && showRight && !inSpace ? styles.workspace : undefined}>
                <section
                  ref={centreColumn}
                  className={wide ? styles.column : undefined}
                  aria-label="Paper"
                  hidden={inSpace || !centreVisible}
                >
                  {wide && (
                    <div className={styles.columnTabs}>
                      <Tabs label="Paper">{PANES.map(paneTab)}</Tabs>
                      {progressChip}
                      <RunAllCard
                        compact
                        jobs={jobs}
                        facts={jobFacts}
                        labels={jobLabels}
                        onProgress={setRunProgress}
                        onPrepare={() => setOpened((old) => [...new Set([...old, ...RUN_ALL])])}
                        onOpen={(job) => setTab(JOBS[job].views[0] ?? 'profile')}
                        onRunChecks={() => {
                          if (!checks) runChecks();
                        }}
                      />
                    </div>
                  )}
                  {pane === 'fulltext' && errorBox('Không thể xử lý bài báo.')}
                  {/* A PDF paper is read as its PDF; the parsed text is only shown when the PDF is not here. */}
                  {pane === 'fulltext' && paper.source.kind === 'pdf' && (
                    <PaperPdf
                      paper={paper}
                      target={pdfTarget}
                      marks={marksOnPdf}
                      onMark={(id) => {
                        const mark = marks.find((item) => item.id === id);
                        if (mark) openMark(mark);
                      }}
                      back={backButton}
                      find={find}
                      fallback={
                        <PaperReader
                          paper={paper}
                          selected={selected}
                          onSelect={setSelected}
                          filter={filter}
                          onClearFilter={() => setFilter(null)}
                          highlight={highlight}
                          candidateCounts={candidateCounts}
                          batch={batch}
                          onEditRole={(role) => void editRole(role)}
                          marks={marks}
                          layers={layers}
                          onLayers={setLayers}
                          onMark={openMark}
                          outlineOpen={!(wide && showRight)}
                        />
                      }
                    />
                  )}
                  {pane === 'fulltext' && paper.source.kind !== 'pdf' && backButton}
                  {pane === 'fulltext' && paper.source.kind !== 'pdf' && (
                    <PaperReader
                      paper={paper}
                      selected={selected}
                      onSelect={setSelected}
                      filter={filter}
                      onClearFilter={() => setFilter(null)}
                      highlight={highlight}
                      candidateCounts={candidateCounts}
                      batch={batch}
                      onEditRole={(role) => void editRole(role)}
                      marks={marks}
                      layers={layers}
                      onLayers={setLayers}
                      onMark={openMark}
                      outlineOpen={!(wide && showRight)}
                    />
                  )}

                  <div hidden={pane !== 'summary'} className={styles.blocks}>
                    {!wide && (
                      <RunAllCard
                        jobs={jobs}
                        facts={jobFacts}
                        labels={jobLabels}
                        onProgress={setRunProgress}
                        onPrepare={() => setOpened((old) => [...new Set([...old, ...RUN_ALL])])}
                        onOpen={(job) => setTab(JOBS[job].views[0] ?? 'profile')}
                        onRunChecks={() => {
                          if (!checks) runChecks();
                        }}
                      />
                    )}
                    {/* A reader's summary written by AI from the whole paper, with one button to make it. */}
                    {shown('snapshot') && <PaperSnapshot compact paper={paper} onLocation={openLocation} />}
                    {/* Kept mounted while another tab shows, so a summary being written is not lost. */}
                    <PaperDigest
                      paper={paper}
                      onLocation={openLocation}
                      onStart={() => {
                        if (!jobFacts.snapshot?.done) void jobs.current.snapshot?.start?.();
                      }}
                    />
                  </div>
                </section>
                <section
                  ref={rightColumn}
                  className={wide ? styles.column : undefined}
                  aria-label={
                    inSpace ? (SPACES.find((item) => item.id === mode)?.label ?? 'Space') : 'Analysis'
                  }
                  hidden={wide ? !showRight : focus !== 'right'}
                >
                  {inSpace ? (
                    <div className={styles.spaceHead}>
                      <Button variant="ghost" size="sm" onClick={() => setTab(beforeSpace.current)}>
                        ← Quay lại bài
                      </Button>
                      <h2>{SPACES.find((item) => item.id === mode)?.label}</h2>
                    </div>
                  ) : (
                    <>
                      {wide && (
                        <div className={styles.columnTabs}>
                          <Tabs label="Analysis">{MODES.map(modeTab)}</Tabs>
                        </div>
                      )}
                    </>
                  )}
                  <div hidden={mode !== 'issues'} className={styles.blocks}>
                    {/* Rendered only while showing: hidden copies of its labels would shadow the blocks below. */}
                    {mode === 'issues' && (
                      <FindingsList
                        paper={paper}
                        findings={findings}
                        focusId={focusFinding}
                        onLocation={openLocation}
                        onOpenSource={(view) => setTab(view as ViewId)}
                        onDecide={decide}
                        onRunChecks={runChecks}
                      />
                    )}
                  </div>
                  <div hidden={mode !== 'citations'} className={styles.blocks}>
                    {issuesBlock('citationIssues', ['context'], mode === 'citations')}
                    {block(
                      'references',
                      mode === 'citations' && openBlocks.includes('references') && (
                        <PaperReferences paper={paper} onLocation={openLocation} />
                      ),
                    )}
                    {mode === 'citations' && overview(['context'], 'Context overview', batch)}
                  </div>
                  <div hidden={mode !== 'info'} className={styles.blocks}>
                    {block(
                      'metadata',
                      mode === 'info' && openBlocks.includes('metadata') && <PaperMetadata paper={paper} />,
                    )}
                  </div>
                  {mode === 'data' && <PaperDataViews paper={paper} onLocation={openLocation} />}
                  <div hidden={mode !== 'arguments'} className={styles.blocks}>
                    {mode === 'arguments' && overview(['science', 'argument'], 'Arguments overview', batch)}
                    {issuesBlock('argIssues', ['claim', 'evidence'], mode === 'arguments')}
                    {block(
                      'gap',
                      mode === 'arguments' && openBlocks.includes('gap') && (
                        <PaperSummary
                          paper={paper}
                          insights={stored.insights}
                          onLocation={openLocation}
                          onOpen={setTab}
                          only={['question']}
                        />
                      ),
                    )}
                    {block(
                      'mainClaims',
                      mode === 'arguments' && openBlocks.includes('mainClaims') && (
                        <PaperSummary
                          paper={paper}
                          insights={stored.insights}
                          onLocation={openLocation}
                          onOpen={setTab}
                          only={['claims', 'limits']}
                        />
                      ),
                    )}
                    {block(
                      'atomics',
                      mode === 'arguments' && openBlocks.includes('atomics') && (
                        <PaperAtomics
                          paper={paper}
                          record={stored.measurements}
                          onLocation={openLocation}
                          onOpen={() => setTab('measure')}
                        />
                      ),
                    )}
                    {block(
                      'arguments',
                      shown('arguments') && (
                        <PaperArguments
                          paper={paper}
                          view={viewOf('arguments') === 'aif' ? 'aif' : 'toulmin'}
                          onLocation={openLocation}
                        />
                      ),
                    )}
                    {block(
                      'measure',
                      shown('measure') && <PaperMeasurement paper={paper} onLocation={openLocation} />,
                    )}
                    {block(
                      'review',
                      shown('review') && (
                        <PaperReview paper={paper} checks={checks} onLocation={openLocation} />
                      ),
                    )}
                    {block(
                      'rhetoric',
                      shown('rhetoric') && (
                        <PaperRhetoric
                          paper={paper}
                          focus={viewOf('rhetoric') === 'moves' ? 'moves' : 'reporting'}
                          onLocation={openLocation}
                        />
                      ),
                    )}
                  </div>
                  <div hidden={mode !== 'writing'} className={styles.blocks}>
                    {mode === 'writing' && overview(['discourse', 'writing'], 'Writing overview', batch)}
                    {issuesBlock('writingIssues', ['writing'], mode === 'writing')}
                    {block(
                      'batch',
                      <>
                        {shown('batch') && <BatchPanel paper={paper} batch={batch} />}
                        {mode === 'writing' && openBlocks.includes('batch') && (
                          <PaperOverview
                            paper={paper}
                            analyses={batch.analyses}
                            run={batch.run}
                            focus={viewOf('batch') === 'organization' ? 'discourse' : 'writing'}
                            onFilter={(ids) => {
                              setFilter(ids);
                              const first = paper.paragraphs.find((paragraph) => ids.includes(paragraph.id));
                              if (first) setSelected(first.sectionId);
                              const page = first?.pageStart;
                              if (page) setPdfTarget((old) => ({ page, nonce: (old?.nonce ?? 0) + 1 }));
                              setTab('map');
                            }}
                          />
                        )}
                      </>,
                    )}
                    {block(
                      'stance',
                      shown('stance') && <PaperStance paper={paper} onLocation={openLocation} />,
                    )}
                    {block(
                      'vocabulary',
                      mode === 'writing' && openBlocks.includes('vocabulary') && (
                        <PaperVocabulary paper={paper} onLocation={openLocation} />
                      ),
                    )}
                    {block('probe', shown('probe') && <PaperProbe paper={paper} analyses={batch.analyses} />)}
                  </div>
                </section>
              </div>
            </JobsContext.Provider>
          )}
        </BatchWorkspace>
      </StoredChangedContext.Provider>
    </div>
  );
}
