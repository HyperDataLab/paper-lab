import { useState } from 'react';
import { samplingRuleText } from '@/core/corpus/admired';
import type { BankArticleType, BankJournal } from '@/core/schemas/bankCatalog';
import type { Corpus, CorpusSampling } from '@/core/schemas/corpus';
import { TextField } from '@/shared/ui/TextField';
import { Button } from '@/shared/ui/Button';
import { Checkbox } from '@/shared/ui/Checkbox';
import { SegmentedControl } from '@/shared/ui/SegmentedControl';
import { DialogActions } from '@/shared/ui/Dialog';
import { JournalPicker } from './JournalPicker';
import { useJournalCatalog } from './useJournalCatalog';
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
  const [bank, setBank] = useState(journal?.bank);
  const [typeDraft, setTypeDraft] = useState<{ extra: string; selected: BankArticleType[] }>();
  const { catalog, signedOut, canSearch, query, changeQuery, search } = useJournalCatalog(kind === 'journal');
  const articleCatalog = catalog?.status === 'ok' ? catalog : undefined;
  const unavailable = signedOut || catalog?.status === 'unavailable' || search?.status === 'unavailable';
  const savedTypes = journal?.articleTypes ?? [];
  const typeOptions = articleCatalog?.articleTypes ?? [];
  const hasTypeOptions = typeOptions.length > 0;
  const savedSelections = typeOptions.filter((item) => journal?.bank?.articleTypeIds?.includes(item.id));
  const selectedTypes = typeDraft?.selected ?? savedSelections;
  const selectedAliases = selectedTypes.flatMap((item) => item.aliases);
  // Earlier protocols stored the display name for checked types.
  const savedSelectionValues = new Set(savedSelections.flatMap((item) => [item.name, ...item.aliases]));
  const extraTypes =
    typeDraft?.extra ?? savedTypes.filter((value) => !savedSelectionValues.has(value)).join('\n');
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
  function pickJournal(item: BankJournal) {
    setVenue(item.name);
    setIssn(item.issns.join(', '));
    setSource(item.openalexSourceId ?? '');
    changeQuery('');
    const { release, articleTypeIds } = bank ?? {};
    const journalId = item.id.startsWith('jrn.') ? item.id : undefined;
    const journalProfile = item.profile ?? (journalId ? undefined : item.id);
    setBank({
      ...(journalId ? { journalId } : {}),
      ...(journalProfile ? { journalProfile } : {}),
      ...(release ? { release } : {}),
      ...(articleTypeIds?.length ? { articleTypeIds } : {}),
    });
  }
  function editJournalField(setValue: (value: string) => void, value: string) {
    setValue(value);
    if (bank && (bank.journalId || bank.journalProfile)) setBank({ ...bank, journalEdited: true });
  }
  function saveTypeDraft(extra: string, selected: BankArticleType[]) {
    setTypeDraft({ extra, selected });
    const { journalId, journalProfile, journalEdited, release } = bank ?? {};
    const articleTypeIds = selected.map((item) => item.id);
    const linkRelease = articleTypeIds.length ? articleCatalog?.release : release;
    setBank(
      journalId || journalProfile || articleTypeIds.length
        ? {
            ...(journalId ? { journalId } : {}),
            ...(journalProfile ? { journalProfile } : {}),
            ...(journalEdited ? { journalEdited } : {}),
            ...(linkRelease ? { release: linkRelease } : {}),
            ...(articleTypeIds.length ? { articleTypeIds } : {}),
          }
        : undefined,
    );
  }
  function toggleArticleType(item: BankArticleType, checked: boolean) {
    saveTypeDraft(
      extraTypes,
      checked ? [...selectedTypes, item] : selectedTypes.filter((type) => type.id !== item.id),
    );
  }
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
            articleTypes: typeDraft ? [...new Set([...selectedAliases, ...lines(extraTypes)])] : savedTypes,
            ...(bank ? { bank } : {}),
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
            label="Research question"
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
          {canSearch && search?.status !== 'unavailable' && (
            <JournalPicker
              query={query}
              matches={search?.status === 'ok' ? search.items : undefined}
              onQuery={changeQuery}
              onChoose={pickJournal}
            />
          )}
          {kind === 'journal' && !catalog && !unavailable && (
            <p className={styles.muted} role="status">
              Đang tải danh mục từ Writing Bank…
            </p>
          )}
          {unavailable && (
            <p className={styles.muted} role="status">
              Chưa lấy được danh mục từ Writing Bank; nhập tay.
            </p>
          )}
          {bank?.journalEdited && <span className={styles.muted}>Đã sửa tay</span>}
          <TextField
            label="Tên tạp chí"
            value={venue}
            onChange={(e) => editJournalField(setVenue, e.target.value)}
          />
          <TextField
            label="ISSN (cách nhau bằng dấu phẩy)"
            value={issn}
            onChange={(e) => editJournalField(setIssn, e.target.value)}
          />
          <TextField
            label="OpenAlex source id"
            value={source}
            onChange={(e) => editJournalField(setSource, e.target.value)}
          />
          {hasTypeOptions && (
            <fieldset className={styles.articleTypes}>
              <legend>Loại bài</legend>
              {typeOptions.map((item) => (
                <Checkbox
                  key={item.id}
                  title={item.id}
                  checked={selectedTypes.some((type) => type.id === item.id)}
                  onChange={(e) => toggleArticleType(item, e.target.checked)}
                >
                  {item.name}
                </Checkbox>
              ))}
            </fieldset>
          )}
          <TextField
            label={hasTypeOptions ? 'Loại bài khác (mỗi dòng một loại)' : 'Loại bài (mỗi dòng một loại)'}
            multiline
            value={hasTypeOptions ? extraTypes : [...selectedAliases, extraTypes].join('\n')}
            onChange={(e) => saveTypeDraft(e.target.value, hasTypeOptions ? selectedTypes : [])}
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
