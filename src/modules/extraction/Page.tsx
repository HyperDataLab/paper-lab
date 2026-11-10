import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, LoaderCircle, Plus } from 'lucide-react';
import { newProject } from '@/core/extraction';
import type { ExtractionProject } from '@/core/schemas';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { TextField } from '@/shared/ui/TextField';
import styles from './extraction.module.css';

export default function Page() {
  const repo = useRepositories();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ExtractionProject[] | null>(null);
  const [title, setTitle] = useState('');
  const [question, setQuestion] = useState('');
  const [titleError, setTitleError] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const titleInput = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);
  useEffect(() => {
    void repo.extraction
      .list()
      .then(setProjects)
      .catch((cause: unknown) => setError(String(cause)));
  }, [repo]);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    if (!title.trim()) {
      setTitleError('Vui lòng nhập tên project.');
      titleInput.current?.focus();
      return;
    }
    submitting.current = true;
    setCreating(true);
    setError('');
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
    } finally {
      submitting.current = false;
      setCreating(false);
    }
  }
  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <h1>Trích xuất</h1>
        <p className={styles.note}>
          So sánh nhiều bài báo trong một bảng; mỗi ô dữ liệu đều có trích dẫn để bạn kiểm chứng.
        </p>
      </header>

      <div className={styles.createPanel}>
        <Card padding="md">
          <div className={styles.createHead}>
            <div>
              <h2>Project mới</h2>
              <p className={styles.note}>Đặt tên và xác định câu hỏi dẫn dắt việc trích xuất.</p>
            </div>
          </div>
          <form
            className={styles.projectForm}
            aria-busy={creating}
            noValidate
            onSubmit={(event) => void create(event)}
          >
            <div className={styles.projectField}>
              <TextField
                ref={titleInput}
                label="Tên project"
                placeholder="Ví dụ: AI trong giáo dục"
                value={title}
                required
                error={titleError || undefined}
                onChange={(event) => {
                  setTitle(event.target.value);
                  if (event.target.value.trim()) setTitleError('');
                }}
              />
            </div>
            <div className={styles.projectField}>
              <TextField
                label="Câu hỏi nghiên cứu (không bắt buộc)"
                placeholder="Bạn muốn tìm hiểu điều gì qua các bài báo?"
                multiline
                rows={2}
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
              />
            </div>
            <div className={styles.formFooter}>
              <Button className={styles.createButton} variant="primary" type="submit" disabled={creating}>
                {creating ? (
                  <>
                    <LoaderCircle className={styles.spinner} size={16} aria-hidden="true" />
                    Đang tạo…
                  </>
                ) : (
                  <>
                    <Plus size={16} aria-hidden="true" />
                    Tạo project
                  </>
                )}
              </Button>
            </div>
          </form>
        </Card>
      </div>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <section className={styles.projectSection} aria-labelledby="extraction-projects-title">
        <header className={styles.sectionHead}>
          <h2 id="extraction-projects-title">Các project</h2>
          {projects && <span className={styles.projectCount}>{projects.length}</span>}
        </header>
        {!projects ? (
          <p className={styles.stateMessage} role="status">
            Đang tải project…
          </p>
        ) : projects.length === 0 ? (
          <p className={styles.stateMessage}>Chưa có project nào. Tạo project đầu tiên ở phía trên.</p>
        ) : (
          <ul className={styles.list}>
            {projects.map((project) => (
              <li key={project.id}>
                <Link className={styles.projectRow} to={`/extraction/${project.id}`}>
                  <span className={styles.projectCopy}>
                    <span className={styles.projectTitle}>{project.title}</span>
                    <span className={styles.projectSummary}>
                      {project.papers.length} bài · {project.fields.filter((field) => !field.hidden).length}{' '}
                      cột · {project.cells.filter((cell) => cell.status === 'VERIFIED').length} ô đã xác nhận
                    </span>
                  </span>
                  <span className={styles.projectMeta}>
                    <span>Cập nhật {new Date(project.updatedAt).toLocaleString('vi-VN')}</span>
                    <ArrowRight size={17} aria-hidden="true" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
