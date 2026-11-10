import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { paperIdentity } from '@/core/paperIdentity';
import { type Paper, type Section, type Finding, type PaperChecksRecord } from '@/core/schemas';
import { runPaperChecks } from '@/core/paperChecks';
import {
  collectFindings,
  collectMarks,
  type FindingInputs,
  type FindingStatus,
  type PaperFinding,
  type PaperMark,
} from '@/core/paperFindings';
import type { ProfileView } from '@/core/paperProfile';
import { analyzeText } from '@/core/text';
import { detectCandidates } from '@/core/detectors';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { Button } from '@/shared/ui/Button';
import { Tabs } from '@/shared/ui/Tabs';
import { EvidencePanel } from './EvidencePanel';
import { PaperArguments } from './PaperArguments';
import { PaperMetadata } from './PaperMetadata';
import { PaperProfile } from './PaperProfile';
import { PaperSnapshot } from './PaperSnapshot';
import { PaperReferences } from './PaperReferences';
import { PaperRhetoric } from './PaperRhetoric';
import { PaperVocabulary } from './PaperVocabulary';
import { PaperProbe } from './PaperProbe';
import { PaperReader } from './PaperReader';
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
import { FindingsList } from './FindingsList';
import { PaperSummary } from './PaperSummary';
import { CriterionMark, SectionBlock, type BlockStatus } from './SectionBlock';
import type { Criterion } from './criteria';
import { Chip } from '@/shared/ui/Chip';
import { BatchPanel } from './BatchPanel';
import { useBatchRun } from './useBatchRun';
import { PaperOverview } from './PaperOverview';
import { PaperChecks } from './PaperChecks';
import { PaperReview } from './PaperReview';
import type { ReactNode } from 'react';
import { Transparency } from '@/shared/report/Transparency';
import { captureCalibration } from '@/shared/calibration/data';
import { Loading } from '@/shared/ui/StateNote';

type ViewId = 'profile' | 'snapshot' | 'metadata' | 'map' | 'review' | ProfileView;
/** The centre column holds the paper: its full text, or its summary. */
type Pane = 'fulltext' | 'summary';
/** The right column holds what the analyses say about the paper. */
type Mode = 'arguments' | 'writing' | 'issues';
type Place = 'summary' | Mode;
type BlockId =
  | 'snapshot'
  | 'checks'
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
 * Every analysis is one block in one place: the paper's Summary in the centre column, or one of the three
 * tabs of the right column. Names are the scientific terms a researcher already uses; the help line under
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
  snapshot: {
    place: 'summary',
    title: 'Key facts',
    criterion: 'evidence',
    job: 'snapshot',
    views: [{ id: 'snapshot', label: 'Key facts' }],
  },
  references: {
    place: 'summary',
    title: 'References',
    criterion: 'context',
    views: [{ id: 'context-references', label: 'References' }],
  },
  metadata: {
    place: 'summary',
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
  checks: {
    place: 'issues',
    title: 'Automated checks',
    criterion: 'evidence',
    views: [
      { id: 'science-checks', label: 'Numbers & claims' },
      { id: 'discourse-checks', label: 'Figures & tables' },
      { id: 'writing-checks', label: 'Acronyms & claim strength' },
      { id: 'context-checks', label: 'Citations' },
    ],
  },
  review: {
    place: 'issues',
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
  { id: 'arguments', label: 'Arguments' },
  { id: 'writing', label: 'Writing style' },
  { id: 'issues', label: 'Issues' },
];
/** What a reader comes to each tab for, said once under the tab. */
const PLACE_HELP: Record<Pane | Mode, string> = {
  fulltext:
    'Đọc bài gốc. Các đoạn được đánh dấu theo lớp; bấm vào chỗ đánh dấu để mở phát hiện hoặc phân tích tương ứng.',
  summary:
    'Nắm nhanh trước khi đọc kỹ: bài hỏi gì, đóng góp gì, làm thế nào, tìm ra gì và tự nhận giới hạn nào.',
  arguments:
    'Tác giả lập luận thế nào: luận điểm, bằng chứng, phép đo và giới hạn. Mỗi ý kèm câu trích để bạn kiểm.',
  writing:
    'Bài được viết ra sao: cấu trúc, mạch, câu chữ, giọng văn. Dùng để học cách viết, không phải để chấm bài.',
  issues: 'Những điểm cần bạn xem và quyết định. AI và quy tắc chỉ đề xuất; bạn xác nhận hoặc bỏ qua.',
};
const DEFAULT_VIEW: Record<Mode, ViewId> = {
  arguments: 'toulmin',
  writing: 'organization',
  issues: 'science-checks',
};
const CHECKS_OF: Partial<Record<ViewId, string[]>> = {
  'science-checks': ['numbers_consistency', 'unsupported_claims'],
  'discourse-checks': ['figures_tables'],
  'writing-checks': ['acronyms', 'claim_strength_drift'],
  'context-checks': ['citations_references'],
};
const VIEW_HELP: Record<ViewId, string> = {
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

const WIDE = '(min-width: 1280px)';
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
  const [opened, setOpened] = useState<JobId[]>([]);
  const [openBlocks, setOpenBlocks] = useState<BlockId[]>(() => {
    const first = initial && blockOf(initial);
    return first ? [first] : [];
  });
  const [blockView, setBlockView] = useState<Partial<Record<BlockId, ViewId>>>(() => {
    const first = initial && blockOf(initial);
    return first && initial ? { [first]: initial } : {};
  });
  const jobs = useRef<Partial<Record<JobId, JobReport>>>({});
  const [jobFacts, setJobFacts] = useState<Partial<Record<JobId, JobFacts>>>({});
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
  // What the analyses have stored, read again whenever one of them finishes or a decision is made here.
  const [stored, setStored] = useState<Omit<FindingInputs, 'paper' | 'checks'>>({});
  const [storedTick, setStoredTick] = useState(0);
  const notifyStoredChanged = useCallback(() => setStoredTick((tick) => tick + 1), []);
  const [layers, setLayers] = useState<Criterion[]>(['claim', 'evidence', 'context']);
  const [focusFinding, setFocusFinding] = useState<string | null>(null);
  const wide = useWide();
  const [splitWanted, setSplitWanted] = useState(readSplit);
  useEffect(() => {
    let active = true;
    if (id)
      void repo.paperChecks
        .get(id)
        .then((value) => {
          if (active) setChecks(value);
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
            .then((context) => {
              if (active) setShownTitle(paperIdentity(value, { metadata: context?.metadata }).title);
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
    setTab('map');
  };
  // The paper is the centre of the page: on a wide screen it is always beside the analysis, so a quote opens
  // there. On a narrow screen showing the analysis, the quote opens in a drawer to keep the reader's place.
  const showRight = !wide || splitWanted;
  const centreVisible = wide || focus === 'centre';
  const openLocation = (location: Finding['locations'][number]) => {
    const paragraph = paper.paragraphs.find((item) => item.id === location.paragraphId);
    if (!paragraph || !centreVisible) return setEvidence(location);
    setFilter(null);
    setSelected(paragraph.sectionId);
    setHighlight(location);
    setPaneState('fulltext');
  };
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
    setFocusFinding(mark.findingId);
    setTab(viewOf('checks'));
    if (!wide) setFocus('right');
  };
  const sectionLabel = (sectionId: string) =>
    paper.sections.find((section) => section.id === sectionId)?.heading ?? sectionId;
  const runSection = (job: JobId, sectionId: string) => {
    const block = BLOCK_IDS.find((id) => BLOCKS[id].job === job);
    if (block) setOpenBlocks((old) => (old.includes(block) ? old : [...old, block]));
    void jobs.current[job]?.sectionRun?.start(sectionId);
  };
  /** The analyses that can run one section on their own, by the criterion they answer to. */
  const sectionRuns = JOB_IDS.flatMap((job) => {
    const block = BLOCK_IDS.find((id) => BLOCKS[id].job === job);
    const fact = jobFacts[job];
    if (!block || !fact || fact.running || fact.sections.length === 0) return [];
    return [
      {
        criterion: BLOCKS[block].criterion,
        label: JOBS[job].label,
        sections: fact.sections,
        run: (sectionId: string) => runSection(job, sectionId),
      },
    ];
  });
  const jobLabels = Object.fromEntries(JOB_IDS.map((job) => [job, JOBS[job].label])) as Record<JobId, string>;
  const mode = modeOf(tab);
  const toReview = findings.filter((item) => item.status === 'open').length;
  // The findings table offers section runs, so the analyses that can do one are mounted there too.
  const shown = (job: JobId) =>
    opened.includes(job) ||
    blocksIn(mode).some((id) => BLOCKS[id].job === job) ||
    (pane === 'summary' && blocksIn('summary').some((id) => BLOCKS[id].job === job)) ||
    (mode === 'issues' && SECTION_JOBS.includes(job));
  const visibleJob = (job: JobId) =>
    BLOCK_IDS.some(
      (id) =>
        BLOCKS[id].job === job &&
        openBlocks.includes(id) &&
        (BLOCKS[id].place === mode ? showRight : BLOCKS[id].place === 'summary' && pane === 'summary'),
    );
  const elsewhere = JOB_IDS.filter((job) => jobFacts[job]?.running && !visibleJob(job));
  const checkView = viewOf('checks');
  const checkIds = CHECKS_OF[checkView] ?? [];
  const toggleBlock = (id: BlockId) =>
    setOpenBlocks((old) => (old.includes(id) ? old.filter((item) => item !== id) : [...old, id]));
  /** One analysis as a folding block. `body` is rendered by the caller so kept panels stay mounted. */
  const block = (id: BlockId, body: ReactNode) => {
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
        title={def.title}
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
  /** Jump chips for the blocks of a mode: one press opens the block and scrolls to it. */
  const chips = (target: Place) => (
    <div className={styles.blockChips} role="group" aria-label="Jump to">
      {blocksIn(target).map((id) => (
        <Chip key={id} aria-pressed={openBlocks.includes(id)} onClick={() => setTab(viewOf(id))}>
          <CriterionMark criterion={BLOCKS[id].criterion} />
          {BLOCKS[id].title}
        </Chip>
      ))}
    </div>
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
  const modeTab = (item: { id: Mode; label: string }) => (
    <Button
      key={item.id}
      role="tab"
      aria-selected={mode === item.id && (wide || focus === 'right')}
      onClick={() => {
        setTab(
          blockView[BLOCK_IDS.find((id) => BLOCKS[id].place === item.id) ?? 'checks'] ??
            DEFAULT_VIEW[item.id],
        );
        if (!splitWanted && wide) toggleSplit();
      }}
    >
      {item.label}
      {item.id === 'issues' && toReview > 0 && (
        // The header names the count in words; here it is a mark, so the tab keeps its name.
        <span className={styles.tabCount} aria-hidden="true" title={`${toReview} cần duyệt`}>
          {toReview}
        </span>
      )}
    </Button>
  );
  return (
    <div className={styles.page}>
      <header className={styles.paperHead}>
        <Link to="/papers">← Bài báo đã nhập</Link>
        <div className={styles.titleRow}>
          <h1>{shownTitle ?? paperIdentity(paper).title}</h1>
          <div className={styles.row}>
            {toReview > 0 && (
              <Button
                size="sm"
                className={styles.reviewPill}
                onClick={() => {
                  setTab(viewOf('checks'));
                  if (!splitWanted && wide) toggleSplit();
                }}
              >
                {toReview} cần duyệt
              </Button>
            )}
            {wide && (
              <Button size="sm" aria-pressed={!splitWanted} onClick={toggleSplit}>
                Ẩn phân tích
              </Button>
            )}
            <Transparency paper={paper} />
          </div>
        </div>
        <p className={styles.paperMeta}>
          {paper.source.pageCount ?? 'Không rõ'} trang · {paper.sections.length} mục · {bodyCount} đoạn nội
          dung
          {counts ? ` · ${counts.sentences} câu · ${counts.words} từ` : ''}
        </p>
      </header>
      <StoredChangedContext.Provider value={notifyStoredChanged}>
        <BatchWorkspace paper={paper}>
          {(batch) => (
            <JobsContext.Provider value={reportJob}>
              {!wide && (
                <div className={styles.paperTabs}>
                  <Tabs label="Bài báo">
                    {PANES.map(paneTab)}
                    <span className={styles.tabDivider} aria-hidden="true" />
                    {MODES.map(modeTab)}
                  </Tabs>
                </div>
              )}
              {elsewhere.length > 0 && (
                <p role="status" className={styles.runStrip}>
                  Đang chạy ở chỗ khác:{' '}
                  {elsewhere.map((job) => (
                    <Button
                      key={job}
                      size="sm"
                      variant="ghost"
                      onClick={() => setTab(JOBS[job].views[0] ?? 'profile')}
                    >
                      {JOBS[job].label}
                    </Button>
                  ))}
                </p>
              )}
              <EvidencePanel
                paper={paper}
                location={evidence}
                onClose={() => setEvidence(null)}
                onOpenReader={openInReader}
              />
              <div className={wide && showRight ? styles.workspace : undefined}>
                <section
                  className={wide ? styles.column : undefined}
                  aria-label="Paper"
                  hidden={!centreVisible}
                >
                  {wide && (
                    <div className={styles.columnTabs}>
                      <Tabs label="Paper">{PANES.map(paneTab)}</Tabs>
                      <RunAllCard
                        compact
                        jobs={jobs}
                        facts={jobFacts}
                        labels={jobLabels}
                        onPrepare={() => setOpened((old) => [...new Set([...old, ...RUN_ALL])])}
                        onOpen={(job) => setTab(JOBS[job].views[0] ?? 'profile')}
                        onRunChecks={() => {
                          if (!checks) runChecks();
                        }}
                      />
                    </div>
                  )}
                  <p className={styles.tabHelp}>{PLACE_HELP[pane]}</p>
                  {pane === 'fulltext' && (
                    <>
                      {errorBox('Không thể xử lý bài báo.')}
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
                    </>
                  )}
                  <div hidden={pane !== 'summary'} className={styles.blocks}>
                    {!wide && (
                      <RunAllCard
                        jobs={jobs}
                        facts={jobFacts}
                        labels={jobLabels}
                        onPrepare={() => setOpened((old) => [...new Set([...old, ...RUN_ALL])])}
                        onOpen={(job) => setTab(JOBS[job].views[0] ?? 'profile')}
                        onRunChecks={() => {
                          if (!checks) runChecks();
                        }}
                      />
                    )}
                    {pane === 'summary' && (
                      <PaperSummary
                        paper={paper}
                        insights={stored.insights}
                        onLocation={openLocation}
                        onOpen={setTab}
                      />
                    )}
                    {block(
                      'snapshot',
                      shown('snapshot') && <PaperSnapshot paper={paper} onLocation={openLocation} />,
                    )}
                    {block(
                      'metadata',
                      pane === 'summary' && openBlocks.includes('metadata') && (
                        <PaperMetadata paper={paper} />
                      ),
                    )}
                    {block(
                      'references',
                      pane === 'summary' && openBlocks.includes('references') && (
                        <PaperReferences paper={paper} onLocation={openLocation} />
                      ),
                    )}
                    {pane === 'summary' && (
                      <PaperProfile
                        // A finished analysis changes what the cards can show, so they are read again.
                        key={JOB_IDS.filter((job) => jobFacts[job]?.done).join(',')}
                        paper={paper}
                        analyses={batch.analyses}
                        checks={checks}
                        onOpen={setTab}
                      />
                    )}
                  </div>
                </section>
                <section
                  className={wide ? styles.column : undefined}
                  aria-label="Analysis"
                  hidden={wide ? !showRight : focus !== 'right'}
                >
                  {wide && (
                    <div className={styles.columnTabs}>
                      <Tabs label="Analysis">{MODES.map(modeTab)}</Tabs>
                    </div>
                  )}
                  <p className={styles.tabHelp}>{PLACE_HELP[mode]}</p>
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
                        sectionRuns={sectionRuns}
                      />
                    )}
                    <h2 className={styles.sourcesHead}>Sources of the issues</h2>
                    {chips('issues')}
                    {block(
                      'checks',
                      mode === 'issues' && openBlocks.includes('checks') && (
                        <>
                          {errorBox('Không thể xử lý kiểm tra.')}
                          <PaperChecks
                            only={checkIds}
                            paper={paper}
                            record={checks}
                            onRun={runChecks}
                            onReview={(findingId, status) => {
                              void repo.paperChecks
                                .review(paper.id, findingId, status)
                                .then(setChecks)
                                .catch((cause: unknown) => setError(String(cause)));
                            }}
                            onLocation={openLocation}
                          />
                        </>
                      ),
                    )}
                    {block(
                      'review',
                      shown('review') && (
                        <PaperReview paper={paper} checks={checks} onLocation={openLocation} />
                      ),
                    )}
                  </div>
                  <div hidden={mode !== 'arguments'} className={styles.blocks}>
                    {chips('arguments')}
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
                    {chips('writing')}
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
