import { Plus, Table2 } from 'lucide-react';
import { ItemCard, ItemGrid } from '@/shared/ui/ItemCard';
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
        <ItemGrid label="Các project">
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
                    { label: 'Bài', value: project.papers },
                    { label: 'Cột', value: columns },
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
        </ItemGrid>
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
