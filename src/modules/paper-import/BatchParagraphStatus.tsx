import { AlertCircle, CheckCircle, Clock, LoaderCircle, SkipForward } from 'lucide-react';
import type { Analysis, PaperRun } from '@/core/schemas';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';

export function BatchParagraphStatus({
  item,
  analysis,
  retry,
  busy,
}: {
  item: PaperRun['items'][number] | undefined;
  analysis: Analysis | undefined;
  retry: () => void;
  busy: boolean;
}) {
  if (!item) return null;
  const labels = {
    pending: 'Chờ',
    running: 'Đang phân tích',
    done: 'Hoàn tất',
    failed: 'Thất bại',
    skipped: 'Bỏ qua',
    cached: 'Đã lưu',
  };
  const Icon =
    item.status === 'failed'
      ? AlertCircle
      : item.status === 'running'
        ? LoaderCircle
        : item.status === 'done' || item.status === 'cached'
          ? CheckCircle
          : item.status === 'skipped'
            ? SkipForward
            : Clock;
  return (
    <div>
      <Badge icon={<Icon size={14} aria-hidden="true" />}>{labels[item.status]}</Badge>
      {item.status === 'failed' && (
        <>
          <p role="alert">Không thể phân tích: {item.error}</p>
          <Button disabled={busy} onClick={retry}>
            Thử lại
          </Button>
        </>
      )}
      {analysis && ['done', 'cached'].includes(item.status) && (
        <p>
          {analysis.issues.filter((issue) => issue.status !== 'dismissed_by_human').length} vấn đề cần xem lại
          ·{' '}
          {analysis.scores
            ? `Điểm ${analysis.scores.overall ?? 'chưa đủ căn cứ'} / 100 · phủ ${analysis.scores.coverage.applicable}/${analysis.scores.coverage.total} · tin cậy ${analysis.scores.confidence ?? '—'} · ${analysis.scores.rubricVersion} · ${analysis.scores.contextLimited ? 'thiếu ngữ cảnh' : 'đủ ngữ cảnh'}`
          : 'Chưa chấm điểm'}
        </p>
      )}
    </div>
  );
}
