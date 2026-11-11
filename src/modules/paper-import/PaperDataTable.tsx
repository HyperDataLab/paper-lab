import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  addFields,
  addPapers,
  catalogField,
  FIELD_TEMPLATES,
  isStale,
  matrixCsv,
  matrixJson,
  MAX_COLUMNS,
  newProject,
  paperBibtex,
  paperRis,
  projectPaperFromPaper,
  reviewCell,
  type ReviewAction,
} from '@/core/extraction';
import { paperIdentity } from '@/core/paperIdentity';
import type { ExtractionCell, ExtractionProject, Paper, PaperMetadata } from '@/core/schemas';
import { AddColumns, CellDrawer, RunPanel, STATUS, useExtractionRun } from '@/modules/extraction';
import { downloadJson, downloadText } from '@/shared/calibration/download';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { ActionBar, ActionMenu } from '@/shared/ui/ActionBar';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import styles from './data-table.module.css';

export function PaperDataTable({ paper }: { paper: Paper }) {
  const repo = useRepositories();
  const [project, setProject] = useState<ExtractionProject | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [metadata, setMetadata] = useState<PaperMetadata | null>(null);
  const [panel, setPanel] = useState<'columns' | 'run' | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState('');
  const { run, running, progress, cancel } = useExtractionRun(
    project,
    new Map([[paper.id, paper]]),
    setProject,
    setError,
  );
  useEffect(() => {
    void Promise.all([repo.extraction.forPaper(paper.id), repo.paperContext.get(paper.id)])
      .then(([saved, context]) => {
        setProject(saved ?? null);
        setMetadata(context?.metadata ?? null);
        setLoaded(true);
      })
      .catch((cause: unknown) => {
        setError(String(cause));
        setLoaded(true);
      });
  }, [paper.id, repo]);
  const save = async (next: ExtractionProject, event?: Parameters<typeof repo.extraction.save>[1]) => {
    try {
      setProject(await repo.extraction.save(next, event));
    } catch (cause) {
      setError(String(cause));
    }
  };
  async function create() {
    try {
      const existing = await repo.extraction.forPaper(paper.id);
      if (existing) {
        setProject(existing);
        return;
      }
      const title = paperIdentity(paper, { metadata }).title;
      const base = {
        ...newProject({
          id: crypto.randomUUID(),
          title,
          researchQuestion: '',
          now: new Date().toISOString(),
        }),
        paperId: paper.id,
      };
      const fields = (FIELD_TEMPLATES[0]?.keys ?? []).flatMap((key) => {
        const field = catalogField(key);
        return field ? [field] : [];
      });
      await save(addFields(addPapers(base, [projectPaperFromPaper(paper, undefined, metadata)]), fields));
    } catch (cause) {
      setError(String(cause));
    }
  }
  if (!loaded) return <p>Đang tải…</p>;
  if (!project)
    return (
      <div>
        <p>Tạo bảng để trích xuất dữ liệu từ bài này.</p>
        <Button variant="primary" onClick={() => void create()}>
          Tạo bảng dữ liệu
        </Button>
        {error && <p role="alert">{error}</p>}
      </div>
    );
  const paperRow = project.papers.find(
    (item) => item.source.kind === 'paper' && item.source.paperId === paper.id,
  );
  const paperProject = {
    ...project,
    papers: paperRow ? [paperRow] : [],
    cells: project.cells.filter((cell) => cell.paperKey === paperRow?.key),
  };
  const fields = project.fields.filter((field) => !field.hidden);
  const openedField = project.fields.find((field) => field.key === open);
  const opened = project.cells.find((cell) => cell.paperKey === paperRow?.key && cell.fieldKey === open);
  const citation = {
    title: metadata?.title || paperIdentity(paper).title,
    authors: metadata?.authors ?? [],
    year: metadata?.year ?? null,
    venue: metadata?.venue ?? null,
    doi: metadata?.doi ?? null,
    volume: metadata?.volume ?? null,
    issue: metadata?.issue ?? null,
    pages: metadata?.pages ?? null,
  };
  const review = (cell: ExtractionCell, action: ReviewAction, value?: string) =>
    void save(
      {
        ...project,
        cells: project.cells.map((item) =>
          item === cell ? reviewCell(item, action, new Date().toISOString(), value) : item,
        ),
      },
      { action: 'review_extraction', after: { paperKey: cell.paperKey, fieldKey: cell.fieldKey, action } },
    );
  return (
    <div className={styles.workspace}>
      <ActionBar
        status={
          running
            ? `Đang trích xuất… ${progress}`
            : `Còn ${Math.max(0, MAX_COLUMNS - project.fields.length)} chỗ trong 50 cột`
        }
      >
        <Button
          disabled={running || project.fields.length >= MAX_COLUMNS}
          onClick={() => setPanel('columns')}
        >
          Thêm cột
        </Button>
        <ActionMenu
          label="Xuất"
          items={[
            {
              label: 'CSV (mở được bằng Excel)',
              onSelect: () =>
                downloadText(
                  'data-table.csv',
                  '\ufeff' + matrixCsv(paperProject, { verifiedOnly: false }),
                  'text/csv;charset=utf-8',
                ),
            },
            {
              label: 'JSON',
              onSelect: () =>
                downloadJson('data-table.json', matrixJson(paperProject, { verifiedOnly: false })),
            },
            {
              label: 'RIS',
              onSelect: () =>
                downloadText('paper.ris', paperRis(citation), 'application/x-research-info-systems'),
            },
            {
              label: 'BibTeX',
              onSelect: () => downloadText('paper.bib', paperBibtex(citation), 'text/plain;charset=utf-8'),
            },
          ]}
        />
        {running ? (
          <Button variant="danger" onClick={cancel}>
            Dừng
          </Button>
        ) : (
          <Button variant="primary" disabled={!paperRow || !fields.length} onClick={() => setPanel('run')}>
            Chạy trích xuất
          </Button>
        )}
      </ActionBar>
      {error && <p role="alert">{error}</p>}
      <Link to={`/extraction/${project.id}`}>So sánh với bài khác</Link>
      {!paperRow && <p>Bài này đã bị bỏ khỏi project. Thêm lại bài trong project để tiếp tục.</p>}
      <div className={styles.scroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Column</th>
              <th scope="col">Value</th>
              <th scope="col">Trạng thái</th>
              <th scope="col">Bằng chứng</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((field) => {
              const cell = project.cells.find(
                (item) => item.paperKey === paperRow?.key && item.fieldKey === field.key,
              );
              return (
                <tr key={field.key}>
                  <th scope="row">{field.label}</th>
                  <td>{cell?.value ?? '—'}</td>
                  <td>
                    {cell ? (
                      <Badge tone={STATUS[cell.status].tone}>{STATUS[cell.status].label}</Badge>
                    ) : (
                      'Chưa chạy'
                    )}
                    {cell && isStale(cell, project) && <Badge tone="warning">Đã cũ</Badge>}
                  </td>
                  <td>
                    {cell && (
                      <Button size="sm" onClick={() => setOpen(field.key)}>
                        Bằng chứng
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {panel === 'columns' && (
        <AddColumns
          project={project}
          onClose={() => setPanel(null)}
          onAdd={(added) => void save(addFields(project, added))}
        />
      )}
      {panel === 'run' && (
        <RunPanel
          project={paperProject}
          onClose={() => setPanel(null)}
          onStart={(choice) => {
            setPanel(null);
            void run(choice);
          }}
        />
      )}
      {opened && openedField && paperRow && (
        <CellDrawer
          key={opened.fieldKey}
          cell={opened}
          field={openedField}
          paper={paperRow}
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
