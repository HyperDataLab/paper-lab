import { useState } from 'react';
import { Plus, Table2 } from 'lucide-react';
import {
  addFields,
  addPapers,
  cellCounts,
  isStale,
  matrixCsv,
  matrixJson,
  MAX_COLUMNS,
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
import { useRepositories } from '@/shared/storage/StorageProvider';
import { ActionBar, ActionMenu } from '@/shared/ui/ActionBar';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Empty } from '@/shared/ui/StateNote';
import { Chip } from '@/shared/ui/Chip';
import { useExtractionRun } from './useExtractionRun';
import { AddColumns } from './AddColumns';
import { AddPapers } from './AddPapers';
import { CellDrawer } from './CellDrawer';
import { ACCESS, STATUS } from './labels';
import { RunPanel, type RunChoice } from './RunPanel';
import styles from './extraction.module.css';

type Panel = 'papers' | 'columns' | 'run' | null;
/** Lets Excel read the CSV as UTF-8, so Vietnamese text survives. */
const BOM = String.fromCharCode(0xfeff);
type Filter = 'all' | 'review' | 'verified';

/**
 * The extraction matrix of one project: a row per paper, a column per field, with its toolbar, filters, the
 * panels that add papers, columns or a run, and the drawer that shows a cell's evidence. Used by the project page
 * and by a paper's Trích xuất tab, which shows the paper's own project.
 */
export function ExtractionMatrix({
  project,
  papers,
  onChange,
  extraExports = [],
  paperKey,
}: {
  project: ExtractionProject;
  /** Imported papers by id, so a run can read their text. */
  papers: Map<string, Paper>;
  onChange: (project: ExtractionProject) => void;
  /** More entries for the Xuất menu, such as the paper's citation on a paper page. */
  extraExports?: { label: string; onSelect: () => void }[];
  /**
   * Shows only this paper's row, as on a paper's own page: the paper is already chosen, so adding or removing
   * papers is not offered, and a run covers only this row.
   */
  paperKey?: string;
}) {
  const repo = useRepositories();
  const [panel, setPanel] = useState<Panel>(null);
  const [open, setOpen] = useState<{ paperKey: string; fieldKey: string } | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [error, setError] = useState('');
  const {
    run: runExtraction,
    running,
    progress,
    cancel,
  } = useExtractionRun(project, papers, onChange, setError);
  const save = async (next: ExtractionProject, event?: Parameters<typeof repo.extraction.save>[1]) => {
    try {
      onChange(await repo.extraction.save(next, event));
    } catch (cause) {
      setError(String(cause));
    }
  };
  const run = (choice: RunChoice) => {
    setPanel(null);
    return runExtraction(choice);
  };
  const visible = project.fields.filter((field) => !field.hidden);
  const hidden = project.fields.filter((field) => field.hidden);
  const cellOf = (paperKey: string, fieldKey: string) =>
    project.cells.find((cell) => cell.paperKey === paperKey && cell.fieldKey === fieldKey);
  const matches = (cell: ExtractionCell | undefined) =>
    filter === 'all' ||
    (filter === 'review'
      ? Boolean(cell && (NEEDS_ATTENTION.includes(cell.status) || isStale(cell, project)))
      : cell?.status === 'VERIFIED');
  const single = paperKey !== undefined;
  const scopedPapers = project.papers.filter((paper) => !single || paper.key === paperKey);
  const verticalPaper = scopedPapers.length === 1 ? scopedPapers[0] : undefined;
  const rows = project.papers.filter(
    (paper) =>
      (!single || paper.key === paperKey) &&
      (filter === 'all' || visible.some((field) => matches(cellOf(paper.key, field.key)))),
  );
  /** What a run may cover: on a paper's page, that paper only. */
  const runScope = single
    ? {
        ...project,
        papers: project.papers.filter((paper) => paper.key === paperKey),
        cells: project.cells.filter((cell) => cell.paperKey === paperKey),
      }
    : project;
  const counts = cellCounts(runScope);
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
  const attention = counts.counts.NEEDS_REVIEW + counts.counts.CONFLICT + counts.counts.FAILED + counts.stale;
  const opened = open && cellOf(open.paperKey, open.fieldKey);
  const openedField = open && project.fields.find((field) => field.key === open.fieldKey);
  const openedPaper = open && project.papers.find((paper) => paper.key === open.paperKey);
  const exportName = `extraction-${project.title.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 40)}`;
  const columnHead = (field: ExtractionProject['fields'][number], vertical = false) => (
    <div className={styles.columnHead}>
      <span>{field.label}</span>
      <ActionMenu
        icon
        label={`Tuỳ chọn cột ${field.label}`}
        items={[
          {
            label: vertical ? 'Lên trên' : 'Sang trái',
            onSelect: () => void save(moveField(project, field.key, -1)),
          },
          {
            label: vertical ? 'Xuống dưới' : 'Sang phải',
            onSelect: () => void save(moveField(project, field.key, 1)),
          },
          { label: 'Ẩn cột', onSelect: () => void save(updateField(project, field.key, { hidden: true })) },
          { label: 'Xoá cột', onSelect: () => void save(removeField(project, field.key)) },
        ]}
      />
    </div>
  );
  const cellContent = (
    paper: ExtractionProject['papers'][number],
    field: ExtractionProject['fields'][number],
  ) => {
    const cell = cellOf(paper.key, field.key);
    const stale = Boolean(cell && isStale(cell, project));
    return cell ? (
      <Button
        variant="ghost"
        className={styles.cell}
        aria-label={`${paper.title} · ${field.label}`}
        onClick={() => setOpen({ paperKey: paper.key, fieldKey: field.key })}
      >
        {(cell.status !== 'EXTRACTED' || stale) && (
          <span className={styles.badges}>
            {cell.status !== 'EXTRACTED' && (
              <Badge tone={STATUS[cell.status].tone}>{STATUS[cell.status].label}</Badge>
            )}
            {stale && <Badge tone="warning">Đã cũ</Badge>}
          </span>
        )}
        {cell.value && <span className={styles.cellValue}>{cell.value}</span>}
      </Button>
    ) : (
      <span className={styles.missing}>Chưa chạy</span>
    );
  };
  return (
    <div className={styles.matrixArea}>
      <ActionBar
        busy={running}
        status={
          running ? (
            <span role="status">Đang trích xuất… {progress}</span>
          ) : (
            `${single ? '' : `${project.papers.length} bài · `}${visible.length} cột · ${counts.counts.VERIFIED} ô đã xác nhận`
          )
        }
      >
        {running ? (
          <Button variant="danger" onClick={() => cancel()}>
            Dừng
          </Button>
        ) : (
          <>
            {!single && <Button onClick={() => setPanel('papers')}>Thêm bài</Button>}
            <Button disabled={project.fields.length >= MAX_COLUMNS} onClick={() => setPanel('columns')}>
              Thêm cột
            </Button>
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
                  label: 'JSON kèm evidence',
                  onSelect: () =>
                    downloadJson(`${exportName}.json`, matrixJson(project, { verifiedOnly: false })),
                },
                {
                  label: 'JSON chỉ ô đã xác nhận',
                  onSelect: () =>
                    downloadJson(`${exportName}-verified.json`, matrixJson(project, { verifiedOnly: true })),
                },
                ...extraExports,
              ]}
            />
            <Button
              variant="primary"
              disabled={!runScope.papers.length || !visible.length}
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
          count={counts.counts.VERIFIED}
          onClick={() => setFilter('verified')}
        >
          Đã xác nhận
        </Chip>
        {hidden.map((field) => (
          <Chip key={field.key} onClick={() => void save(updateField(project, field.key, { hidden: false }))}>
            Hiện cột {field.label}
          </Chip>
        ))}
      </div>
      {!runScope.papers.length || !visible.length ? (
        <Empty
          icon={<Table2 size={22} />}
          title={!runScope.papers.length ? 'Bảng chưa có bài nào' : 'Bảng chưa có cột nào'}
          hint={
            !runScope.papers.length && !visible.length
              ? 'Mỗi hàng là một bài, mỗi cột là một thông tin cần trích. Chọn bài trước, rồi chọn cột hoặc một mẫu theo loại bài.'
              : !runScope.papers.length
                ? 'Chọn các bài cần so sánh; mỗi bài là một hàng.'
                : 'Chọn các thông tin cần trích, hoặc một mẫu cột theo loại bài.'
          }
        >
          {!runScope.papers.length && !single && (
            <Button variant="primary" onClick={() => setPanel('papers')}>
              Chọn bài để so sánh
            </Button>
          )}
          {!visible.length && (
            <Button
              variant={runScope.papers.length ? 'primary' : 'secondary'}
              disabled={project.fields.length >= MAX_COLUMNS}
              onClick={() => setPanel('columns')}
            >
              Chọn cột cần trích
            </Button>
          )}
        </Empty>
      ) : verticalPaper ? (
        <div className={styles.verticalList} role="table" aria-label="Trích xuất theo trường">
          {visible
            .filter((field) => matches(cellOf(verticalPaper.key, field.key)))
            .map((field) => (
              <div className={styles.verticalRow} role="row" key={field.key}>
                <div className={styles.verticalHead} role="rowheader" title={field.instruction}>
                  {columnHead(field, true)}
                </div>
                <div className={styles.verticalValue} role="cell">
                  {cellContent(verticalPaper, field)}
                </div>
              </div>
            ))}
        </div>
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
                    {columnHead(field)}
                  </th>
                ))}
                <th scope="col" className={styles.addColumn}>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={project.fields.length >= MAX_COLUMNS}
                    onClick={() => setPanel('columns')}
                  >
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
                      {!single && (
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
                      )}
                    </div>
                    <span className={styles.note}>
                      {[paper.authors[0], paper.year, ACCESS[paper.access]].filter(Boolean).join(' · ')}
                    </span>
                  </th>
                  {visible.map((field) => {
                    const cell = cellOf(paper.key, field.key);
                    return (
                      <td key={field.key} className={matches(cell) ? undefined : styles.dim}>
                        {cellContent(paper, field)}
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
        <RunPanel
          project={runScope}
          singlePaper={single}
          onClose={() => setPanel(null)}
          onStart={(choice) => void run(choice)}
        />
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
