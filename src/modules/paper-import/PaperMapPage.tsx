import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { SectionSchema, type Paper, type Section } from '@/core/schemas';
import { analyzeText } from '@/core/text';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { Select } from '@/shared/ui/Select';
import styles from './page.module.css';

export default function PaperMapPage() {
  const { id } = useParams();
  const repo = useRepositories();
  const navigate = useNavigate();
  const [paper, setPaper] = useState<Paper | null>(null);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [counts, setCounts] = useState<{ sentences: number; words: number } | null>(null);
  useEffect(() => {
    let active = true;
    if (!id) return;
    void repo.papers
      .get(id)
      .then((value) => {
        if (!active) return;
        setPaper(value ?? null);
        setSelected(value?.sections[0]?.id ?? '');
        setLoading(false);
        if (value)
          void Promise.all(value.paragraphs.filter((p) => p.kind === 'body').map((p) => analyzeText(p.text)))
            .then((analyses) => {
              if (active)
                setCounts({
                  sentences: analyses.reduce((n, a) => n + a.sentences.length, 0),
                  words: analyses.reduce((n, a) => n + a.tokens.filter((t) => t.kind === 'word').length, 0),
                });
            })
            .catch((cause: unknown) => {
              if (active) setError(String(cause));
            });
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(String(cause));
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [id, repo]);
  async function editRole(role: Section['role']) {
    if (!paper) return;
    try {
      setPaper(await repo.papers.editRole(paper.id, selected, role));
    } catch (cause) {
      setError(String(cause));
    }
  }
  if (loading) return <p>Đang tải bài báo…</p>;
  if (!paper)
    return (
      <div>
        <p role="alert">Không tìm thấy bài báo.</p>
        <Link to="/papers">Quay lại danh sách</Link>
        {error && (
          <details>
            <summary>Chi tiết kỹ thuật</summary>
            {error}
          </details>
        )}
      </div>
    );
  const section = paper.sections.find((item) => item.id === selected);
  const bodyCount = paper.paragraphs.filter((item) => item.kind === 'body').length;
  const roles = paper.sections.reduce<Partial<Record<Section['role'], number>>>((result, item) => {
    result[item.role] = (result[item.role] ?? 0) + 1;
    return result;
  }, {});
  return (
    <div className={styles.page}>
      <Link to="/papers">← Bài báo đã nhập</Link>
      <h1>{paper.title}</h1>
      <Card>Phân tích hàng loạt và AI review sẽ có trong các giai đoạn sau.</Card>
      {error && (
        <div role="alert">
          Không thể xử lý bài báo.
          <details>
            <summary>Chi tiết kỹ thuật</summary>
            {error}
          </details>
        </div>
      )}
      <div className={styles.map}>
        <Card>
          <h2>Mục</h2>
          <div className={styles.outline}>
            {paper.sections.map((item) => (
              <Button key={item.id} aria-pressed={selected === item.id} onClick={() => setSelected(item.id)}>
                <span>
                  <Badge>{item.role}</Badge> {item.heading} (
                  {paper.paragraphs.filter((p) => p.sectionId === item.id).length})
                </span>
              </Button>
            ))}
          </div>
        </Card>
        <Card>
          {section ? (
            <>
              <h2>{section.heading}</h2>
              <Select
                label="Vai trò của mục"
                value={section.role}
                onChange={(event) => {
                  const role = SectionSchema.shape.role.safeParse(event.target.value);
                  if (role.success) void editRole(role.data);
                }}
              >
                {SectionSchema.shape.role.options.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </Select>
              {paper.paragraphs
                .filter((item) => item.sectionId === section.id)
                .map((item) => (
                  <div
                    key={item.id}
                    className={`${styles.paragraph} ${['caption', 'equation', 'reference', 'footnote'].includes(item.kind) ? styles.muted : ''}`}
                  >
                    <span>{item.id} </span>
                    <Badge>{item.kind}</Badge>
                    <p className={styles.reading}>{item.text}</p>
                    {item.kind === 'body' && (
                      <Button onClick={() => navigate('/evaluate', { state: { prefill: item.text } })}>
                        Đánh giá đoạn này
                      </Button>
                    )}
                  </div>
                ))}
            </>
          ) : (
            <p>Không có mục nào.</p>
          )}
        </Card>
        <Card>
          <h2>Tóm tắt</h2>
          <p>
            {paper.source.pageCount ?? 'Không rõ'} trang · {bodyCount} đoạn nội dung
          </p>
          <p>{counts ? `${counts.sentences} câu · ${counts.words} từ` : 'Đang đếm câu và từ…'}</p>
          <h3>Số mục theo vai trò</h3>
          <ul>
            {Object.entries(roles).map(([role, count]) => (
              <li key={role}>
                {role}: {count}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
