import { Plus, Table2 } from 'lucide-react';
import { ItemCard } from '@/shared/ui/ItemCard';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { newProject } from '@/core/extraction';
import type { ExtractionProjectSummary } from '@/shared/storage/extractionProjects';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { Button } from '@/shared/ui/Button';
import { Dialog, DialogActions } from '@/shared/ui/Dialog';
import { PageHeader } from '@/shared/ui/PageHeader';
import { TextField } from '@/shared/ui/TextField';
import styles from './extraction.module.css';
import { Empty, Loading } from '@/shared/ui/StateNote';

export default function Page() {
  const repo = useRepositories();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ExtractionProjectSummary[] | null>(null);
  const [title, setTitle] = useState('');
  const [question, setQuestion] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState<ExtractionProjectSummary | null>(null);
  useEffect(() => {
    void repo.extraction
      .listSummaries()
      .then(setProjects)
      .catch((cause: unknown) => setError(String(cause)));
  }, [repo]);
  /** A copy keeps the question, columns, papers and extracted cells under a new name. */
  async function duplicate(id: string) {
    try {
      const project = await repo.extraction.get(id);
      if (!project) throw new Error('Không tìm thấy project.');
      await repo.extraction.save({
        ...project,
        id: crypto.randomUUID(),
        title: `${project.title} (bản sao)`,
        createdAt: new Date().toISOString(),
      });
      setProjects(await repo.extraction.listSummaries());
    } catch (cause) {
      setError(String(cause));
    }
  }
  async function create() {
    try {
      const project = await repo.extraction.save(
        newProject({
          id: crypto.randomUUID(),
          title,
          researchQuestion: question,
          now: new Date().toISOString(),
        }),
      );
      navigate(`/extraction/${project.id}`);
    } catch (cause) {
      setError(String(cause));
    }
  }
  const overview = projects
    ? projects.reduce(
        (summary, project) => {
          summary.papers += project.papers;
          summary.columns += project.visibleFields;
          summary.verified += project.verified;
          summary.cells += project.papers * project.visibleFields;
          return summary;
        },
        { papers: 0, columns: 0, verified: 0, cells: 0 },
      )
    : null;
  return (
    <div className={styles.page}>
      <PageHeader
        title="Projects"
        lead="So sánh nhiều bài trong một bảng: mỗi hàng là một bài, mỗi cột là một thông tin cần trích, mỗi ô kèm trích dẫn để kiểm chứng."
      >
        <Button
          variant="primary"
          leadingIcon={<Plus size={16} aria-hidden="true" />}
          onClick={() => setCreating(true)}
        >
          Project mới
        </Button>
      </PageHeader>
      {error && <p role="alert">{error}</p>}
      {!projects ? (
        <Loading label="Đang tải…" />
      ) : projects.length === 0 ? (
        <Empty title="Chưa có project nào." hint="Project bạn tạo sẽ hiện ở đây.">
          <Button onClick={() => setCreating(true)}>Tạo project đầu tiên</Button>
        </Empty>
      ) : (
        <div className={styles.projectDashboard}>
          <section className={styles.projectCollection} aria-labelledby="project-list-title">
            <div className={styles.collectionHeading}>
              <div>
                <h2 id="project-list-title">Dự án nghiên cứu</h2>
                <p>Mở một project để tiếp tục trích xuất và đối chiếu bằng chứng.</p>
              </div>
              <span className={styles.collectionCount}>
                {projects.length} {projects.length === 1 ? 'project' : 'projects'}
              </span>
            </div>
            <ul className={styles.projectCards} aria-label="Các project">
              {projects.map((project) => {
                const { visibleFields: columns, verified } = project;
                const total = project.papers * columns;
                return (
                  <li key={project.id}>
                    <ItemCard
                      to={`/extraction/${project.id}`}
                      icon={<Table2 size={20} />}
                      title={project.title}
                      description={project.researchQuestion}
                      stats={[
                        { label: 'Bài báo', value: project.papers },
                        { label: 'Trường dữ liệu', value: columns },
                        { label: 'Đã xác nhận', value: verified },
                      ]}
                      progress={
                        total
                          ? { value: verified, max: total, label: `Đã xác nhận ${verified}/${total} ô` }
                          : undefined
                      }
                      footer={<span>Cập nhật {new Date(project.updatedAt).toLocaleDateString('vi-VN')}</span>}
                      actions={[
                        { label: 'Mở', onSelect: () => navigate(`/extraction/${project.id}`) },
                        { label: 'Nhân bản', onSelect: () => void duplicate(project.id) },
                        { label: 'Xoá', danger: true, onSelect: () => setRemoving(project) },
                      ]}
                    />
                  </li>
                );
              })}
            </ul>
          </section>
          {overview && (
            <aside className={styles.projectOverview} aria-labelledby="project-overview-title">
              <div className={styles.overviewHeading}>
                <span className={styles.overviewIcon} aria-hidden="true">
                  <Table2 size={18} />
                </span>
                <div>
                  <h2 id="project-overview-title">Tổng quan workspace</h2>
                  <p>Tiến độ trên tất cả project</p>
                </div>
              </div>
              <dl className={styles.overviewStats}>
                <div>
                  <dt>Projects</dt>
                  <dd>{projects.length}</dd>
                </div>
                <div>
                  <dt>Bài báo</dt>
                  <dd>{overview.papers}</dd>
                </div>
                <div>
                  <dt>Trường dữ liệu</dt>
                  <dd>{overview.columns}</dd>
                </div>
              </dl>
              <div className={styles.overviewProgress}>
                <div>
                  <span>Ô đã xác nhận</span>
                  <strong>
                    {overview.verified} <span>/ {overview.cells}</span>
                  </strong>
                </div>
                {overview.cells > 0 && (
                  <div
                    className={styles.progressTrack}
                    role="progressbar"
                    aria-label="Tiến độ xác nhận workspace"
                    aria-valuenow={Math.min(overview.verified, overview.cells)}
                    aria-valuemin={0}
                    aria-valuemax={overview.cells}
                  >
                    <span
                      style={{ width: `${Math.min(100, (overview.verified / overview.cells) * 100)}%` }}
                    />
                  </div>
                )}
              </div>
              <div className={styles.workflowNote}>
                <h3>Quy trình làm việc</h3>
                <ol>
                  <li>Thêm bài báo vào project.</li>
                  <li>Chọn thông tin cần trích xuất.</li>
                  <li>Kiểm tra trích dẫn trước khi xác nhận.</li>
                </ol>
              </div>
            </aside>
          )}
        </div>
      )}
      {creating && (
        <Dialog
          kind="form"
          title="Tạo project"
          description="Đặt tên project. research question giúp chọn cột và bài, có thể thêm sau."
          onClose={() => setCreating(false)}
        >
          <form
            className={styles.projectForm}
            onSubmit={(event) => {
              event.preventDefault();
              if (title.trim()) void create();
            }}
          >
            <TextField
              label="Tên project"
              placeholder="Ví dụ: AI trong giáo dục"
              value={title}
              data-dialog-initial-focus
              onChange={(event) => setTitle(event.target.value)}
            />
            <TextField
              label="Research question (không bắt buộc)"
              placeholder="Bạn muốn tìm hiểu điều gì qua các bài báo?"
              multiline
              rows={3}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
            />
            <DialogActions>
              <Button variant="ghost" onClick={() => setCreating(false)}>
                Huỷ
              </Button>
              <Button variant="primary" type="submit" disabled={!title.trim()}>
                Tạo project
              </Button>
            </DialogActions>
          </form>
        </Dialog>
      )}
      {removing && (
        <Dialog
          title="Xoá project này?"
          description={`Project “${removing.title}” cùng các cột và ô đã trích sẽ bị xoá. Bài báo không bị xoá.`}
          onClose={() => setRemoving(null)}
        >
          <DialogActions>
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              Huỷ
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const target = removing;
                setRemoving(null);
                void repo.extraction
                  .remove(target.id)
                  .then(() => repo.extraction.listSummaries())
                  .then(setProjects)
                  .catch((cause: unknown) => setError(String(cause)));
              }}
            >
              Xoá project
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </div>
  );
}
