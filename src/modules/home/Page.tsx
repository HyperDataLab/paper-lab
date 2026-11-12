import { ArrowRight, FileText, Library, PenLine, Plus, Search, Table2, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { newProject } from '@/core/extraction';
import { paperIdentity } from '@/core/paperIdentity';
import type { ExtractionProject, Paper } from '@/core/schemas';
import { useAuth } from '@/shared/auth/authContext';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { Button } from '@/shared/ui/Button';
import { Loading } from '@/shared/ui/StateNote';
import { TextField } from '@/shared/ui/TextField';
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

function greeting(now = new Date()) {
  const hour = now.getHours();
  return hour < 11
    ? 'Chào buổi sáng'
    : hour < 14
      ? 'Chào buổi trưa'
      : hour < 18
        ? 'Chào buổi chiều'
        : 'Chào buổi tối';
}

export default function Page() {
  const repo = useRepositories();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [question, setQuestion] = useState('');
  const [papers, setPapers] = useState<Paper[] | null>(null);
  const [projects, setProjects] = useState<ExtractionProject[] | null>(null);
  const [counts, setCounts] = useState<{ papers: number; projects: number; corpora: number } | null>(null);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  useEffect(() => {
    void Promise.all([
      repo.papers.list(),
      repo.extraction.list(),
      repo.paperContext.list(),
      repo.corpora.list().catch(() => []),
    ])
      .then(([savedPapers, savedProjects, contexts, corpora]) => {
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
        setCounts({ papers: savedPapers.length, projects: savedProjects.length, corpora: corpora.length });
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
  const firstName = user?.name?.trim().split(/\s+/).at(-1);
  return (
    <div className={styles.home}>
      <header className={styles.hero}>
        <div>
          <h1>
            {greeting()}
            {firstName ? `, ${firstName}` : ''}
          </h1>
          <p className={styles.muted}>
            Đọc bài, trích xuất dữ liệu và kiểm tra đoạn văn. Mọi thứ lưu trên máy này.
          </p>
        </div>
        <div className={styles.heroActions}>
          <Link to="/extraction" className={styles.secondaryLink}>
            <Plus size={16} aria-hidden="true" />
            Project mới
          </Link>
          <Link to="/papers" className={styles.primaryLink}>
            <Upload size={16} aria-hidden="true" />
            Nhập bài báo
          </Link>
        </div>
      </header>

      <section aria-labelledby="home-workflows">
        <h2 id="home-workflows" className={styles.srOnly}>
          Lối tắt
        </h2>
        <ul className={styles.tasks}>
          {WORKFLOWS.map((item) => (
            <li key={item.title}>
              <Link to={item.to} className={styles.task}>
                <span className={styles.taskIcon} aria-hidden="true">
                  <item.icon size={20} />
                </span>
                <strong>{item.title}</strong>
                <small>{item.text}</small>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {counts && (
        <dl className={styles.stats} aria-label="Dữ liệu trên máy này">
          <div>
            <dt>
              <FileText size={16} aria-hidden="true" /> Bài báo
            </dt>
            <dd>{counts.papers}</dd>
          </div>
          <div>
            <dt>
              <Table2 size={16} aria-hidden="true" /> Project trích xuất
            </dt>
            <dd>{counts.projects}</dd>
          </div>
          <div>
            <dt>
              <Library size={16} aria-hidden="true" /> Corpus
            </dt>
            <dd>{counts.corpora}</dd>
          </div>
        </dl>
      )}

      <div className={styles.columns}>
        <section aria-labelledby="home-papers" className={styles.card}>
          <div className={styles.cardHead}>
            <div>
              <h2 id="home-papers">Tiếp tục đọc</h2>
              <p className={styles.muted}>Bài mở gần đây; phân tích dở dang chạy tiếp từ chỗ đã dừng.</p>
            </div>
            <Link to="/papers" className={styles.more}>
              Tất cả bài báo
              <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </div>
          {!papers ? (
            <Loading label="Đang tải…" />
          ) : papers.length === 0 ? (
            <Link to="/papers" className={styles.importCta}>
              <span className={styles.taskIcon} aria-hidden="true">
                <Upload size={20} />
              </span>
              <span>
                <strong>Chưa có bài nào.</strong> Nhập bài đầu tiên
                <small>PDF, LaTeX hoặc Markdown. Tệp được tách ngay trên máy này.</small>
              </span>
            </Link>
          ) : (
            <ul className={styles.papers}>
              {papers.map((paper) => (
                <li key={paper.id}>
                  <Link to={`/papers/${paper.id}`} className={styles.paper}>
                    <span className={styles.paperIcon} aria-hidden="true">
                      <FileText size={18} />
                    </span>
                    <span className={styles.paperText}>
                      <strong>{paper.title}</strong>
                      <small>
                        {paper.source.pageCount ? `${paper.source.pageCount} trang, ` : ''}
                        {paper.sections.length} mục
                      </small>
                    </span>
                    <span className={styles.paperDate}>{date(paper.updatedAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className={styles.side}>
          <section aria-labelledby="home-ask" className={styles.card}>
            <h2 id="home-ask">Bắt đầu từ một câu hỏi</h2>
            <p className={styles.muted}>
              Câu hỏi mở một project: tìm bài, trích vào bảng, tổng hợp có trích dẫn.
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
                hideLabel
                placeholder="Ví dụ: Phản biện bằng AI có kém đa dạng hơn phản biện của người không?"
                multiline
                rows={3}
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
              />
              <Button variant="primary" type="submit" disabled={!question.trim() || starting}>
                {starting ? 'Đang tạo project…' : 'Bắt đầu project'}
              </Button>
            </form>
            {error && <p role="alert">{error}</p>}
          </section>

          <section aria-labelledby="home-projects" className={styles.card}>
            <div className={styles.cardHead}>
              <h2 id="home-projects">Project gần đây</h2>
              <Link to="/extraction" className={styles.more}>
                Tất cả
                <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </div>
            {!projects ? (
              <Loading label="Đang tải…" />
            ) : projects.length === 0 ? (
              <p className={styles.muted}>Chưa có project nào.</p>
            ) : (
              <ul className={styles.projects}>
                {projects.map((project) => (
                  <li key={project.id}>
                    <Link to={`/extraction/${project.id}`} className={styles.project}>
                      <span className={styles.paperIcon} aria-hidden="true">
                        <Table2 size={18} />
                      </span>
                      <span className={styles.paperText}>
                        <strong>{project.title}</strong>
                        <small>
                          {project.papers.length} bài,{' '}
                          {project.fields.filter((field) => !field.hidden).length} cột, sửa{' '}
                          {date(project.updatedAt)}
                        </small>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
