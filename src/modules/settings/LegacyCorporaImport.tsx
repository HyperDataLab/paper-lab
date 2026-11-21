import { useState } from 'react';
import { useAuth } from '@/shared/auth/authContext';
import { useHubProjectId } from '@/shared/storage/StorageProvider';
import { RemoteDataClient } from '@/shared/storage/remoteDataClient';
import { Button } from '@/shared/ui/Button';
import styles from './page.module.css';

const emptyCounts = { imported: 0, skipped: 0, failed: 0 };

export function LegacyCorporaImport() {
  const { getIdToken } = useAuth();
  const projectId = useHubProjectId() ?? '';
  const [busy, setBusy] = useState(false);
  const [counts, setCounts] = useState<typeof emptyCounts>();
  const [error, setError] = useState('');

  async function run() {
    setBusy(true);
    setError('');
    setCounts(undefined);
    const client = new RemoteDataClient({ getToken: () => getIdToken(), projectId });
    let total = emptyCounts;
    let cursor: string | null = null;
    try {
      do {
        const page = await client.importLegacyCorpora(cursor);
        total = {
          imported: total.imported + page.imported,
          skipped: total.skipped + page.skipped,
          failed: total.failed + page.failed,
        };
        setCounts(total);
        cursor = page.cursor;
      } while (cursor !== null);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.fields}>
      <div className={styles.start}>
        <Button disabled={busy} onClick={() => void run()}>
          Nhập corpus cũ
        </Button>
      </div>
      {(busy || counts) && (
        <p role="status">
          {busy && 'Đang nhập corpus cũ… '}
          {counts && `Đã nhập ${counts.imported}, bỏ qua ${counts.skipped}, lỗi ${counts.failed}.`}
        </p>
      )}
      {error && (
        <div role="alert">
          <p>Không thể hoàn tất việc nhập corpus cũ.</p>
          <details>
            <summary>Chi tiết kỹ thuật</summary>
            {error}
          </details>
        </div>
      )}
    </div>
  );
}
