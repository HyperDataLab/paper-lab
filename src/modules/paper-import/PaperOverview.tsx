import { useStoredChanged } from './paperJobs';
import { latestStyleWarning } from '@/core/probe';
import { useEffect, useRef, useState } from 'react';
import type { Analysis, Paper, PaperOverviewRecord, PaperRun } from '@/core/schemas';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { labels } from '@/modules/evaluate';
import { SECTION_ROLE_LABELS } from './sectionRoles';
import { OverviewTable, type OverviewFocus } from './OverviewTable';
import { OverviewTransitions } from './OverviewTransitions';
import { Loading } from '@/shared/ui/StateNote';
import { mainBodySections } from './paperScope';
import { paperAnalyses } from '@/core/paperOverview';

export function PaperOverview({
  paper,
  analyses,
  run,
  onFilter,
  focus,
}: {
  paper: Paper;
  analyses: Analysis[];
  run: PaperRun | null;
  onFilter: (ids: string[]) => void;
  focus: OverviewFocus;
}) {
  const repo = useRepositories();
  const notifyStoredChanged = useStoredChanged();
  const [record, setRecord] = useState<PaperOverviewRecord>();
  const reviewGeneration = useRef(0);
  const [error, setError] = useState('');
  const [styleWarning, setStyleWarning] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void repo.paperProbes.get(paper.id).then((probes) => {
      if (active) setStyleWarning(latestStyleWarning(probes?.runs));
    });
    return () => {
      active = false;
    };
  }, [paper.id, repo]);
  useEffect(() => {
    let active = true;
    const generation = reviewGeneration.current;
    void repo.paperOverviews
      .get(paper.id)
      .then((value) => {
        if (active && generation === reviewGeneration.current) setRecord(value);
      })
      .catch((cause: unknown) => {
        if (active) setError(String(cause));
      });
    return () => {
      active = false;
    };
  }, [repo, paper, analyses, run]);
  async function review(id: string, status: 'confirmed_by_human' | 'dismissed_by_human' | 'candidate') {
    reviewGeneration.current++;
    try {
      const updated = await repo.paperOverviews.reviewTransition(paper.id, id, status);
      reviewGeneration.current++;
      setRecord(updated);
      notifyStoredChanged();
    } catch (cause) {
      setError(String(cause));
    }
  }
  if (error)
    return (
      <p role="alert">
        Không thể tải tổng quan.{' '}
        <details>
          <summary>Chi tiết kỹ thuật</summary>
          {error}
        </details>
      </p>
    );
  if (!record) return <Loading label="Đang tải tổng quan…" />;
  const overview = record.overview;
  const scope = new Set(run?.plan.sectionIds ?? mainBodySections(paper));
  const scoped = paper.paragraphs.filter((item) => item.kind === 'body' && scope.has(item.sectionId));
  const selectedAnalyses = paperAnalyses(paper, analyses);
  const analysed = scoped.filter((item) => selectedAnalyses.has(item.id)).length;
  return (
    <>
      <Card>
        <h2>Kết quả theo mục</h2>
        <p>
          Đã phân tích {analysed}/{scoped.length} đoạn trong phạm vi (
          {paper.paragraphs.filter((item) => item.kind === 'body').length} đoạn cả bài)
        </p>
        {record.transitions?.stale && (
          <p role="status">
            Kết quả chuyển đoạn đã cũ vì phân tích đoạn đã thay đổi hoặc không còn hợp lệ. Hãy chạy lại bước
            chuyển đoạn.
          </p>
        )}
        <p>Tổng quan chỉ thống kê kết quả các đoạn đã phân tích; không phải điểm đánh giá bài báo.</p>
        {styleWarning && (
          <p role="status">
            Điểm trên bài này có thể bị ảnh hưởng bởi văn phong (kiểm tra độ bền ngày{' '}
            {new Date(styleWarning).toLocaleDateString('vi-VN')}).
          </p>
        )}
        <OverviewTable paper={paper} overview={overview} focus={focus} />
      </Card>
      {focus === 'writing' && (
        <Card>
          <h2>Vấn đề lặp lại</h2>
          {!overview.recurringIssues.length && <p>Chưa có vấn đề lặp lại.</p>}
          {overview.recurringIssues.map((item) => (
            <div key={item.type}>
              <Button onClick={() => onFilter(item.paragraphIds)}>
                {labels[item.type as keyof typeof labels] ?? item.type} · {item.count} lần
              </Button>
              <p>
                {item.sectionIds
                  .map((id) => {
                    const section = paper.sections.find((s) => s.id === id);
                    return section ? `${SECTION_ROLE_LABELS[section.role]}: ${section.heading}` : id;
                  })
                  .join(', ')}
              </p>
              {item.examples.map((quote) => (
                <blockquote key={quote}>{quote}</blockquote>
              ))}
            </div>
          ))}
        </Card>
      )}
      {focus === 'discourse' && (
        <OverviewTransitions
          paper={paper}
          transitions={record.transitions}
          onReview={(id, status) => void review(id, status)}
        />
      )}
    </>
  );
}
