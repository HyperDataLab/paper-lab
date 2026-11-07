import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toJsonReport } from '@/core/report';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { Button } from '@/shared/ui/Button';
import { loadReport } from './loadReport';

export function ReportMenu({ id }: { id: string }) {
  const repo = useRepositories();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  async function download() {
    try {
      const report = await loadReport(repo, id);
      const url = URL.createObjectURL(new Blob([toJsonReport(report)], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `paragraph-lab-report-${id.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setError('');
    } catch (cause) {
      setError(String(cause));
    }
  }
  return (
    <div>
      <Button aria-expanded={open} onClick={() => setOpen(!open)}>
        Xuất báo cáo
      </Button>
      {open && (
        <div>
          <Button onClick={() => void download()}>JSON (.json)</Button>{' '}
          <Link to={`/report/${id}`}>Bản in / PDF</Link>
        </div>
      )}
      {error && (
        <div role="alert">
          Không thể xuất báo cáo.
          <details>
            <summary>Chi tiết kỹ thuật</summary>
            {error}
          </details>
        </div>
      )}
    </div>
  );
}
