import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  SectionSchema,
  type Paper,
  type Section,
  type Finding,
  type PaperChecksRecord,
} from '@/core/schemas';
import { runPaperChecks } from '@/core/paperChecks';
import { analyzeText } from '@/core/text';
import { detectCandidates } from '@/core/detectors';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { Select } from '@/shared/ui/Select';
import { Tabs } from '@/shared/ui/Tabs';
import { PaperProbe } from './PaperProbe';
import styles from './page.module.css';
import { BatchPanel } from './BatchPanel';
import { BatchParagraphStatus } from './BatchParagraphStatus';
import { useBatchRun } from './useBatchRun';
import { SECTION_ROLE_LABELS } from './sectionRoles';
import { PaperOverview } from './PaperOverview';
import { PaperChecks } from './PaperChecks';
import { PaperReview } from './PaperReview';
import type { ReactNode } from 'react';
import { Transparency } from '@/shared/report/Transparency';

function BatchWorkspace({
  paper,
  children,
}: {
  paper: Paper;
  children: (batch: ReturnType<typeof useBatchRun>) => ReactNode;
}) {
  const batch = useBatchRun(paper);
  return (
    <>
      <BatchPanel paper={paper} batch={batch} />
      {children(batch)}
    </>
  );
}

export default function PaperMapPage() {
  const { id } = useParams();
  const repo = useRepositories();
  const navigate = useNavigate();
  const [paper, setPaper] = useState<Paper | null>(null);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [counts, setCounts] = useState<{ sentences: number; words: number } | null>(null);
  const [candidateCounts, setCandidateCounts] = useState<Record<string, number>>({});
  const [tab, setTab] = useState<'map' | 'overview' | 'checks' | 'review' | 'probe'>('map');
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
  async function runDetectors() {
    if (!paper) return;
    try {
      const values = await Promise.all(
        paper.paragraphs
          .filter((p) => p.kind === 'body')
          .map(async (p) => [p.id, detectCandidates(await analyzeText(p.text), null).length] as const),
      );
      setCandidateCounts(Object.fromEntries(values));
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
  const section = paper.sections.find((item) => item.id === selected);
  const bodyCount = paper.paragraphs.filter((item) => item.kind === 'body').length;
  const roles = paper.sections.reduce<Partial<Record<Section['role'], number>>>((result, item) => {
    result[item.role] = (result[item.role] ?? 0) + 1;
    return result;
  }, {});
  return (
    <div className={styles.page}>
      <Link to="/papers">← Bài báo đã nhập</Link>
      <h1>{paper.title}</h1>
      <Transparency paper={paper} />
      <BatchWorkspace paper={paper}>
        {(batch) => (
          <>
            <Tabs label="Bài báo">
              <Button role="tab" aria-selected={tab === 'map'} onClick={() => setTab('map')}>
                Sơ đồ
              </Button>
              <Button role="tab" aria-selected={tab === 'overview'} onClick={() => setTab('overview')}>
                Tổng quan
              </Button>
              <Button role="tab" aria-selected={tab === 'checks'} onClick={() => setTab('checks')}>
                Kiểm tra
              </Button>
              <Button role="tab" aria-selected={tab === 'review'} onClick={() => setTab('review')}>
                Phản biện AI
              </Button>
              <Button role="tab" aria-selected={tab === 'probe'} onClick={() => setTab('probe')}>
                Độ bền điểm
              </Button>
            </Tabs>
            {tab === 'overview' ? (
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
            ) : tab === 'checks' ? (
              <>
                {error && (
                  <div role="alert">
                    Không thể xử lý kiểm tra.
                    <details>
                      <summary>Chi tiết kỹ thuật</summary>
                      {error}
                    </details>
                  </div>
                )}
                <PaperChecks
                  paper={paper}
                  record={checks}
                  onRun={() => {
                    void repo.paperChecks
                      .save({
                        schemaVersion: 1,
                        paperId: paper.id,
                        report: runPaperChecks(paper),
                        decisions: [],
                      })
                      .then(setChecks)
                      .catch((cause: unknown) => setError(String(cause)));
                  }}
                  onReview={(findingId, status) => {
                    void repo.paperChecks
                      .review(paper.id, findingId, status)
                      .then(setChecks)
                      .catch((cause: unknown) => setError(String(cause)));
                  }}
                  onLocation={(location) => {
                    const paragraph = paper.paragraphs.find((item) => item.id === location.paragraphId);
                    if (!paragraph) return;
                    setFilter(null);
                    setSelected(paragraph.sectionId);
                    setHighlight(location);
                    setTab('map');
                  }}
                />
              </>
            ) : tab === 'probe' ? (
              <PaperProbe paper={paper} analyses={batch.analyses} />
            ) : tab === 'review' ? (
              <PaperReview
                paper={paper}
                checks={checks}
                onLocation={(location) => {
                  const paragraph = paper.paragraphs.find((item) => item.id === location.paragraphId);
                  if (!paragraph) return;
                  setFilter(null);
                  setSelected(paragraph.sectionId);
                  setHighlight(location);
                  setTab('map');
                }}
              />
            ) : (
              <>
                <Button onClick={() => void runDetectors()}>Chạy bộ phát hiện cục bộ</Button>
                {filter && (
                  <div>
                    Đang lọc {filter.length} đoạn. <Button onClick={() => setFilter(null)}>Bỏ lọc</Button>
                  </div>
                )}
                {error && (
                  <div role="alert">
                    Không thể xử lý bài báo.
                    <details>
                      <summary>Chi tiết kỹ thuật</summary>
                      {error}
                    </details>
                  </div>
                )}
                <div className={styles.map}>
                  <Card>
                    <h2>Mục</h2>
                    <div className={styles.outline}>
                      {paper.sections.map((item) => (
                        <Button
                          key={item.id}
                          aria-pressed={selected === item.id}
                          onClick={() => setSelected(item.id)}
                        >
                          <span>
                            <span title={item.role}>
                              <Badge>{SECTION_ROLE_LABELS[item.role]}</Badge>
                            </span>{' '}
                            {item.heading} ({paper.paragraphs.filter((p) => p.sectionId === item.id).length})
                          </span>
                        </Button>
                      ))}
                    </div>
                  </Card>
                  <Card>
                    {section ? (
                      <>
                        <h2>{section.heading}</h2>
                        <Select
                          label="Vai trò của mục"
                          value={section.role}
                          onChange={(event) => {
                            const role = SectionSchema.shape.role.safeParse(event.target.value);
                            if (role.success) void editRole(role.data);
                          }}
                        >
                          {SectionSchema.shape.role.options.map((role) => (
                            <option key={role} value={role} title={role}>
                              {SECTION_ROLE_LABELS[role]}
                            </option>
                          ))}
                        </Select>
                        {paper.paragraphs
                          .filter(
                            (item) => item.sectionId === section.id && (!filter || filter.includes(item.id)),
                          )
                          .map((item) => (
                            <div
                              key={item.id}
                              id={`paper-paragraph-${item.id}`}
                              className={`${styles.paragraph} ${['caption', 'equation', 'reference', 'footnote'].includes(item.kind) ? styles.muted : ''}`}
                            >
                              <span>{item.id} </span>
                              <Badge>{item.kind}</Badge>
                              <p className={styles.reading}>
                                {highlight?.paragraphId === item.id ? (
                                  <>
                                    {Array.from(item.text).slice(0, highlight.start).join('')}
                                    <mark>
                                      {Array.from(item.text).slice(highlight.start, highlight.end).join('')}
                                    </mark>
                                    {Array.from(item.text).slice(highlight.end).join('')}
                                  </>
                                ) : (
                                  item.text
                                )}
                              </p>
                              {item.kind === 'body' && candidateCounts[item.id] !== undefined && (
                                <p>{candidateCounts[item.id]} ứng viên cục bộ</p>
                              )}
                              <BatchParagraphStatus
                                item={batch.run?.items.find((entry) => entry.paragraphId === item.id)}
                                analysis={batch.analyses.find(
                                  (entry) =>
                                    entry.id ===
                                    batch.run?.items.find((runItem) => runItem.paragraphId === item.id)
                                      ?.analysisId,
                                )}
                                retry={() => batch.retry(item.id)}
                                busy={batch.run?.status === 'running'}
                              />
                              {item.kind === 'body' && (
                                <Button
                                  onClick={() => navigate('/evaluate', { state: { prefill: item.text } })}
                                >
                                  Đánh giá đoạn này
                                </Button>
                              )}
                            </div>
                          ))}
                      </>
                    ) : (
                      <p>Không có mục nào.</p>
                    )}
                  </Card>
                  <Card>
                    <h2>Tóm tắt</h2>
                    <p>
                      {paper.source.pageCount ?? 'Không rõ'} trang · {bodyCount} đoạn nội dung
                    </p>
                    <p>{counts ? `${counts.sentences} câu · ${counts.words} từ` : 'Đang đếm câu và từ…'}</p>
                    <h3>Số mục theo vai trò</h3>
                    <ul>
                      {Object.entries(roles).map(([role, count]) => (
                        <li key={role} title={role}>
                          {SECTION_ROLE_LABELS[role as Section['role']]}: {count}
                        </li>
                      ))}
                    </ul>
                  </Card>
                </div>
              </>
            )}
          </>
        )}
      </BatchWorkspace>
    </div>
  );
}
