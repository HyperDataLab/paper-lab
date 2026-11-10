import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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
  const [error, setError] = useState('');
  useEffect(() => {
    void repo.extraction
      .list()
      .then(setProjects)
      .catch((cause: unknown) => setError(String(cause)));
  }, [repo]);
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
      <h1>Trích xuất</h1>
      <p className={styles.note}>
        So sánh nhiều bài báo trong một bảng: mỗi hàng là một bài, mỗi cột là một thông tin cần trích, mỗi ô
        kèm trích dẫn trong bài để kiểm chứng.
      </p>
      <Card>
        <h2>Project mới</h2>
        <div className={styles.form}>
          <TextField label="Tên project" value={title} onChange={(event) => setTitle(event.target.value)} />
          <TextField
            label="Câu hỏi nghiên cứu (không bắt buộc)"
            multiline
            rows={2}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
          />
          <div>
            <Button variant="primary" disabled={!title.trim()} onClick={() => void create()}>
              Tạo project
            </Button>
          </div>
        </div>
      </Card>
      {error && <p role="alert">{error}</p>}
      <h2>Các project</h2>
      {!projects ? (
        <p>Đang tải…</p>
      ) : projects.length === 0 ? (
        <p>Chưa có project nào.</p>
      ) : (
        <ul className={styles.list}>
          {projects.map((project) => (
            <li key={project.id}>
              <Card padding="md">
                <Link className={styles.title} to={`/extraction/${project.id}`}>
                  {project.title}
                </Link>
                <p className={styles.note}>
                  {project.papers.length} bài · {project.fields.filter((field) => !field.hidden).length} cột ·{' '}
                  {project.cells.filter((cell) => cell.status === 'VERIFIED').length} ô đã xác nhận · cập nhật{' '}
                  {new Date(project.updatedAt).toLocaleString('vi-VN')}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
