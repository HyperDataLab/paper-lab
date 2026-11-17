import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  aggregateKeywords,
  buildCorpusKeywords,
  isKeywordCollectionStale,
  papersInYear,
} from '@/core/corpusKeywords';
import type { Corpus } from '@/core/schemas/corpus';
import type { CorpusKeywords as Collection } from '@/core/schemas/corpusKeywords';
import { createScholarClient, type ScholarClient } from '@/shared/scholar/client';
import { getScholarEmail } from '@/shared/scholar/settings';
import type { MemberKeywords } from '@/shared/storage/corpusKeywords';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { SegmentedControl } from '@/shared/ui/SegmentedControl';
import { Select } from '@/shared/ui/Select';
import { KeywordCloud } from './KeywordCloud';
import { KeywordGraph } from './KeywordGraph';
import { KeywordTable } from './KeywordTable';
import styles from './keywords.module.css';

/** OpenAlex asks for polite use; three requests at a time keeps a 300-paper backfill to a minute or two. */
const CONCURRENCY = 3;
type KeywordClient = Pick<ScholarClient, 'workKeywords'>;
const defaultClient = (): KeywordClient => createScholarClient({ email: getScholarEmail() });

export function CorpusKeywords({
  corpus,
  makeClient = defaultClient,
}: {
  corpus: Corpus;
  makeClient?: () => KeywordClient;
}) {
  const repo = useRepositories();
  const [collection, setCollection] = useState<Collection>();
  const [members, setMembers] = useState<MemberKeywords>();
  const [view, setView] = useState('cloud');
  const [year, setYear] = useState('');
  const [selected, setSelected] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);
  const memberIds = useMemo(() => corpus.members.map((member) => member.memberId), [corpus.members]);

  const compute = useCallback(async () => {
    const found = await repo.corpusKeywords.memberKeywords(corpus);
    const saved = await repo.corpusKeywords.save(
      buildCorpusKeywords({
        corpusId: corpus.id,
        memberIds: corpus.members.map((member) => member.memberId),
        papers: found.papers,
        computedAt: new Date().toISOString(),
      }),
    );
    setMembers(found);
    setCollection(saved);
  }, [corpus, repo]);

  useEffect(() => {
    let active = true;
    void Promise.all([repo.corpusKeywords.get(corpus.id), repo.corpusKeywords.memberKeywords(corpus)])
      .then(([stored, found]) => {
        if (!active) return;
        setCollection(stored);
        setMembers(found);
      })
      .catch((e: unknown) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, [corpus, repo]);
  useEffect(() => () => abort.current?.abort(), []);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function backfill() {
    const targets = [...(members?.missing ?? [])];
    if (!targets.length) return;
    const controller = new AbortController();
    abort.current = controller;
    const client = makeClient();
    const total = targets.length;
    let finished = 0;
    let failed = 0;
    setProgress(`Đã lấy 0/${total}`);
    const worker = async () => {
      for (let target = targets.shift(); target && !controller.signal.aborted; target = targets.shift()) {
        try {
          // A DOI OpenAlex does not know has no keywords; saving [] stops it being asked again.
          const keywords = (await client.workKeywords(target.doi, controller.signal)) ?? [];
          await repo.corpusKeywords.saveFetched(target, keywords);
        } catch {
          if (controller.signal.aborted) return;
          failed++;
        }
        finished++;
        setProgress(`Đã lấy ${finished}/${total}${failed ? ` · ${failed} lỗi` : ''}`);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    if (controller.signal.aborted) return;
    abort.current = null;
    await compute();
    setProgress(
      failed
        ? `Xong, ${failed} bài không lấy được; bấm lại để thử lại.`
        : `Đã lấy keywords cho ${finished - failed} bài.`,
    );
  }

  const yearNumber = year ? Number(year) : null;
  const shown = useMemo(
    () =>
      collection && yearNumber !== null
        ? aggregateKeywords(papersInYear(collection.papers, yearNumber))
        : collection,
    [collection, yearNumber],
  );
  const years = Object.keys(collection?.papersByYear ?? {}).sort((a, b) => b.localeCompare(a));
  const stale =
    collection &&
    (isKeywordCollectionStale(collection, memberIds) ||
      (members !== undefined && members.papers.length !== collection.papers.length));
  const missing = members?.missing.length ?? 0;
  const chosen = shown?.keywords.find((keyword) => keyword.id === selected);
  const titleOf = (id: string) => {
    const member = corpus.members.find((item) => item.memberId === id);
    return member?.title || member?.identifiers.doi || member?.exportId || id;
  };
  const yearOf = (id: string) => collection?.papers.find((paper) => paper.memberId === id)?.year;

  return (
    <Card>
      <section aria-labelledby="corpus-keywords" className={styles.section}>
        <div className={styles.head}>
          <h2 id="corpus-keywords">Keywords</h2>
          <div className={styles.tools}>
            {stale && <Badge tone="warning">Đã cũ</Badge>}
            {missing > 0 && (
              <Button size="sm" disabled={busy} onClick={() => void run(backfill)}>
                Lấy keywords cho {missing} bài còn thiếu
              </Button>
            )}
            <Button variant="primary" size="sm" disabled={busy} onClick={() => void run(compute)}>
              {collection ? 'Tính lại' : 'Tính bộ keyword'}
            </Button>
          </div>
        </div>
        <p className={styles.muted}>
          Keyword do OpenAlex gán cho từng bài; chỉ DOI được gửi đi. Số bài cho biết keyword phổ biến đến đâu
          trong corpus, không phải nó quan trọng đến đâu.
          {members && members.withoutDoi > 0 && ` ${members.withoutDoi} bài không có DOI nên không tra được.`}
        </p>
        {progress && <p role="status">{progress}</p>}
        {error && <p role="alert">Không thể lấy hoặc tính keyword. {error}</p>}
        {stale && (
          <p className={styles.muted}>
            Thành viên hoặc keyword của corpus đã đổi từ lần tính trước; bấm “Tính lại” để cập nhật.
          </p>
        )}
        {!collection || !shown ? (
          <p className={styles.muted}>Chưa tính bộ keyword cho corpus này.</p>
        ) : (
          <>
            <p className={styles.muted}>
              Tính lúc {new Date(collection.computedAt).toLocaleString('vi-VN')} từ {collection.memberCount}{' '}
              bài · {shown.papersWithKeywords} bài có keyword · {shown.keywords.length} keyword
            </p>
            <div className={styles.tools}>
              <SegmentedControl
                label="Cách xem keyword"
                value={view}
                onChange={setView}
                options={[
                  { value: 'cloud', label: 'Đám mây' },
                  { value: 'graph', label: 'Đồ thị đồng xuất hiện' },
                ]}
              />
              <Select
                label="Năm"
                size="sm"
                inline
                value={year}
                onChange={(event) => setYear(event.target.value)}
              >
                <option value="">Mọi năm</option>
                {years.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </Select>
            </div>
            {shown.keywords.length === 0 ? (
              <p className={styles.muted}>
                Chưa có bài nào có keyword{yearNumber !== null ? ` trong năm ${year}` : ''}.
              </p>
            ) : (
              <>
                {view === 'cloud' ? (
                  <KeywordCloud keywords={shown.keywords} selected={selected} onSelect={setSelected} />
                ) : (
                  <KeywordGraph aggregate={shown} selected={selected} onSelect={setSelected} />
                )}
                {chosen && (
                  <div>
                    <h3>
                      {chosen.name} · {chosen.paperCount} bài
                    </h3>
                    <ul className={styles.papers} aria-label={`Các bài có keyword ${chosen.name}`}>
                      {chosen.paperIds.map((id) => (
                        <li key={id}>
                          {titleOf(id)}
                          {yearOf(id) ? ` (${yearOf(id)})` : ''}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <KeywordTable keywords={shown.keywords} selected={selected} onSelect={setSelected} />
              </>
            )}
          </>
        )}
      </section>
    </Card>
  );
}
