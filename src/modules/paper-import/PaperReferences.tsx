import { memo, useEffect, useMemo, useState } from 'react';
import { usableGrobid } from '@/core/grobid/merge';
import type { Finding, Paper, PaperContextRecord } from '@/core/schemas';
import {
  doisToCheck,
  paperDoi,
  RECENT_YEARS,
  referenceList,
  referenceStats,
  retractedWorks,
} from '@/core/scholarlyContext';
import { createScholarClient } from '@/shared/scholar/client';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { ActionBar, Stat, StatGrid } from '@/shared/ui/ActionBar';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { FindingCard } from '@/shared/ui/FindingCard';
import { useGrobidState } from './grobidContext';
import { PlaceText } from './PlaceText';
import { ReferenceAudit } from './ReferenceAudit';
import styles from './page.module.css';

export const PaperReferences = memo(function PaperReferences({
  paper,
  onLocation,
}: {
  paper: Paper;
  onLocation: (location: Finding['locations'][number]) => void;
}) {
  const repo = useRepositories();
  const grobidRecord = useGrobidState().record;
  const grobid = useMemo(() => usableGrobid(grobidRecord), [grobidRecord]);
  const items = useMemo(() => referenceList(paper, undefined, grobid), [paper, grobid]);
  const stats = useMemo(() => referenceStats(items), [items]);
  const dois = useMemo(() => doisToCheck(paper, items), [paper, items]);
  const [record, setRecord] = useState<PaperContextRecord>();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void repo.paperContext.get(paper.id).then((saved) => {
      if (active) setRecord(saved);
    });
    return () => {
      active = false;
    };
  }, [paper.id, repo]);
  async function check() {
    setRunning(true);
    setError('');
    try {
      // The email is for Unpaywall only, so this client is created without it.
      const statuses = await createScholarClient({}).workStatuses(dois);
      const current = await repo.paperContext.get(paper.id);
      setRecord(
        await repo.paperContext.save({
          ...current,
          schemaVersion: 1,
          paperId: paper.id,
          checkedAt: new Date().toISOString(),
          paperDoi: paperDoi(paper),
          checked: dois.length,
          found: statuses.length,
          retracted: retractedWorks(statuses, paperDoi(paper)),
          retractionChecked: true,
          metadata: current?.metadata ?? null,
        }),
      );
    } catch {
      setError('Không tra cứu được OpenAlex. Vui lòng thử lại.');
    } finally {
      setRunning(false);
    }
  }
  const locationOf = (doi: string) => items.find((item) => item.doi === doi)?.location ?? null;
  const retracted = new Set(record?.retracted.map((work) => work.doi) ?? []);
  return (
    <>
      <Card>
        <h2>Danh sách tài liệu</h2>
        <StatGrid>
          <Stat value={stats.total} label="References" />
          <Stat
            value={stats.withYear ? `${Math.round((stats.recent / stats.withYear) * 100)} %` : '—'}
            label={`Trong ${RECENT_YEARS} năm tính đến năm mới nhất được trích`}
          />
          <Stat value={stats.median ?? '—'} label="Năm trung vị" />
          <Stat value={stats.newest ?? '—'} label="Năm mới nhất được trích" />
          <Stat value={stats.withDoi} label="Tài liệu có DOI" />
        </StatGrid>
        <p className={styles.tabHelp}>
          {grobid?.references.length ? 'Danh sách lấy từ GROBID. ' : ''}
          Năm được ước tính từ nội dung từng mục. {stats.total - stats.withYear} mục không đọc được năm nên
          không tính vào tỷ lệ.
        </p>
        {items.length > 0 && (
          // Every reference on its own line; the whole entry shows on hover.
          <ol className={styles.refList} aria-label="References">
            {items.map((item, index) => (
              <li key={index} className={styles.refRow}>
                <span className={styles.refNumber}>{index + 1}</span>
                <span className={styles.refText} title={item.text}>
                  {item.text.replace(/^\s*(?:\[\d+\]|\d+[.)])\s*/u, '')}
                </span>
                {item.doi && retracted.has(item.doi) && <Badge tone="danger">Đã bị rút</Badge>}
                {item.year && <span className={styles.refYear}>{item.year}</span>}
                {item.doi && (
                  <a href={`https://doi.org/${item.doi}`} target="_blank" rel="noreferrer">
                    DOI
                  </a>
                )}
                {item.location && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => item.location && onLocation(item.location)}
                  >
                    <PlaceText paper={paper} paragraphId={item.location.paragraphId} />
                  </Button>
                )}
              </li>
            ))}
          </ol>
        )}
        <ReferenceAudit paperId={paper.id} references={items} record={record} onSave={setRecord} />
        {stats.buckets.length > 0 && (
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Giai đoạn</th>
                <th scope="col">Số tài liệu</th>
              </tr>
            </thead>
            <tbody>
              {stats.buckets.map((bucket) => (
                <tr key={bucket.from}>
                  <td>
                    {bucket.from}–{bucket.to}
                  </td>
                  <td>{bucket.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Card>
        <h2>Tình trạng rút bài</h2>
        <ActionBar
          status={
            running ? (
              <span role="status">Đang tra cứu OpenAlex…</span>
            ) : record?.retractionChecked ? (
              `Tra lúc ${new Date(record.checkedAt).toLocaleString('vi-VN')}: OpenAlex có ${record.found}/${record.checked} DOI.`
            ) : (
              `Sẽ gửi ${dois.length} DOI tới OpenAlex. Nội dung bài không được gửi đi.`
            )
          }
        >
          <Button variant="primary" disabled={running || dois.length === 0} onClick={() => void check()}>
            {record?.retractionChecked ? 'Tra cứu lại' : 'Kiểm tra rút bài'}
          </Button>
        </ActionBar>
        {error && <p role="alert">{error}</p>}
        {dois.length === 0 && <p>Danh sách tài liệu không có DOI nên chưa kiểm tra được.</p>}
        {record?.retractionChecked && record.retracted.length === 0 && (
          <p>
            OpenAlex không ghi nhận bài bị rút trong {record.found} DOI tra được. Tài liệu không có DOI hoặc
            chưa có trên OpenAlex thì chưa được kiểm tra.
          </p>
        )}
        <div className={styles.findingList}>
          {record?.retracted.map((work) => {
            const location = locationOf(work.doi);
            return (
              <FindingCard
                key={work.doi}
                labels={
                  <Badge tone="danger">
                    {work.isPaper ? 'Bài này đã bị rút' : 'Tài liệu trích đã bị rút'}
                  </Badge>
                }
                source={location ? { label: 'Xem trong bài', onOpen: () => onLocation(location) } : undefined}
              >
                <p>
                  {work.title ?? 'Không rõ nhan đề'}
                  {work.year ? ` (${work.year})` : ''} · {work.doi}
                </p>
              </FindingCard>
            );
          })}
        </div>
      </Card>
    </>
  );
});
