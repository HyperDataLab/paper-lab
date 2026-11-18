import { useMemo, useRef, useState } from 'react';
import { Download, RefreshCw, Upload } from 'lucide-react';
import type { BankDoc } from '@/core/researchDesign/bank/snapshot';
import { useAuth } from '@/shared/auth/authContext';
import { BANK_API_URL, createBankClient } from '@/shared/bank/bankApi';
import { ActionBar, Stat, StatGrid } from '@/shared/ui/ActionBar';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { Dialog, DialogActions } from '@/shared/ui/Dialog';
import { Empty } from '@/shared/ui/StateNote';
import { useToast } from '@/shared/ui/toastContext';
import {
  bankFailure,
  useBankImport,
  type BankFailure,
  type BankResult,
  type ImportBank,
} from './useBankImport';
import styles from './BankPanel.module.css';

const reasons: Record<Exclude<BankFailure, 'cancelled'>, string> = {
  too_large: 'Tệp vượt quá giới hạn 2 MiB.',
  not_json: 'Tệp không phải JSON.',
  not_a_snapshot: 'Tệp không phải bản chụp Writing Bank.',
  unsupported_version: 'Phiên bản bản chụp không được hỗ trợ.',
  invalid: 'Bản chụp không hợp lệ.',
  hash_mismatch: 'Tệp không khớp mã băm nội dung mà nó tự khai; hãy tải lại bản phát hành từ Writing Bank.',
  conflict: 'Bản chụp đã thay đổi; vui lòng thử lại.',
  network: 'Không thể nhập bản chụp. Vui lòng thử lại.',
  signed_out: 'Cần đăng nhập tài khoản lab để đọc Writing Bank.',
  bank_auth: 'Writing Bank chưa chấp nhận tài khoản của ứng dụng này.',
  rate_limit: 'Writing Bank đang giới hạn số lần gọi; thử lại sau.',
};

const day = (iso: string) => new Date(iso).toLocaleDateString('vi-VN');

export function BankPanel({
  projectId,
  bank,
  importBank,
}: {
  projectId: string;
  bank: BankDoc | null;
  importBank: ImportBank;
}) {
  const { getIdToken } = useAuth();
  const toast = useToast();
  const { importFile, fetchLatest } = useBankImport(projectId, bank, importBank);
  const client = useMemo(
    () => createBankClient({ baseUrl: BANK_API_URL, getToken: getIdToken }),
    [getIdToken],
  );
  const input = useRef<HTMLInputElement>(null);
  const [confirm, setConfirm] = useState<((answer: boolean) => void) | null>(null);
  const [refusal, setRefusal] = useState<{ error: BankFailure; issues?: string[] } | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const askReplace = () => new Promise<boolean>((resolve) => setConfirm(() => resolve));
  const answer = (value: boolean) => {
    confirm?.(value);
    setConfirm(null);
  };
  const run = async (action: () => Promise<BankResult>) => {
    setBusy(true);
    setRefusal(null);
    setMessage('');
    try {
      const result = await action();
      if (result.ok && result.current) setMessage(`Dự án đang dùng bản mới nhất (${bank?.release ?? ''}).`);
      else if (result.ok) toast('Đã nhập bản chụp Writing Bank.');
      else if (result.error !== 'cancelled') setRefusal({ error: result.error, issues: result.issues });
    } finally {
      setBusy(false);
    }
  };
  /** Reads only the release: nothing is stored until the person asks for the new snapshot. */
  const checkRelease = async () => {
    setBusy(true);
    setRefusal(null);
    setMessage('');
    try {
      const latest = await client.getRelease(bank?.release ?? null);
      setMessage(
        latest.status === 'current' || latest.release.release === bank?.release
          ? `Dự án đang dùng bản mới nhất (${bank?.release ?? ''}).`
          : `Writing Bank có bản ${latest.release.release}, phát hành ${day(latest.release.date)}.`,
      );
    } catch (error) {
      setRefusal({ error: bankFailure(error) });
    } finally {
      setBusy(false);
    }
  };

  const collections = bank?.collections;
  return (
    <div className={styles.panel}>
      {refusal && refusal.error !== 'cancelled' && (
        <div role="alert" className={styles.alert}>
          <p>{reasons[refusal.error]}</p>
          {refusal.issues && refusal.issues.length > 0 && (
            <ul>
              {refusal.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {!bank || !collections ? (
        <Empty
          title="Chưa có bản chụp"
          hint="Research design, threats to validity và loại claim đến từ bản chụp Writing Bank."
        >
          <Button
            variant="primary"
            disabled={busy}
            leadingIcon={<Upload size={16} aria-hidden="true" />}
            onClick={() => input.current?.click()}
          >
            Nhập bản chụp
          </Button>
        </Empty>
      ) : (
        <Card>
          <div className={styles.details}>
            <p className={styles.release}>{bank.release}</p>
            {bank.releaseDate && <p>Ngày phát hành: {day(bank.releaseDate)}</p>}
            {bank.includesDrafts && (
              <p>
                <Badge tone="warning">Có mục bản nháp</Badge> Bản phát hành này gồm cả các mục Writing Bank
                chưa xuất bản.
              </p>
            )}
            {bank.source && <p>Nguồn: {bank.source}</p>}
            <p className={styles.muted}>
              Người nhập: {bank.importedBy} · {new Date(bank.importedAt).toLocaleString('vi-VN')}
            </p>
            <StatGrid>
              <Stat value={collections.designs.length} label="Research design" />
              <Stat value={collections.threats.length} label="Threats to validity" />
              <Stat value={collections['claim-types'].length} label="loại claim" />
              <Stat value={collections.metrics.length} label="metric" />
              <Stat value={collections.protocols.length} label="protocol" />
              <Stat value={collections.benchmarks.length} label="benchmark" />
            </StatGrid>
          </div>
        </Card>
      )}
      <ActionBar status={message && <p className={styles.muted}>{message}</p>}>
        <Button
          disabled={busy}
          leadingIcon={<RefreshCw size={16} aria-hidden="true" />}
          onClick={() => void checkRelease()}
        >
          Kiểm tra bản mới
        </Button>
        <Button
          disabled={busy}
          leadingIcon={<Download size={16} aria-hidden="true" />}
          onClick={() => void run(() => fetchLatest(client, askReplace))}
        >
          Lấy bản mới
        </Button>
        {bank && (
          <Button
            disabled={busy}
            leadingIcon={<Upload size={16} aria-hidden="true" />}
            onClick={() => input.current?.click()}
          >
            Thay bản chụp
          </Button>
        )}
      </ActionBar>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        hidden
        aria-label="Tệp bản chụp Writing Bank"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void run(() => importFile(file, askReplace));
        }}
      />
      {confirm && (
        <Dialog
          title="Thay bản chụp"
          description="Bản nháp đang tham chiếu bản chụp hiện tại. Thay bản chụp?"
          onClose={() => answer(false)}
        >
          <DialogActions>
            <Button onClick={() => answer(false)}>Hủy</Button>
            <Button variant="primary" onClick={() => answer(true)}>
              Thay bản chụp
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </div>
  );
}
