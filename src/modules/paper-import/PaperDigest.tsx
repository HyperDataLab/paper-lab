import { useEffect, useState } from 'react';
import type { FindingLocation } from '@/core/paperFindings';
import type { DigestItem, DigestText, Paper, PaperInsightsRecord } from '@/core/schemas';
import { describeLlmError } from '@/shared/llm/describeError';
import { useLlm } from '@/shared/llm/LlmProvider';
import { llmDigest } from '@/shared/llm/llmDigest';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { Loading } from '@/shared/ui/StateNote';
import { useStoredChanged } from './paperJobs';
import styles from './digest.module.css';

const FLAGS = {
  no_source: 'Không rõ nguồn',
  number_not_in_source: 'Số chưa đối chiếu được',
} as const;

/**
 * The paper retold section by section, as a reader's summary: one AI request writes it from the whole paper,
 * and code checks every part against the paragraphs it cites. Each part offers the page it comes from.
 */
export function PaperDigest({
  paper,
  onLocation,
}: {
  paper: Paper;
  onLocation: (location: FindingLocation) => void;
}) {
  const repo = useRepositories();
  const llm = useLlm();
  const notifyStoredChanged = useStoredChanged();
  const [record, setRecord] = useState<PaperInsightsRecord>();
  const [loaded, setLoaded] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void repo.paperInsights.get(paper.id).then((value) => {
      if (!active) return;
      setRecord(value);
      setLoaded(true);
    });
    return () => {
      active = false;
    };
  }, [paper.id, repo]);
  const run = record?.digestRuns.at(-1);

  async function start() {
    setRunning(true);
    setError('');
    try {
      if (!(await llm.ensureConsent('paper'))) return;
      const result = await llmDigest(llm.client, paper, { config: llm.config });
      setRecord(await repo.paperInsights.saveDigestRun(paper.id, result));
      notifyStoredChanged();
    } catch (cause) {
      setError(describeLlmError(cause) ?? 'Không tóm tắt được bài.');
    } finally {
      setRunning(false);
    }
  }

  /** The pages a part comes from, each opening its paragraph; and what code could not check. */
  const sources = (part: DigestText | DigestItem) => (
    <span className={styles.sources}>
      {part.sources.map((source) => {
        const paragraph = paper.paragraphs.find((item) => item.id === source.paragraphId);
        if (!paragraph) return null;
        return (
          <Button
            key={source.paragraphId}
            size="sm"
            variant="ghost"
            className={styles.page}
            title={paragraph.text.slice(0, 160)}
            onClick={() =>
              onLocation({ paragraphId: paragraph.id, start: 0, end: Array.from(paragraph.text).length })
            }
          >
            {source.page ? `Tr. ${source.page}` : 'Đoạn gốc'}
          </Button>
        );
      })}
      {part.flags.map((flag) => (
        <Badge key={flag} tone="warning">
          {FLAGS[flag]}
        </Badge>
      ))}
    </span>
  );

  if (!loaded) return <Loading label="Đang tải…" />;
  if (!run)
    return (
      <Card padding="md">
        <div className={styles.start}>
          <p>
            AI đọc toàn bài và viết bản tóm tắt theo đúng các phần của bài. Mỗi ý kèm số trang để mở đoạn gốc;
            code kiểm lại nguồn và số liệu.
          </p>
          <Button variant="primary" disabled={running} onClick={() => void start()}>
            {running ? 'Đang tóm tắt…' : 'Tóm tắt bài (AI)'}
          </Button>
          <span className={styles.note}>Ước tính 1 lượt gọi AI.</span>
          {running && <span role="status">Đang đọc và tóm tắt bài…</span>}
          {error && <p role="alert">{error}</p>}
        </div>
      </Card>
    );
  return (
    <Card padding="md">
      <article className={styles.digest} aria-label="Paper summary">
        <h2>{run.headline}</h2>
        <p>
          {run.overview.text} {sources(run.overview)}
        </p>
        {run.sections.map((section, index) => (
          <section key={`${index}-${section.heading}`} aria-label={section.heading}>
            <h3>{section.heading}</h3>
            {section.blocks.map((block, blockIndex) => (
              <div key={blockIndex} className={styles.block}>
                {block.text && (
                  <p>
                    {block.text.text} {sources(block.text)}
                  </p>
                )}
                {block.items.length > 0 && (
                  <ul>
                    {block.items.map((item, itemIndex) => (
                      <li key={itemIndex}>
                        {item.lead && <strong>{item.lead}: </strong>}
                        {item.text} {sources(item)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </section>
        ))}
        <footer className={styles.footer}>
          <span>
            Tạo lúc {new Date(run.createdAt).toLocaleString('vi-VN')}
            {run.read < run.total && ` · AI đọc ${run.read}/${run.total} đoạn đầu của bài`}
          </span>
          <Button size="sm" variant="ghost" disabled={running} onClick={() => void start()}>
            {running ? 'Đang tóm tắt…' : 'Tóm tắt lại'}
          </Button>
        </footer>
        {error && <p role="alert">{error}</p>}
      </article>
    </Card>
  );
}
