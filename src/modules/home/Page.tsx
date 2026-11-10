import { ArrowRight, FileText, PenLine, Search, Table2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { newProject } from '@/core/extraction';
import { paperIdentity } from '@/core/paperIdentity';
import type { ExtractionProject, Paper } from '@/core/schemas';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { Button } from '@/shared/ui/Button';
import { TextField } from '@/shared/ui/TextField';
import styles from './home.module.css';
import { Loading } from '@/shared/ui/StateNote';

const WORKFLOWS = [
  {
    to: '/papers',
    icon: FileText,
    title: 'Hiểu một bài báo',
    text: 'Nhập PDF, xem hồ sơ 5 chiều, Snapshot và metadata của bài.',
  },
  {
    to: '/extraction',
    icon: Table2,
    title: 'Trích xuất dữ liệu nhiều bài',
    text: 'So sánh các bài trong một bảng; mỗi ô kèm đoạn trích để kiểm chứng.',
  },
  {
    to: '/extraction',
    icon: Search,
    title: 'Tìm và sàng lọc bài',
    text: 'Lập kế hoạch tìm, tìm trên OpenAlex, sàng lọc rồi tổng hợp liên bài.',
  },
  {
    to: '/evaluate',
    icon: PenLine,
    title: 'Kiểm tra đoạn văn của bạn',
    text: 'Phân tích cấu trúc, mạch văn và từ ngữ của một đoạn văn học thuật.',
  },
];
const RECENT = 5;
const date = (iso: string) => new Date(iso).toLocaleDateString('vi-VN');

export default function Page() {
  const repo = useRepositories();
  const navigate = useNavigate();
  const [question, setQuestion] = useState('');
  const [papers, setPapers] = useState<Paper[] | null>(null);
  const [projects, setProjects] = useState<ExtractionProject[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    void Promise.all([repo.papers.list(), repo.extraction.list(), repo.paperContext.list()])
      .then(([savedPapers, savedProjects, contexts]) => {
        setPapers(
          [...savedPapers]
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .slice(0, RECENT)
            .map((paper) => ({
              ...paper,
              title: paperIdentity(paper, {
                metadata: contexts.find((item) => item.paperId === paper.id)?.metadata,
              }).title,
            })),
        );
        setProjects(savedProjects.slice(0, RECENT));
      })
      .catch((cause: unknown) => setError(String(cause)));
  }, [repo]);
  async function start() {
    const text = question.trim();
    if (!text) return;
    try {
      const project = await repo.extraction.save(
        newProject({
          id: crypto.randomUUID(),
          title: Array.from(text).slice(0, 80).join(''),
          researchQuestion: text,
          now: new Date().toISOString(),
        }),
      );
      navigate(`/extraction/${project.id}`);
    } catch (cause) {
      setError(String(cause));
    }
  }
  return (
    <div className={styles.home}>
      <header className={styles.hero}>
        <h1>Bạn đang tìm hiểu câu hỏi nào?</h1>
        <p className={styles.lead}>
          Nêu câu hỏi nghiên cứu để mở một project: tìm bài, trích xuất vào bảng và tổng hợp có trích dẫn.
        </p>
        <div className={styles.ask}>
          <TextField
            label="Câu hỏi nghiên cứu"
            placeholder="Ví dụ: Phản biện bằng AI có kém đa dạng hơn phản biện của người không?"
            multiline
            rows={2}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
          />
          <Button variant="primary" disabled={!question.trim()} onClick={() => void start()}>
            Bắt đầu project <ArrowRight size={16} aria-hidden="true" />
          </Button>
        </div>
        {error && <p role="alert">{error}</p>}
      </header>

      <section aria-labelledby="home-workflows">
        <h2 id="home-workflows">Hoặc chọn việc cần làm</h2>
        <ul className={styles.tiles}>
          {WORKFLOWS.map((item) => (
            <li key={item.title}>
              <Link to={item.to} className={styles.tile}>
                <item.icon size={20} aria-hidden="true" />
                <strong>{item.title}</strong>
                <span>{item.text}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <div className={styles.recent}>
        <section aria-labelledby="home-papers">
          <div className={styles.sectionHead}>
            <h2 id="home-papers">Bài báo gần đây</h2>
            <Link to="/papers">Tất cả bài báo</Link>
          </div>
          {!papers ? (
            <Loading label="Đang tải…" />
          ) : papers.length === 0 ? (
            <p className={styles.muted}>
              Chưa có bài nào. <Link to="/papers">Nhập bài đầu tiên</Link>.
            </p>
          ) : (
            <ul className={styles.rows}>
              {papers.map((paper) => (
                <li key={paper.id}>
                  <Link to={`/papers/${paper.id}`} className={styles.row}>
                    <strong>{paper.title}</strong>
                    <span>
                      {paper.sections.length} mục · {date(paper.updatedAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-labelledby="home-projects">
          <div className={styles.sectionHead}>
            <h2 id="home-projects">Project trích xuất gần đây</h2>
            <Link to="/extraction">Tất cả project</Link>
          </div>
          {!projects ? (
            <Loading label="Đang tải…" />
          ) : projects.length === 0 ? (
            <p className={styles.muted}>Chưa có project nào. Nêu một câu hỏi ở trên để bắt đầu.</p>
          ) : (
            <ul className={styles.rows}>
              {projects.map((project) => (
                <li key={project.id}>
                  <Link to={`/extraction/${project.id}`} className={styles.row}>
                    <strong>{project.title}</strong>
                    <span>
                      {project.papers.length} bài · {project.fields.filter((field) => !field.hidden).length}{' '}
                      cột · {date(project.updatedAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
