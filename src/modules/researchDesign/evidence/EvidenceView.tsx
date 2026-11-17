import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { ActionBar } from '@/shared/ui/ActionBar';
import { Button } from '@/shared/ui/Button';
import { Empty } from '@/shared/ui/StateNote';
import { TextField } from '@/shared/ui/TextField';
import { useToast } from '@/shared/ui/toastContext';
import { EvidenceTable } from './EvidenceTable';
import { FactDrawer } from './FactDrawer';
import { SuggestDrawer } from './SuggestDrawer';
import { UsageCounts } from './UsageCounts';
import type { Selection } from './factsDocs';
import { useEvidence, type EvidenceError, type Loaded } from './useEvidence';
import styles from './evidence.module.css';

const MESSAGES: Record<EvidenceError, string> = {
  not_anchored: 'Có dữ kiện không tìm thấy neo trong paper model đang giữ nên chưa thể dùng.',
  reason_required: 'Cần ghi lý do khi loại.',
  conflict: 'Dữ kiện vừa được thay đổi ở nơi khác; hãy thử lại.',
  network: 'Không lưu được. Hãy thử lại.',
  unknown: 'Không lưu được. Hãy thử lại.',
};

/** Bảng so sánh: project papers by fact kind, the project's decisions, bank matches and AI suggestions. */
export function EvidenceView({ state }: { state: Loaded }) {
  const { papers, docs, change, match } = useEvidence(state);
  const toast = useToast();
  const [opened, setOpened] = useState<Selection | null>(null);
  const [selected, setSelected] = useState<Selection[]>([]);
  const [excluding, setExcluding] = useState(false);
  const [reason, setReason] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const run = async (entries: Selection[], action: 'use' | 'exclude' | 'clear', input: string | null) => {
    const result = await change(entries, action, input);
    if (!result.ok) toast(MESSAGES[result.error]);
    return result.ok;
  };
  const bulk = async (action: 'use' | 'exclude', input: string | null) => {
    if (await run(selected, action, input)) {
      setSelected([]);
      setExcluding(false);
      setReason('');
    }
  };
  if (!papers.length)
    return <Empty title="Chưa có bài báo nào được chọn" hint="Thêm bài báo vào dự án để so sánh dữ kiện." />;
  const paper = papers.find((entry) => entry.id === opened?.paperId);
  const doc = opened ? docs[opened.paperId] : undefined;
  const fact = doc?.facts.facts.find((entry) => entry.id === opened?.factId);
  const model = opened ? state.facts[opened.paperId]?.model : undefined;
  const withFacts = papers.filter((entry) => docs[entry.id]?.facts.facts.length).length;
  return (
    <div className={styles.stack}>
      <ActionBar
        status={
          selected.length ? `Đã chọn ${selected.length}` : `${papers.length} bài · ${withFacts} có dữ kiện`
        }
      >
        {selected.length > 0 && (
          <>
            <Button onClick={() => setExcluding(true)}>Loại</Button>
            <Button variant="primary" onClick={() => void bulk('use', null)}>
              Dùng
            </Button>
          </>
        )}
        <Button leadingIcon={<Sparkles size={16} aria-hidden="true" />} onClick={() => setSuggesting(true)}>
          Gợi ý từ bảng so sánh
        </Button>
      </ActionBar>
      {excluding && selected.length > 0 && (
        <div className={styles.row}>
          <TextField label="Lý do loại" value={reason} onChange={(event) => setReason(event.target.value)} />
          <Button onClick={() => void bulk('exclude', reason)}>Xác nhận loại</Button>
        </div>
      )}
      <EvidenceTable
        papers={papers}
        docs={docs}
        selected={selected}
        setSelected={setSelected}
        open={setOpened}
      />
      <UsageCounts papers={papers} docs={docs} bank={state.bank} />
      {opened && paper && doc && fact && model && (
        <FactDrawer
          key={`${opened.paperId}:${opened.factId}`}
          paper={paper}
          doc={doc}
          fact={fact}
          model={model}
          bank={state.bank}
          close={() => setOpened(null)}
          change={(action, input) => run([opened], action, input)}
          match={(id) =>
            void match(opened.paperId, opened.factId, id).then((result) => {
              if (!result.ok) toast(MESSAGES[result.error]);
            })
          }
        />
      )}
      {suggesting && (
        <SuggestDrawer
          state={state}
          papers={papers}
          docs={docs}
          close={() => setSuggesting(false)}
          openFacts={() => setSuggesting(false)}
        />
      )}
    </div>
  );
}
