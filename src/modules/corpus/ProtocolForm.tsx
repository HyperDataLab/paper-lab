import { useState } from 'react';
import { samplingRuleText } from '@/core/corpus/admired';
import type { Corpus, CorpusSampling } from '@/core/schemas/corpus';
import { TextField } from '@/shared/ui/TextField';
import { Button } from '@/shared/ui/Button';
import { SegmentedControl } from '@/shared/ui/SegmentedControl';
import { DialogActions } from '@/shared/ui/Dialog';
import styles from './corpus.module.css';

type Body = Corpus['protocol'][number]['body'];
const lines = (value: string) =>
  value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
export function ProtocolForm({
  kind,
  initial,
  onSave,
  onCancel,
  label,
}: {
  kind: Corpus['kind'];
  initial?: Body;
  onSave: (body: Body) => void;
  /** In a dialog the form ends with Huỷ and its action, right-aligned. */
  onCancel?: () => void;
  label: string;
}) {
  const topic = initial && 'researchQuestion' in initial ? initial : undefined;
  const journal = initial && 'venues' in initial ? initial : undefined;
  const [question, setQuestion] = useState(topic?.researchQuestion ?? '');
  const [inclusion, setInclusion] = useState(topic?.inclusion.join('\n') ?? '');
  const [exclusion, setExclusion] = useState(topic?.exclusion.join('\n') ?? '');
  const [venue, setVenue] = useState(journal?.venues[0]?.name ?? '');
  const [issn, setIssn] = useState(journal?.venues[0]?.issn.join(', ') ?? '');
  const [source, setSource] = useState(journal?.venues[0]?.openalexSourceId ?? '');
  const [types, setTypes] = useState(journal?.articleTypes.join('\n') ?? '');
  const [scope, setScope] = useState(journal?.sampling?.scope ?? 'signature');
  const [topN, setTopN] = useState(journal?.sampling?.scope === 'admired' ? journal.sampling.n : 100);
  const nOptions = [...new Set([50, 100, 200, topN])].sort((a, b) => a - b);
  const [from, setFrom] = useState(String(initial?.years[0] ?? ''));
  const [to, setTo] = useState(String(initial?.years.at(-1) ?? ''));
  const invalidYears = Boolean(
    (from && !/^\d{4}$/u.test(from)) ||
    (to && !/^\d{4}$/u.test(to)) ||
    (from && to && Number(from) > Number(to)),
  );
  function save() {
    const years =
      from && to
        ? Array.from({ length: Number(to) - Number(from) + 1 }, (_, i) => Number(from) + i)
        : [from, to].filter(Boolean).map(Number);
    // A control corpus follows its target's scope, so only a journal corpus chooses one here.
    const sampling: CorpusSampling | undefined =
      kind !== 'journal'
        ? journal?.sampling
        : scope === 'admired'
          ? { scope, n: topN, rankedBy: 'cited_by_count within publication year' }
          : { scope };
    onSave(
      kind === 'topic'
        ? { researchQuestion: question, inclusion: lines(inclusion), exclusion: lines(exclusion), years }
        : {
            venues: [
              {
                name: venue,
                issn: issn
                  .split(/[,\n]/u)
                  .map((s) => s.trim())
                  .filter(Boolean),
                ...(source.trim() ? { openalexSourceId: source.trim() } : {}),
              },
              ...(journal?.venues.slice(1) ?? []),
            ],
            years,
            articleTypes: lines(types),
            versionOfRecordOnly: journal?.versionOfRecordOnly ?? true,
            samplingRule:
              sampling && (scope === 'admired' || journal?.sampling?.scope === 'admired')
                ? samplingRuleText(sampling)
                : (journal?.samplingRule ?? ''),
            seed: journal?.seed ?? '',
            strata: journal?.strata ?? [],
            capPerIssue: journal?.capPerIssue ?? null,
            exclusions: journal?.exclusions ?? [],
            ...(sampling ? { sampling } : {}),
          },
    );
  }
  return (
    <div className={styles.form}>
      {kind === 'topic' ? (
        <>
          <TextField
            label="Câu hỏi nghiên cứu"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <TextField
            label="Tiêu chí chọn (mỗi dòng một tiêu chí)"
            multiline
            value={inclusion}
            onChange={(e) => setInclusion(e.target.value)}
          />
          <TextField
            label="Tiêu chí loại (mỗi dòng một tiêu chí)"
            multiline
            value={exclusion}
            onChange={(e) => setExclusion(e.target.value)}
          />
        </>
      ) : (
        <>
          <TextField label="Tên tạp chí" value={venue} onChange={(e) => setVenue(e.target.value)} />
          <TextField
            label="ISSN (cách nhau bằng dấu phẩy)"
            value={issn}
            onChange={(e) => setIssn(e.target.value)}
          />
          <TextField label="OpenAlex source id" value={source} onChange={(e) => setSource(e.target.value)} />
          <TextField
            label="Loại bài (mỗi dòng một loại)"
            multiline
            value={types}
            onChange={(e) => setTypes(e.target.value)}
          />
          {kind === 'journal' && (
            <>
              <SegmentedControl
                label="Cách lấy mẫu"
                value={scope}
                options={[
                  { value: 'signature', label: 'Mẫu ngẫu nhiên phân tầng (signature)' },
                  { value: 'admired', label: 'Bài được trích dẫn nhiều nhất (admired)' },
                ]}
                onChange={(value) => setScope(value === 'admired' ? 'admired' : 'signature')}
              />
              {scope === 'admired' && (
                <>
                  <SegmentedControl
                    label="Số bài N"
                    value={String(topN)}
                    options={nOptions.map((n) => ({ value: String(n), label: String(n) }))}
                    onChange={(value) => setTopN(Number(value))}
                  />
                  <p>
                    Xếp hạng theo số trích dẫn trong từng năm xuất bản, chia đều N bài cho các năm. Profile
                    admired luôn là <strong>thăm dò</strong> (exploratory): dưới 150 + 150 bài và không giữ
                    lại bài để kiểm tra.
                  </p>
                </>
              )}
            </>
          )}
        </>
      )}
      <div className={styles.row}>
        <TextField label="Từ năm" value={from} onChange={(e) => setFrom(e.target.value)} />
        <TextField label="Đến năm" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      {invalidYears && <p role="alert">Năm phải có bốn chữ số và năm bắt đầu không sau năm kết thúc.</p>}
      {onCancel ? (
        <DialogActions>
          <Button variant="ghost" onClick={onCancel}>
            Huỷ
          </Button>
          <Button variant="primary" disabled={invalidYears} onClick={save}>
            {label}
          </Button>
        </DialogActions>
      ) : (
        <div>
          <Button variant="primary" disabled={invalidYears} onClick={save}>
            {label}
          </Button>
        </div>
      )}
    </div>
  );
}
