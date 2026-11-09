import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { type Paper, type Section, type Finding, type PaperChecksRecord } from '@/core/schemas';
import { runPaperChecks } from '@/core/paperChecks';
import { analyzeText } from '@/core/text';
import { detectCandidates } from '@/core/detectors';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { Button } from '@/shared/ui/Button';
import { Tabs } from '@/shared/ui/Tabs';
import { PaperProbe } from './PaperProbe';
import { PaperReader } from './PaperReader';
import { PaperMeasurement } from './PaperMeasurement';
import styles from './page.module.css';
import { BatchPanel } from './BatchPanel';
import { useBatchRun } from './useBatchRun';
import { PaperOverview } from './PaperOverview';
import { PaperChecks } from './PaperChecks';
import { PaperReview } from './PaperReview';
import type { ReactNode } from 'react';
import { Transparency } from '@/shared/report/Transparency';
import { captureCalibration } from '@/shared/calibration/data';

type TabId = 'map' | 'measure' | 'overview' | 'checks' | 'review' | 'probe';
const TAB_HELP: Record<TabId, string> = {
  map: 'Đọc bài theo mục lục, xem bảng và đoạn gốc.',
  measure: 'Bài báo đo gì, bằng metric nào, dưới protocol nào, và kết quả ra sao.',
  overview: 'Chạy phân tích từng đoạn rồi xem thống kê theo mục. Không phải điểm của bài báo.',
  checks: 'Kiểm tra tự động trích dẫn, số liệu, hình/bảng và viết tắt. Không dùng AI.',
  review: 'Các góc nhìn phản biện của AI, kèm câu trích trong bài.',
  probe: 'Đo xem điểm của AI có đổi khi chỉ đổi văn phong hay không.',
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
  const repo = useRepositories();
  const [paper, setPaper] = useState<Paper | null>(null);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [counts, setCounts] = useState<{ sentences: number; words: number } | null>(null);
  const [candidateCounts, setCandidateCounts] = useState<Record<string, number>>({});
  const [tab, setTab] = useState<'map' | 'overview' | 'checks' | 'review' | 'probe' | 'measure'>('map');
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
        setSelected(value?.sections[0]?.id ?? '');
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
  }, [id, repo]);
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
  const openLocation = (location: Finding['locations'][number]) => {
    const paragraph = paper.paragraphs.find((item) => item.id === location.paragraphId);
    if (!paragraph) return;
    setFilter(null);
    setSelected(paragraph.sectionId);
    setHighlight(location);
    setTab('map');
  };
  const tabButton = (id: TabId, label: string) => (
    <Button role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
      {label}
    </Button>
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
    <div className={styles.page}>
      <header className={styles.paperHead}>
        <Link to="/papers">← Bài báo đã nhập</Link>
        <h1>{paper.title}</h1>
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
                <span className={styles.tabGroup} aria-hidden="true">
                  Hiểu bài
                </span>
                {tabButton('map', 'Đọc bài')}
                {tabButton('measure', 'Đo lường')}
                <span className={styles.tabDivider} aria-hidden="true" />
                <span className={styles.tabGroup} aria-hidden="true">
                  Đánh giá
                </span>
                {tabButton('overview', 'Chất lượng viết')}
                {tabButton('checks', 'Kiểm tra')}
                {tabButton('review', 'Phản biện AI')}
                {tabButton('probe', 'Độ bền điểm')}
              </Tabs>
            </div>
            <p className={styles.tabHelp}>{TAB_HELP[tab]}</p>
            {tab === 'overview' ? (
              <>
                <BatchPanel paper={paper} batch={batch} />
                <PaperOverview
                  paper={paper}
                  analyses={batch.analyses}
                  run={batch.run}
                  checks={checks}
                  onChecks={() => setTab('checks')}
                  onFilter={(ids) => {
                    setFilter(ids);
                    const first = paper.paragraphs.find((paragraph) => ids.includes(paragraph.id));
                    if (first) setSelected(first.sectionId);
                    setTab('map');
                  }}
                />
              </>
            ) : tab === 'checks' ? (
              <>
                {errorBox('Không thể xử lý kiểm tra.')}
                <PaperChecks
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
      <Transparency paper={paper} />
    </div>
  );
}
