import { useState } from 'react';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { TextField } from '@/shared/ui/TextField';

export function ResultsImport({
  loaded,
  disabled,
  save,
}: {
  loaded: boolean;
  disabled: boolean;
  save: (raw: string, format: 'json' | 'csv') => Promise<boolean>;
}) {
  const [paste, setPaste] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const detect = (raw: string) => (/^[\s\uFEFF]*\{/u.test(raw) ? 'json' : 'csv');
  const submit = async (read: () => Promise<string>, format?: 'json' | 'csv') => {
    setBusy(true);
    setMessage('');
    try {
      const text = await read();
      if (await save(text, format ?? detect(text))) {
        setPaste('');
        setMessage('Đã nhập results log.');
      }
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <h4>Nhập results log</h4>
      <p>Dùng results log xuất từ Scientific Research Desktop hoặc chọn tệp JSON hay CSV.</p>
      <label>
        Tệp results log{' '}
        <input
          type="file"
          accept=".json,.csv,application/json,text/csv"
          disabled={disabled || busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file)
              void submit(() => file.text(), file.name.toLowerCase().endsWith('.csv') ? 'csv' : 'json');
            event.target.value = '';
          }}
        />
      </label>
      <TextField
        label="Dán results log"
        multiline
        value={paste}
        disabled={disabled || busy}
        onChange={(event) => setPaste(event.target.value)}
      />
      <Button disabled={disabled || busy || !paste.trim()} onClick={() => void submit(async () => paste)}>
        Nhập log
      </Button>
      {loaded && <p>Đã có log cho phiên bản kế hoạch này. Thay log sẽ đặt lại phần phân tích.</p>}
      {message && <p role="status">{message}</p>}
    </Card>
  );
}
