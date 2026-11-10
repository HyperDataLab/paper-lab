import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import {
  addFields,
  addPapers,
  cellCounts,
  isStale,
  matrixCsv,
  matrixJson,
  moveField,
  NEEDS_ATTENTION,
  removeField,
  removePaper,
  reviewCell,
  updateField,
  type ReviewAction,
} from '@/core/extraction';
import type { ExtractionCell, ExtractionProject, Paper } from '@/core/schemas';
import { downloadJson, downloadText } from '@/shared/calibration/download';
import { describeLlmError } from '@/shared/llm/describeError';
import { useLlm } from '@/shared/llm/LlmProvider';
import { llmExtraction } from '@/shared/llm/llmExtraction';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { ActionBar, ActionMenu } from '@/shared/ui/ActionBar';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { Chip } from '@/shared/ui/Chip';
import { SegmentedControl } from '@/shared/ui/SegmentedControl';
import { AddColumns } from './AddColumns';
import { AddPapers } from './AddPapers';
import { CellDrawer } from './CellDrawer';
import { DeepResearch } from './DeepResearch';
import { ACCESS, STATUS } from './labels';
import { RunPanel, type RunChoice } from './RunPanel';
import styles from './extraction.module.css';

type Panel = 'papers' | 'columns' | 'run' | null;
/** Lets Excel read the CSV as UTF-8, so Vietnamese text survives. */
const BOM = String.fromCharCode(0xfeff);
type Filter = 'all' | 'review' | 'verified';

export default function ProjectPage() {
  const { id } = useParams();
  const repo = useRepositories();
  const llm = useLlm();
  const [project, setProject] = useState<ExtractionProject | null>(null);
  const [papers, setPapers] = useState(new Map<string, Paper>());
  const [panel, setPanel] = useState<Panel>(null);
  const [open, setOpen] = useState<{ paperKey: string; fieldKey: string } | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [view, setView] = useState<'matrix' | 'deep'>('matrix');
  const [progress, setProgress] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!id) return;
    void Promise.all([repo.extraction.get(id), repo.papers.list()])
      .then(([value, saved]) => {
        setProject(value ?? null);
        setPapers(new Map(saved.map((paper) => [paper.id, paper])));
      })
      .catch((cause: unknown) => setError(String(cause)));
    return () => controller.current?.abort();
  }, [id, repo]);
  const counts = useMemo(() => (project ? cellCounts(project) : null), [project]);
  if (!project) return <p>{error ? 'Không tải được project.' : 'Đang tải…'}</p>;
  const save = async (next: ExtractionProject, event?: Parameters<typeof repo.extraction.save>[1]) => {
    try {
      setProject(await repo.extraction.save(next, event));
    } catch (cause) {
      setError(String(cause));
    }
  };
  async function run(choice: RunChoice) {
    if (!project) return;
    setPanel(null);
    const abort = new AbortController();
    controller.current = abort;
    setRunning(true);
    setError('');
    try {
      if (!(await llm.ensureConsent('paper')) || abort.signal.aborted) return;
      const done = await llmExtraction(llm.client, project, papers, {
        ...choice,
        config: llm.config,
        signal: abort.signal,
        onProgress: (finished, total) => setProgress(`${finished}/${total} bài`),
        save: async (next) => {
          setProject(await repo.extraction.save(next));
        },
      });
      const last = done.runs.at(-1);
      await save(done, { action: 'run_extraction', after: { runId: last?.id, status: last?.status } });
      if (last?.status === 'PARTIAL') setError('Một số ô chưa chạy xong hoặc bị lỗi; xem trạng thái từng ô.');
    } catch (cause) {
      setError(describeLlmError(cause) ?? String(cause));
    } finally {
      setRunning(false);
      setProgress('');
      controller.current = null;
    }
  }
  const visible = project.fields.filter((field) => !field.hidden);
  const hidden = project.fields.filter((field) => field.hidden);
  const cellOf = (paperKey: string, fieldKey: string) =>
    project.cells.find((cell) => cell.paperKey === paperKey && cell.fieldKey === fieldKey);
  const matches = (cell: ExtractionCell | undefined) =>
    filter === 'all' ||
    (filter === 'review'
      ? Boolean(cell && (NEEDS_ATTENTION.includes(cell.status) || isStale(cell, project)))
      : cell?.status === 'VERIFIED');
  const rows = project.papers.filter(
    (paper) => filter === 'all' || visible.some((field) => matches(cellOf(paper.key, field.key))),
  );
  const review = (target: ExtractionCell, action: ReviewAction, value?: string) =>
    void save(
      {
        ...project,
        cells: project.cells.map((cell) =>
          cell === target ? reviewCell(cell, action, new Date().toISOString(), value) : cell,
        ),
      },
      {
        action: 'review_extraction',
        after: { paperKey: target.paperKey, fieldKey: target.fieldKey, action },
      },
    );
  const attention = counts
    ? counts.counts.NEEDS_REVIEW + counts.counts.CONFLICT + counts.counts.FAILED + counts.stale
    : 0;
  const opened = open && cellOf(open.paperKey, open.fieldKey);
  const openedField = open && project.fields.find((field) => field.key === open.fieldKey);
  const openedPaper = open && project.papers.find((paper) => paper.key === open.paperKey);
  const exportName = `extraction-${project.title.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 40)}`;
  return (
    <div className={styles.page}>
      <header>
        <Link to="/extraction">← Các project</Link>
        <h1>{project.title}</h1>
        {project.researchQuestion && (
          <p className={styles.note}>Câu hỏi nghiên cứu: {project.researchQuestion}</p>
        )}
      </header>
      <SegmentedControl
        label="Chế độ xem"
        value={view}
        options={[
          { value: 'matrix', label: 'Ma trận' },
          { value: 'deep', label: 'Deep Research' },
        ]}
        onChange={(value) => setView(value as 'matrix' | 'deep')}
      />
      {view === 'deep' ? (
        <DeepResearch project={project} onSave={save} onOpenMatrix={() => setView('matrix')} />
      ) : (
        <>
          <ActionBar
            status={
              running ? (
                <span role="status">Đang trích xuất… {progress}</span>
              ) : (
                `${project.papers.length} bài · ${visible.length} cột · ${counts?.counts.VERIFIED ?? 0} ô đã xác nhận`
              )
            }
          >
            {running ? (
              <Button variant="danger" onClick={() => controller.current?.abort()}>
                Dừng
              </Button>
            ) : (
              <>
                <Button onClick={() => setPanel('papers')}>Thêm bài</Button>
                <Button onClick={() => setPanel('columns')}>Thêm cột</Button>
                <ActionMenu
                  label="Xuất"
                  items={[
                    {
                      label: 'CSV',
                      onSelect: () =>
                        downloadText(
                          `${exportName}.csv`,
                          BOM + matrixCsv(project, { verifiedOnly: false }),
                          'text/csv;charset=utf-8',
                        ),
                    },
                    {
                      label: 'CSV chỉ ô đã xác nhận',
                      onSelect: () =>
                        downloadText(
                          `${exportName}-verified.csv`,
                          BOM + matrixCsv(project, { verifiedOnly: true }),
                          'text/csv;charset=utf-8',
                        ),
                    },
                    {
                      label: 'JSON kèm bằng chứng',
                      onSelect: () =>
                        downloadJson(`${exportName}.json`, matrixJson(project, { verifiedOnly: false })),
                    },
                    {
                      label: 'JSON chỉ ô đã xác nhận',
                      onSelect: () =>
                        downloadJson(
                          `${exportName}-verified.json`,
                          matrixJson(project, { verifiedOnly: true }),
                        ),
                    },
                  ]}
                />
                <Button
                  variant="primary"
                  disabled={!project.papers.length || !visible.length}
                  onClick={() => setPanel('run')}
                >
                  Chạy trích xuất
                </Button>
              </>
            )}
          </ActionBar>
          {error && <p role="alert">{error}</p>}
          <div className={styles.chips}>
            <Chip aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
              Tất cả
            </Chip>
            <Chip aria-pressed={filter === 'review'} count={attention} onClick={() => setFilter('review')}>
              Cần xem lại
            </Chip>
            <Chip
              aria-pressed={filter === 'verified'}
              count={counts?.counts.VERIFIED ?? 0}
              onClick={() => setFilter('verified')}
            >
              Đã xác nhận
            </Chip>
            {hidden.map((field) => (
              <Chip
                key={field.key}
                onClick={() => void save(updateField(project, field.key, { hidden: false }))}
              >
                Hiện cột {field.label}
              </Chip>
            ))}
          </div>
          {!project.papers.length || !visible.length ? (
            <Card>
              <h2>Bắt đầu</h2>
              <p>
                {!project.papers.length ? 'Thêm các bài cần so sánh. ' : ''}
                {!visible.length ? 'Thêm các cột cần trích, hoặc chọn một mẫu theo loại bài.' : ''}
              </p>
            </Card>
          ) : (
            <div className={styles.scroll}>
              <table className={styles.matrix}>
                <thead>
                  <tr>
                    <th scope="col" className={styles.sticky}>
                      Bài báo
                    </th>
                    {visible.map((field) => (
                      <th scope="col" key={field.key} title={field.instruction}>
                        <div className={styles.columnHead}>
                          <span>{field.label}</span>
                          <ActionMenu
                            icon
                            label={`Tuỳ chọn cột ${field.label}`}
                            items={[
                              {
                                label: 'Sang trái',
                                onSelect: () => void save(moveField(project, field.key, -1)),
                              },
                              {
                                label: 'Sang phải',
                                onSelect: () => void save(moveField(project, field.key, 1)),
                              },
                              {
                                label: 'Ẩn cột',
                                onSelect: () => void save(updateField(project, field.key, { hidden: true })),
                              },
                              {
                                label: 'Xoá cột',
                                onSelect: () => void save(removeField(project, field.key)),
                              },
                            ]}
                          />
                        </div>
                      </th>
                    ))}
                    <th scope="col" className={styles.addColumn}>
                      <Button variant="ghost" size="sm" onClick={() => setPanel('columns')}>
                        <Plus size={14} aria-hidden="true" /> Thêm cột
                      </Button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((paper) => (
                    <tr key={paper.key}>
                      <th scope="row" className={styles.sticky}>
                        <div className={styles.columnHead}>
                          <span className={styles.paperTitle}>{paper.title}</span>
                          <ActionMenu
                            icon
                            label={`Tuỳ chọn bài ${paper.title}`}
                            items={[
                              {
                                label: 'Bỏ khỏi project',
                                onSelect: () => void save(removePaper(project, paper.key)),
                              },
                            ]}
                          />
                        </div>
                        <span className={styles.note}>
                          {[paper.authors[0], paper.year, ACCESS[paper.access]].filter(Boolean).join(' · ')}
                        </span>
                      </th>
                      {visible.map((field) => {
                        const cell = cellOf(paper.key, field.key);
                        const stale = Boolean(cell && isStale(cell, project));
                        return (
                          <td key={field.key} className={matches(cell) ? undefined : styles.dim}>
                            {cell ? (
                              <Button
                                variant="ghost"
                                className={styles.cell}
                                aria-label={`${paper.title} · ${field.label}`}
                                onClick={() => setOpen({ paperKey: paper.key, fieldKey: field.key })}
                              >
                                {(cell.status !== 'EXTRACTED' || stale) && (
                                  <span className={styles.badges}>
                                    {cell.status !== 'EXTRACTED' && (
                                      <Badge tone={STATUS[cell.status].tone}>
                                        {STATUS[cell.status].label}
                                      </Badge>
                                    )}
                                    {stale && <Badge tone="warning">Đã cũ</Badge>}
                                  </span>
                                )}
                                {cell.value && <span className={styles.cellValue}>{cell.value}</span>}
                              </Button>
                            ) : (
                              <span className={styles.missing}>Chưa chạy</span>
                            )}
                          </td>
                        );
                      })}
                      <td aria-hidden="true" />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {project.runs.length > 0 && (
            <details>
              <summary>Lịch sử chạy ({project.runs.length})</summary>
              <ul className={styles.history}>
                {[...project.runs].reverse().map((item) => (
                  <li key={item.id}>
                    {new Date(item.createdAt).toLocaleString('vi-VN')} · {item.mode} · {item.status} ·{' '}
                    {item.callsUsed} lượt gọi · {item.model} · {item.promptVersion}
                    {item.errors.length > 0 && ` · ${item.errors.length} lỗi`}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      {panel === 'papers' && (
        <AddPapers
          project={project}
          onClose={() => setPanel(null)}
          onAdd={(added) => void save(addPapers(project, added))}
        />
      )}
      {panel === 'columns' && (
        <AddColumns
          project={project}
          onClose={() => setPanel(null)}
          onAdd={(fields) => void save(addFields(project, fields))}
        />
      )}
      {panel === 'run' && (
        <RunPanel project={project} onClose={() => setPanel(null)} onStart={(choice) => void run(choice)} />
      )}
      {opened && openedField && openedPaper && (
        <CellDrawer
          key={`${opened.paperKey}:${opened.fieldKey}`}
          cell={opened}
          field={openedField}
          paper={openedPaper}
          stale={isStale(opened, project)}
          onClose={() => setOpen(null)}
          onReview={(action, value) => review(opened, action, value)}
          onRerun={() => {
            setOpen(null);
            void run({
              mode: 'STANDARD',
              paperKeys: [opened.paperKey],
              fieldKeys: [opened.fieldKey],
              keepVerified: false,
              budget: 3,
            });
          }}
        />
      )}
    </div>
  );
}
