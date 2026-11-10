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
import { ReadingPane } from './ReadingPane';
import { PaperMeasurement } from './PaperMeasurement';
import { PaperStance } from './PaperStance';
import styles from './page.module.css';
import {
  JobsContext,
  RUN_ALL,
  type JobFacts,
  type JobId,
  type JobReport,
  type JobReporter,
} from './paperJobs';
import { RunAllCard } from './RunAllCard';
import { FindingsList } from './FindingsList';
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
type Mode = 'summary' | 'findings' | 'dossier' | 'map';
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
 * The page has three modes beside the paper. Each analysis is one block in a mode; a block with two
 * readings of the same analysis lists both views. Every former view id still opens its block.
 */
const BLOCKS: Record<
  BlockId,
  {
    mode: Exclude<Mode, 'map'>;
    title: string;
    criterion: Criterion;
    job?: JobId;
    views: { id: ViewId; label: string }[];
  }
> = {
  snapshot: {
    mode: 'summary',
    title: 'Thông tin cốt lõi',
    criterion: 'evidence',
    job: 'snapshot',
    views: [{ id: 'snapshot', label: 'Thông tin cốt lõi' }],
  },
  checks: {
    mode: 'findings',
    title: 'Kiểm tra tự động',
    criterion: 'evidence',
    views: [
      { id: 'science-checks', label: 'Số liệu và khẳng định' },
      { id: 'discourse-checks', label: 'Hình và bảng' },
      { id: 'writing-checks', label: 'Viết tắt và mức khẳng định' },
      { id: 'context-checks', label: 'Trích dẫn' },
    ],
  },
  review: {
    mode: 'findings',
    title: 'Phản biện AI',
    criterion: 'claim',
    job: 'review',
    views: [{ id: 'review', label: 'Phản biện AI' }],
  },
  measure: {
    mode: 'dossier',
    title: 'Phương pháp và số liệu',
    criterion: 'evidence',
    job: 'measure',
    views: [{ id: 'measure', label: 'Phương pháp và số liệu' }],
  },
  rhetoric: {
    mode: 'dossier',
    title: 'Giới hạn và cách dẫn dắt',
    criterion: 'claim',
    job: 'rhetoric',
    views: [
      { id: 'reporting', label: 'Giới hạn và dữ liệu' },
      { id: 'moves', label: 'Cách dẫn dắt và Tóm tắt' },
    ],
  },
  arguments: {
    mode: 'dossier',
    title: 'Lập luận',
    criterion: 'claim',
    job: 'arguments',
    views: [
      { id: 'toulmin', label: 'Thẻ luận điểm' },
      { id: 'aif', label: 'Chuỗi suy luận' },
    ],
  },
  batch: {
    mode: 'dossier',
    title: 'Chất lượng viết',
    criterion: 'writing',
    job: 'batch',
    views: [
      { id: 'organization', label: 'Cấu trúc và mạch' },
      { id: 'language', label: 'Câu và từ' },
    ],
  },
  stance: {
    mode: 'dossier',
    title: 'Giọng văn',
    criterion: 'writing',
    job: 'stance',
    views: [{ id: 'stance', label: 'Giọng văn' }],
  },
  vocabulary: {
    mode: 'dossier',
    title: 'Từ vựng và cụm từ',
    criterion: 'writing',
    views: [{ id: 'vocabulary', label: 'Từ vựng và cụm từ' }],
  },
  references: {
    mode: 'dossier',
    title: 'Tài liệu tham khảo',
    criterion: 'context',
    views: [{ id: 'context-references', label: 'Tài liệu tham khảo' }],
  },
  probe: {
    mode: 'dossier',
    title: 'Độ bền điểm',
    criterion: 'writing',
    job: 'probe',
    views: [{ id: 'probe', label: 'Độ bền điểm' }],
  },
  metadata: {
    mode: 'dossier',
    title: 'Thông tin xuất bản',
    criterion: 'context',
    views: [{ id: 'metadata', label: 'Thông tin xuất bản' }],
  },
};
const BLOCK_IDS = Object.keys(BLOCKS) as BlockId[];
const blockOf = (view: ViewId) => BLOCK_IDS.find((id) => BLOCKS[id].views.some((item) => item.id === view));
const modeOf = (view: ViewId): Mode => {
  if (view === 'map') return 'map';
  const block = blockOf(view);
  return block ? BLOCKS[block].mode : 'summary';
};
const blocksIn = (mode: Mode) => BLOCK_IDS.filter((id) => BLOCKS[id].mode === mode);
const MODE_HELP: Record<Exclude<Mode, 'map'>, string> = {
  summary: 'Bài này nói gì: thông tin cốt lõi và tiến độ phân tích theo từng chiều.',
  findings: 'Những điểm cần xem lại trong bài, từ kiểm tra tự động và phản biện của AI.',
  dossier: 'Các phân tích mô tả bài báo. Mỗi khối trả lời một câu hỏi; mở khối để xem chi tiết.',
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
    'Luận điểm của tác giả và các thành phần theo Toulmin. Mô tả cấu trúc, không kết luận đúng hay sai.',
  aif: 'Tiền đề dẫn tới kết luận qua bước suy luận nào, và bị phản bác ở đâu.',
  profile:
    'Mỗi chiều trả lời một câu hỏi riêng nên không có điểm tổng. Số có ghi “AI” là ứng viên từ mô hình, bạn có thể bác bỏ khi xem chi tiết.',
  map: 'Đọc bài theo mục lục, xem bảng và đoạn gốc.',
  measure: 'Bài báo đo gì, bằng metric nào, dưới protocol nào, và kết quả ra sao.',
  'science-checks': 'Đối chiếu tự động số liệu và khẳng định trong bài. Không dùng AI.',
  reporting:
    'Tác giả nêu giới hạn validity nào và có công bố dữ liệu, code không. Mô tả việc báo cáo, không kết luận bài đúng hay sai.',
  moves: 'Bài dẫn dắt người đọc thế nào và Tóm tắt có khớp nội dung không.',
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
  snapshot: { label: 'Thông tin cốt lõi', views: ['snapshot'] },
  measure: { label: 'Phương pháp và số liệu', views: ['measure'] },
  rhetoric: { label: 'Giới hạn và cách dẫn dắt', views: ['reporting', 'moves'] },
  arguments: { label: 'Lập luận', views: ['toulmin', 'aif'] },
  batch: { label: 'Chất lượng viết', views: ['organization', 'language'] },
  stance: { label: 'Giọng văn', views: ['stance'] },
  probe: { label: 'Độ bền điểm', views: ['probe'] },
  review: { label: 'Phản biện AI', views: ['review'] },
};
const JOB_IDS = Object.keys(JOBS) as JobId[];
const isView = (value: string | null): value is ViewId => value !== null && value in VIEW_HELP;

const WIDE = '(min-width: 1280px)';
/** True on screens wide enough to show the paper beside its analysis. */
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
  const [tab, setTabState] = useState<ViewId>(() => {
    const view = query.get('view');
    return isView(view) ? view : 'profile';
  });
  // An AI panel stays mounted once opened, so its run keeps going while the reader looks elsewhere.
  const [opened, setOpened] = useState<JobId[]>([]);
  const [openBlocks, setOpenBlocks] = useState<BlockId[]>(() => {
    const first = blockOf(tab);
    return first && first !== 'snapshot' ? ['snapshot', first] : ['snapshot'];
  });
  const [blockView, setBlockView] = useState<Partial<Record<BlockId, ViewId>>>(() => {
    const first = blockOf(tab);
    return first ? { [first]: tab } : {};
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
        before.estimate === report.estimate &&
        before.ready === report.ready &&
        before.startable === (report.start !== null)
      )
        return old;
      const { running, done, estimate, ready } = report;
      return { ...old, [jobId]: { running, done, estimate, ready, startable: report.start !== null } };
    });
  }, []);
  /** Opens a view and records it in the address, so a reload or a shared link lands on the same view. */
  const setTab = (view: ViewId) => {
    setTabState(view);
    const block = blockOf(view);
    // Every analysis of the mode being shown is mounted, so each row can say what a run would cost.
    // The mode being left keeps its panels too, so nothing running there is interrupted.
    const jobsOfMode = [...blocksIn(modeOf(tab)), ...blocksIn(modeOf(view))]
      .map((id) => BLOCKS[id].job)
      .filter((job): job is JobId => job !== undefined);
    setOpened((old) => [...new Set([...old, ...jobsOfMode])]);
    if (block) {
      setOpenBlocks((old) => (old.includes(block) ? old : [...old, block]));
      setBlockView((old) => ({ ...old, [block]: view }));
      if (view !== 'snapshot')
        window.setTimeout(
          () => document.getElementById(`block-${block}`)?.scrollIntoView?.({ block: 'start' }),
          0,
        );
    }
    setQuery(
      (old) => {
        const next = new URLSearchParams(old);
        next.set('view', view);
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
  }, [id, repo]);
  const doneJobs = JOB_IDS.filter((job) => jobFacts[job]?.done).join(',');
  const storedMode = modeOf(tab);
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
    if (tab === 'map' && highlight)
      document
        .getElementById(`paper-paragraph-${highlight.paragraphId}`)
        ?.scrollIntoView?.({ block: 'center' });
  }, [tab, selected, highlight]);
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
          setTabState('map');
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
  // Beside the analysis the paper is already on screen, so a finding is shown there, not in a drawer.
  const split = wide && splitWanted && tab !== 'map';
  const openLocation = (location: Finding['locations'][number]) => {
    const paragraph = paper.paragraphs.find((item) => item.id === location.paragraphId);
    if (!split || !paragraph) return setEvidence(location);
    setSelected(paragraph.sectionId);
    setHighlight(location);
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
  const tabButton = (id: ViewId, label: string) => (
    <Button role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
      {label}
    </Button>
  );
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
    const next =
      status === 'confirmed'
        ? 'confirmed_by_human'
        : status === 'dismissed'
          ? 'dismissed_by_human'
          : 'candidate';
    const itemId = finding.id.slice(finding.source.length + 1);
    const done =
      finding.source === 'checks'
        ? repo.paperChecks.review(paper.id, itemId, next).then(setChecks)
        : repo.paperReviews.review(paper.id, itemId, next).then(() => setStoredTick((tick) => tick + 1));
    void done.catch((cause: unknown) => setError(String(cause)));
  };
  /** A mark on the paper opens the finding it stands for, or the block that described it. */
  const openMark = (mark: PaperMark) => {
    if (!mark.findingId) return setTab(mark.view as ViewId);
    setFocusFinding(mark.findingId);
    setTab(viewOf('checks'));
  };
  const jobLabels = Object.fromEntries(JOB_IDS.map((job) => [job, JOBS[job].label])) as Record<JobId, string>;
  const mode = modeOf(tab);
  const shown = (job: JobId) => opened.includes(job) || blocksIn(mode).some((id) => BLOCKS[id].job === job);
  const visibleJob = (job: JobId) =>
    BLOCK_IDS.some((id) => BLOCKS[id].job === job && BLOCKS[id].mode === mode && openBlocks.includes(id));
  const elsewhere = JOB_IDS.filter((job) => jobFacts[job]?.running && !visibleJob(job));
  const lastDossier = blocksIn('dossier').find((id) => openBlocks.includes(id)) ?? 'measure';
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
        estimate={fact?.estimate}
        onRun={
          job && status === 'todo' && fact?.startable
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
  const chips = (target: Exclude<Mode, 'map'>) => (
    <div className={styles.blockChips} role="group" aria-label="Đi tới khối">
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
  return (
    <div className={`${styles.page} ${split ? '' : styles.narrow}`}>
      <header className={styles.paperHead}>
        <Link to="/papers">← Bài báo đã nhập</Link>
        <div className={styles.titleRow}>
          <h1>{shownTitle ?? paperIdentity(paper).title}</h1>
          <div className={styles.row}>
            {wide && (
              <Button size="sm" aria-pressed={splitWanted} onClick={toggleSplit}>
                Đọc song song
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
      <BatchWorkspace paper={paper}>
        {(batch) => (
          <JobsContext.Provider value={reportJob}>
            <div className={styles.paperTabs}>
              <Tabs label="Bài báo">
                <Button role="tab" aria-selected={mode === 'summary'} onClick={() => setTab('profile')}>
                  Tóm lược
                </Button>
                <Button
                  role="tab"
                  aria-selected={mode === 'findings'}
                  onClick={() => setTab(viewOf('checks'))}
                >
                  Phát hiện
                </Button>
                <Button
                  role="tab"
                  aria-selected={mode === 'dossier'}
                  onClick={() => setTab(viewOf(lastDossier))}
                >
                  Hồ sơ
                </Button>
                <span className={styles.tabDivider} aria-hidden="true" />
                {tabButton('map', 'Đọc bài')}
              </Tabs>
            </div>
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
            <p className={styles.tabHelp}>{mode === 'map' ? VIEW_HELP.map : MODE_HELP[mode]}</p>
            <EvidencePanel
              paper={paper}
              location={evidence}
              onClose={() => setEvidence(null)}
              onOpenReader={openInReader}
            />
            <div className={split ? styles.split : undefined}>
              {split && (
                <ReadingPane
                  paper={paper}
                  selected={selected}
                  onSelect={(sectionId) => {
                    setSelected(sectionId);
                    setHighlight(null);
                  }}
                  highlight={highlight}
                  onOpenFull={() => setTab('map')}
                  marks={marks}
                  layers={layers}
                  onLayers={setLayers}
                  onMark={openMark}
                />
              )}
              <div className={styles.splitMain}>
                <div hidden={mode !== 'summary'} className={styles.blocks}>
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
                  {block(
                    'snapshot',
                    shown('snapshot') && <PaperSnapshot paper={paper} onLocation={openLocation} />,
                  )}
                  {mode === 'summary' && (
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
                <div hidden={mode !== 'findings'} className={styles.blocks}>
                  {/* Rendered only while showing: hidden copies of its labels would shadow the blocks below. */}
                  {mode === 'findings' && (
                    <FindingsList
                      paper={paper}
                      findings={findings}
                      focusId={focusFinding}
                      onLocation={openLocation}
                      onOpenSource={(view) => setTab(view as ViewId)}
                      onDecide={decide}
                    />
                  )}
                  <h2 className={styles.sourcesHead}>Nguồn của các phát hiện</h2>
                  {chips('findings')}
                  {block(
                    'checks',
                    mode === 'findings' && openBlocks.includes('checks') && (
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
                <div hidden={mode !== 'dossier'} className={styles.blocks}>
                  {chips('dossier')}
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
                    'batch',
                    <>
                      {shown('batch') && <BatchPanel paper={paper} batch={batch} />}
                      {mode === 'dossier' && openBlocks.includes('batch') && (
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
                    mode === 'dossier' && openBlocks.includes('vocabulary') && (
                      <PaperVocabulary paper={paper} onLocation={openLocation} />
                    ),
                  )}
                  {block(
                    'references',
                    mode === 'dossier' && openBlocks.includes('references') && (
                      <PaperReferences paper={paper} onLocation={openLocation} />
                    ),
                  )}
                  {block('probe', shown('probe') && <PaperProbe paper={paper} analyses={batch.analyses} />)}
                  {block(
                    'metadata',
                    mode === 'dossier' && openBlocks.includes('metadata') && <PaperMetadata paper={paper} />,
                  )}
                </div>
                {mode === 'map' && (
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
                      marks={marks.filter((mark) => layers.includes(mark.criterion))}
                      onMark={openMark}
                    />
                  </>
                )}
              </div>
            </div>
          </JobsContext.Provider>
        )}
      </BatchWorkspace>
    </div>
  );
}
