import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { paperIdentity } from '@/core/paperIdentity';
import { type Paper, type Section, type Finding, type PaperChecksRecord } from '@/core/schemas';
import { runPaperChecks } from '@/core/paperChecks';
import type { ProfileView } from '@/core/paperProfile';
import { analyzeText } from '@/core/text';
import { detectCandidates } from '@/core/detectors';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { Button } from '@/shared/ui/Button';
import { SegmentedControl } from '@/shared/ui/SegmentedControl';
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
import { JobsContext, type JobId, type JobReport, type JobReporter } from './paperJobs';
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
const GROUPS: { id: string; label: string; views: { id: ViewId; label: string }[] }[] = [
  {
    id: 'profile',
    label: 'Hồ sơ',
    views: [
      { id: 'profile', label: '5 chiều' },
      { id: 'snapshot', label: 'Snapshot' },
      { id: 'metadata', label: 'Metadata' },
    ],
  },
  {
    id: 'science',
    label: 'A. Khoa học',
    views: [
      { id: 'measure', label: 'Đo lường' },
      { id: 'reporting', label: 'Validity và dữ liệu' },
      { id: 'science-checks', label: 'Kiểm tra số liệu' },
    ],
  },
  {
    id: 'argument',
    label: 'B. Lập luận',
    views: [
      { id: 'toulmin', label: 'Toulmin' },
      { id: 'aif', label: 'Sơ đồ AIF' },
    ],
  },
  {
    id: 'discourse',
    label: 'C. Diễn ngôn',
    views: [
      { id: 'organization', label: 'Cấu trúc và mạch' },
      { id: 'moves', label: 'Moves và Tóm tắt' },
      { id: 'discourse-checks', label: 'Hình và bảng' },
    ],
  },
  {
    id: 'writing',
    label: 'D. Viết học thuật',
    views: [
      { id: 'language', label: 'Câu và từ' },
      { id: 'stance', label: 'Giọng văn' },
      { id: 'vocabulary', label: 'Từ vựng và cụm từ' },
      { id: 'writing-checks', label: 'Viết tắt và khẳng định' },
      { id: 'probe', label: 'Độ bền điểm' },
    ],
  },
  {
    id: 'context',
    label: 'E. Bối cảnh',
    views: [
      { id: 'context-references', label: 'Tài liệu tham khảo' },
      { id: 'context-checks', label: 'Trích dẫn' },
    ],
  },
];
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
  snapshot: { label: 'Snapshot', views: ['snapshot'] },
  measure: { label: 'Đo lường', views: ['measure'] },
  rhetoric: { label: 'Validity và Moves', views: ['reporting', 'moves'] },
  arguments: { label: 'Lập luận', views: ['toulmin', 'aif'] },
  batch: { label: 'Chất lượng viết', views: ['organization', 'language'] },
  stance: { label: 'Giọng văn', views: ['stance'] },
  probe: { label: 'Độ bền điểm', views: ['probe'] },
  review: { label: 'Phản biện AI', views: ['review'] },
};
const JOB_IDS = Object.keys(JOBS) as JobId[];
const jobOf = (view: ViewId) => JOB_IDS.find((id) => JOBS[id].views.includes(view));
const isView = (value: string | null): value is ViewId => value !== null && value in VIEW_HELP;
type JobFacts = Omit<JobReport, 'start'>;

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
        before.ready === report.ready
      )
        return old;
      const { running, done, estimate, ready } = report;
      return { ...old, [jobId]: { running, done, estimate, ready } };
    });
  }, []);
  /** Opens a view and records it in the address, so a reload or a shared link lands on the same view. */
  const setTab = (view: ViewId) => {
    setTabState(view);
    // Keep the panel being left as well as the one being opened.
    const keep = [jobOf(tab), jobOf(view)].filter((job): job is JobId => job !== undefined);
    setOpened((old) => [...new Set([...old, ...keep])]);
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
  const shown = (job: JobId) => opened.includes(job) || jobOf(tab) === job;
  const elsewhere = JOB_IDS.filter((job) => jobFacts[job]?.running && jobOf(tab) !== job);
  const activeGroup = GROUPS.find((group) => group.views.some((view) => view.id === tab));
  const checkIds = CHECKS_OF[tab];
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
                {GROUPS.slice(0, 1).map((group) => (
                  <Button
                    key={group.id}
                    role="tab"
                    aria-selected={activeGroup?.id === group.id}
                    onClick={() => setTab(group.views[0]?.id ?? 'profile')}
                  >
                    {group.label}
                  </Button>
                ))}
                {tabButton('map', 'Đọc bài')}
                <span className={styles.tabDivider} aria-hidden="true" />
                {GROUPS.slice(1).map((group) => (
                  <Button
                    key={group.id}
                    role="tab"
                    aria-selected={activeGroup?.id === group.id}
                    onClick={() => setTab(group.views[0]?.id ?? 'profile')}
                  >
                    {group.label}
                  </Button>
                ))}
                {tabButton('review', 'Phản biện AI')}
              </Tabs>
            </div>
            {activeGroup && activeGroup.views.length > 1 && (
              <div className={styles.subViews}>
                <SegmentedControl
                  label={`Nội dung của ${activeGroup.label}`}
                  value={tab}
                  options={activeGroup.views.map((view) => ({ value: view.id, label: view.label }))}
                  onChange={(value) => setTab(value as ViewId)}
                />
              </div>
            )}
            {elsewhere.length > 0 && (
              <p role="status" className={styles.runStrip}>
                Đang chạy ở tab khác:{' '}
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
            <p className={styles.tabHelp}>{VIEW_HELP[tab]}</p>
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
                />
              )}
              <div className={styles.splitMain}>
                {shown('snapshot') && (
                  <div hidden={tab !== 'snapshot'}>
                    <PaperSnapshot paper={paper} onLocation={openLocation} />
                  </div>
                )}
                {shown('arguments') && (
                  <div hidden={jobOf(tab) !== 'arguments'}>
                    <PaperArguments
                      paper={paper}
                      view={tab === 'aif' ? 'aif' : 'toulmin'}
                      onLocation={openLocation}
                    />
                  </div>
                )}
                {shown('rhetoric') && (
                  <div hidden={jobOf(tab) !== 'rhetoric'}>
                    <PaperRhetoric
                      paper={paper}
                      focus={tab === 'moves' ? 'moves' : 'reporting'}
                      onLocation={openLocation}
                    />
                  </div>
                )}
                {shown('batch') && (
                  <div hidden={jobOf(tab) !== 'batch'}>
                    <BatchPanel paper={paper} batch={batch} />
                  </div>
                )}
                {shown('stance') && (
                  <div hidden={tab !== 'stance'}>
                    <PaperStance paper={paper} onLocation={openLocation} />
                  </div>
                )}
                {shown('measure') && (
                  <div hidden={tab !== 'measure'}>
                    <PaperMeasurement paper={paper} onLocation={openLocation} />
                  </div>
                )}
                {shown('probe') && (
                  <div hidden={tab !== 'probe'}>
                    <PaperProbe paper={paper} analyses={batch.analyses} />
                  </div>
                )}
                {shown('review') && (
                  <div hidden={tab !== 'review'}>
                    <PaperReview paper={paper} checks={checks} onLocation={openLocation} />
                  </div>
                )}
                {tab === 'profile' ? (
                  <PaperProfile paper={paper} analyses={batch.analyses} checks={checks} onOpen={setTab} />
                ) : tab === 'metadata' ? (
                  <PaperMetadata paper={paper} />
                ) : tab === 'vocabulary' ? (
                  <PaperVocabulary paper={paper} onLocation={openLocation} />
                ) : tab === 'context-references' ? (
                  <PaperReferences paper={paper} onLocation={openLocation} />
                ) : tab === 'organization' || tab === 'language' ? (
                  <>
                    <PaperOverview
                      paper={paper}
                      analyses={batch.analyses}
                      run={batch.run}
                      focus={tab === 'organization' ? 'discourse' : 'writing'}
                      onFilter={(ids) => {
                        setFilter(ids);
                        const first = paper.paragraphs.find((paragraph) => ids.includes(paragraph.id));
                        if (first) setSelected(first.sectionId);
                        setTab('map');
                      }}
                    />
                  </>
                ) : checkIds ? (
                  <>
                    {errorBox('Không thể xử lý kiểm tra.')}
                    <PaperChecks
                      only={checkIds}
                      paper={paper}
                      record={checks}
                      onRun={() => {
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
                      }}
                      onReview={(findingId, status) => {
                        void repo.paperChecks
                          .review(paper.id, findingId, status)
                          .then(setChecks)
                          .catch((cause: unknown) => setError(String(cause)));
                      }}
                      onLocation={openLocation}
                    />
                  </>
                ) : jobOf(tab) ? null : (
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
