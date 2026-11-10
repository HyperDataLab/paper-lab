import { ArrowRight, FileText, PenLine, Search, Table2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { newProject } from '@/core/extraction';
import { paperIdentity } from '@/core/paperIdentity';
import type { ExtractionProject, Paper } from '@/core/schemas';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { Button } from '@/shared/ui/Button';
import { TextField } from '@/shared/ui/TextField';
import { FeatureCard } from './FeatureCard';
import styles from './home.module.css';

const WORKFLOWS = [
  {
    to: '/papers',
    icon: FileText,
    title: 'Hiểu một bài báo',
    text: 'Đọc PDF, xem hồ sơ và phân tích bài.',
  },
  {
    to: '/extraction',
    icon: Table2,
    title: 'Trích xuất dữ liệu nhiều bài',
    text: 'So sánh nhiều bài bằng bảng có dẫn chứng.',
  },
  {
    to: '/extraction',
    icon: Search,
    title: 'Tìm và sàng lọc bài',
    text: 'Tìm trên OpenAlex, sàng lọc và tổng hợp.',
  },
  {
    to: '/evaluate',
    icon: PenLine,
    title: 'Kiểm tra đoạn văn của bạn',
    text: 'Đánh giá, sửa hoặc tạo đoạn học thuật.',
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
  const [starting, setStarting] = useState(false);
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
    if (!text || starting) return;
    setStarting(true);
    setError('');
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
    } finally {
      setStarting(false);
    }
  }
  return (
    <div className={styles.home}>
      <header className={styles.hero}>
        <h1>Bạn đang tìm hiểu câu hỏi nào?</h1>
        <p className={styles.lead}>
          Nêu câu hỏi nghiên cứu để mở một project: tìm bài, trích xuất vào bảng và tổng hợp có trích dẫn.
        </p>
        <form
          className={styles.ask}
          aria-busy={starting}
          onSubmit={(event) => {
            event.preventDefault();
            void start();
          }}
        >
          <TextField
            label="Câu hỏi nghiên cứu"
            hint="Câu hỏi sẽ được dùng làm tiêu đề project."
            placeholder="Ví dụ: Phản biện bằng AI có kém đa dạng hơn phản biện của người không?"
            multiline
            rows={2}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
          />
          <div className={styles.askFooter}>
            <p className={styles.askNote}>Tìm kiếm và sàng lọc bài nằm trong tab Deep Research.</p>
            <Button variant="primary" type="submit" disabled={!question.trim() || starting}>
              {starting ? 'Đang tạo project…' : 'Bắt đầu project'}
              {!starting && <ArrowRight size={16} aria-hidden="true" />}
            </Button>
          </div>
        </form>
        {error && <p role="alert">{error}</p>}
      </header>

      <section aria-labelledby="home-workflows" className={styles.workflows}>
        <div className={styles.sectionIntro}>
          <h2 id="home-workflows">Lối tắt</h2>
          <p>Chọn một tác vụ để tiếp tục.</p>
        </div>
        <ul className={styles.tiles}>
          {WORKFLOWS.map((item) => (
            <li key={item.title}>
              <FeatureCard to={item.to} icon={item.icon} title={item.title} description={item.text} />
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
            <p className={styles.muted}>Đang tải…</p>
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
            <p className={styles.muted}>Đang tải…</p>
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
