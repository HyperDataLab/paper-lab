import { useState } from 'react';
import { parseSearchFile, recordImport } from '@/core/corpus/searchImport';
import type { Corpus } from '@/core/schemas';
import { Dropzone } from '@/shared/ui/Dropzone';

/** Imports a database export (RIS or CSV) as one search entry; its records go through the same intake. */
export function SearchImport({ corpus, save }: { corpus: Corpus; save: (value: Corpus) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  async function importFile(file: File) {
    setBusy(true);
    setStatus('');
    try {
      const parsed = parseSearchFile(file.name, await file.text());
      const result = recordImport(corpus, file.name, parsed, new Date().toISOString());
      await save(result.corpus);
      setStatus(
        `Đã nhập ${parsed.records.length} bản ghi: thêm ${result.added} · trùng ${result.duplicates} · cần xác nhận ${result.pending} · bỏ qua ${result.skipped}`,
      );
    } catch (cause) {
      setStatus(`Không nhập được tệp: ${String(cause)}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Dropzone
        inputLabel="Nhập kết quả tìm kiếm"
        title="Nhập kết quả tìm kiếm"
        hint="Tệp RIS hoặc CSV xuất từ Scopus, Web of Science, PubMed. CSV cần cột title, year, doi."
        accept=".ris,.csv,.txt,text/csv"
        busy={busy}
        onFile={(file) => void importFile(file)}
      />
      {status && <p role="status">{status}</p>}
    </>
  );
}
