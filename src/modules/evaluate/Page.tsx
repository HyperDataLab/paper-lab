import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { analyzeText } from '@/core/text';
import type { TextAnalysis } from '@/core/schemas';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { EmptyState } from '@/shared/ui/EmptyState';
import { Skeleton } from '@/shared/ui/Skeleton';
import styles from './page.module.css';
import { AnalysisResult } from './AnalysisResult';

export default function Page() {
  const repositories = useRepositories();
  const [params, setParams] = useSearchParams();
  const id = params.get('id');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const saveInFlight = useRef(false);
  const [text, setText] = useState('');
  const [result, setResult] = useState<TextAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!id) return;
    let active = true;
    repositories.analyses
      .get(id)
      .then((value) => {
        if (!active) return;
        if (!value) throw new Error('Analysis not found');
        setText(value.text.sourceText);
        setResult(value.text);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      active = false;
    };
  }, [id, repositories, retry]);
  async function save() {
    if (!result || saved || saveInFlight.current) return;
    saveInFlight.current = true;
    setSaving(true);
    try {
      await repositories.analyses.create({
        text: result,
        title: Array.from(result.sourceText).slice(0, 60).join(''),
      });
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  }
  async function run() {
    setLoading(true);
    setError(null);
    setSaved(false);
    try {
      setResult(await analyzeText(text));
    } catch (cause) {
      setResult(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className={styles.page}>
      <h1>Đánh giá</h1>
      <Card>
        <label htmlFor="paragraph">Dán một đoạn văn tiếng Anh</label>
        <textarea
          id="paragraph"
          value={text}
          disabled={!!id}
          onChange={(event) => {
            setText(event.target.value);
            setResult(null);
            setSaved(false);
          }}
          rows={7}
        />
        {id ? (
          <Button
            onClick={() => {
              setParams({});
              setText('');
              setResult(null);
              setError(null);
              setSaved(false);
            }}
          >
            Tạo bản phân tích mới
          </Button>
        ) : (
          <Button type="button" disabled={loading} onClick={() => void run()}>
            Tách câu
          </Button>
        )}
      </Card>
      {loading ? (
        <Skeleton />
      ) : error ? (
        <Card>
          <p role="alert">
            {id ? 'Không tìm thấy bản phân tích này.' : 'Không thể tách câu. Vui lòng thử lại.'}
          </p>
          <Button onClick={() => (id ? setRetry((value) => value + 1) : void run())}>Thử lại</Button>{' '}
          {id && <Link to="/history">Quay lại Lịch sử</Link>}
          <details>
            <summary>Chi tiết kỹ thuật</summary>
            <code>{error}</code>
          </details>
        </Card>
      ) : result && result.sentences.length > 0 ? (
        <AnalysisResult
          result={result}
          readOnly={!!id}
          saved={saved}
          saving={saving}
          onSave={() => void save()}
        />
      ) : (
        <EmptyState
          title="Chưa có câu"
          description="Dán đoạn văn và chọn Tách câu để xem kết quả."
          detail="Văn bản được xử lý trên thiết bị của bạn."
        />
      )}
    </div>
  );
}
