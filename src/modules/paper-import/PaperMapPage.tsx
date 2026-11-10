import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
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
import { PaperMeasurement } from './PaperMeasurement';
import { PaperStance } from './PaperStance';
import styles from './page.module.css';
import { BatchPanel } from './BatchPanel';
import { useBatchRun } from './useBatchRun';
import { PaperOverview } from './PaperOverview';
import { PaperChecks } from './PaperChecks';
import { PaperReview } from './PaperReview';
import type { ReactNode } from 'react';
import { Transparency } from '@/shared/report/Transparency';
import { captureCalibration } from '@/shared/calibration/data';

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
  const [paper, setPaper] = useState<Paper | null>(null);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [counts, setCounts] = useState<{ sentences: number; words: number } | null>(null);
  const [candidateCounts, setCandidateCounts] = useState<Record<string, number>>({});
  const [tab, setTab] = useState<ViewId>('profile');
  const [evidence, setEvidence] = useState<Finding['locations'][number] | null>(null);
  const [filter, setFilter] = useState<string[] | null>(null);
  const [checks, setChecks] = useState<PaperChecksRecord>();
  const [highlight, setHighlight] = useState<Finding['locations'][number] | null>(null);
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
        // A link from a grounded citation (?p=&s=&e=) opens the reader on that passage.
        const linked = value?.paragraphs.find((item) => item.id === query.get('p'));
        const start = Number(query.get('s'));
        const end = Number(query.get('e'));
        setSelected(linked?.sectionId ?? value?.sections[0]?.id ?? '');
        if (linked) {
          const whole = !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start;
          setHighlight({
            paragraphId: linked.id,
            start: whole ? 0 : start,
            end: whole ? Math.max(1, Array.from(linked.text).length) : end,
          });
          setTab('map');
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
  }, [id, repo, query]);
  async function editRole(role: Section['role']) {
    if (!paper) return;
    try {
      setPaper(await repo.papers.editRole(paper.id, selected, role));
    } catch (cause) {
      setError(String(cause));
    }
  }
  if (loading) return <p>Đang tải bài báo…</p>;
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
  const openLocation = setEvidence;
  const tabButton = (id: ViewId, label: string) => (
    <Button role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
      {label}
    </Button>
  );
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
    <div className={styles.page}>
      <header className={styles.paperHead}>
        <Link to="/papers">← Bài báo đã nhập</Link>
        <div className={styles.titleRow}>
          <h1>{paper.title}</h1>
          <Transparency paper={paper} />
        </div>
        <p className={styles.paperMeta}>
          {paper.source.pageCount ?? 'Không rõ'} trang · {paper.sections.length} mục · {bodyCount} đoạn nội
          dung
          {counts ? ` · ${counts.sentences} câu · ${counts.words} từ` : ''}
        </p>
      </header>
      <BatchWorkspace paper={paper}>
        {(batch) => (
          <>
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
            <p className={styles.tabHelp}>{VIEW_HELP[tab]}</p>
            <EvidencePanel
              paper={paper}
              location={evidence}
              onClose={() => setEvidence(null)}
              onOpenReader={openInReader}
            />
            {tab === 'profile' ? (
              <PaperProfile paper={paper} analyses={batch.analyses} checks={checks} onOpen={setTab} />
            ) : tab === 'snapshot' ? (
              <PaperSnapshot paper={paper} onLocation={openLocation} />
            ) : tab === 'metadata' ? (
              <PaperMetadata paper={paper} />
            ) : tab === 'toulmin' || tab === 'aif' ? (
              <PaperArguments paper={paper} view={tab} onLocation={openLocation} key={tab} />
            ) : tab === 'reporting' || tab === 'moves' ? (
              <PaperRhetoric paper={paper} focus={tab} onLocation={openLocation} key={tab} />
            ) : tab === 'vocabulary' ? (
              <PaperVocabulary paper={paper} onLocation={openLocation} />
            ) : tab === 'context-references' ? (
              <PaperReferences paper={paper} onLocation={openLocation} />
            ) : tab === 'organization' || tab === 'language' ? (
              <>
                <BatchPanel paper={paper} batch={batch} />
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
            ) : tab === 'stance' ? (
              <PaperStance paper={paper} onLocation={openLocation} />
            ) : tab === 'measure' ? (
              <PaperMeasurement paper={paper} onLocation={openLocation} />
            ) : tab === 'probe' ? (
              <PaperProbe paper={paper} analyses={batch.analyses} />
            ) : tab === 'review' ? (
              <PaperReview paper={paper} checks={checks} onLocation={openLocation} />
            ) : (
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
          </>
        )}
      </BatchWorkspace>
    </div>
  );
}
