import { usableGrobid } from '@/core/grobid/merge';
import { ActionBar } from '@/shared/ui/ActionBar';
import { Button } from '@/shared/ui/Button';
import { useGrobidState } from './grobidContext';

/** Whether the header, reference list and citation links shown come from GROBID, and a way to ask again. */
export function GrobidStatus() {
  const { status, reason, record, refetch } = useGrobidState();
  if (status === 'idle') return null;
  const result = usableGrobid(record);
  const text =
    status === 'loading'
      ? 'Cấu trúc từ GROBID: đang lấy…'
      : status === 'ready' && result
        ? `Cấu trúc từ GROBID: đã dùng (${result.references.length} tài liệu, ${result.citations.length} trích dẫn).${record?.lastFailedAttempt ? ` Lần lấy lại thất bại (${record.lastFailedAttempt.reason}); đã giữ kết quả cũ.` : ''}`
        : `Cấu trúc từ GROBID: không dùng được (${reason ?? 'không rõ lý do'}).`;
  return (
    <ActionBar status={<span role="status">{text}</span>}>
      {refetch && (
        <Button size="sm" disabled={status === 'loading'} onClick={() => refetch()}>
          Lấy lại từ GROBID
        </Button>
      )}
      {refetch && record?.lastFailedAttempt && (
        <Button size="sm" disabled={status === 'loading'} onClick={() => refetch(true)}>
          Thay thế bằng kết quả mới
        </Button>
      )}
    </ActionBar>
  );
}
