import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { checkChain } from '@/core/researchDesign/draft/checkChain';
import { checkDesign } from '@/core/researchDesign/draft/checkDesign';
import {
  addCondition,
  addDataset,
  addMetric,
  addVariable,
  editCondition,
  editDataset,
  editMetric,
  editVariable,
  removeCondition,
  removeDataset,
  removeMetric,
  removeVariable,
  users,
} from '@/core/researchDesign/draft/measureOps';
import { repin, type DraftResult } from '@/core/researchDesign/draft/ops';
import type {
  Draft,
  DraftCondition,
  DraftDataset,
  DraftMetric,
  DraftVariable,
} from '@/core/researchDesign/draft/schema';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { Dialog, DialogActions } from '@/shared/ui/Dialog';
import { Empty, Loading } from '@/shared/ui/StateNote';
import { Tabs } from '@/shared/ui/Tabs';
import { useResearchDesign } from '../ResearchDesignProvider';
import { SectionSuggest } from '../evidence/SectionSuggest';
import { ChainTab } from '../measurement/ChainTab';
import { ConditionDialog } from '../measurement/ConditionDialog';
import { DatasetDialog, type DatasetInput } from '../measurement/DatasetDialog';
import { chainFlagText, referenceFlagText } from '../measurement/flagText';
import { ItemDetails, type Item } from '../measurement/ItemDetails';
import { MetricDialog, type MetricInput } from '../measurement/MetricDialog';
import { Pickers } from '../measurement/Pickers';
import { RepinNotice } from '../measurement/RepinNotice';
import { readTab, tabHref, tabLabels, type ListTab, type Tab } from '../measurement/tabs';
import { useDraftChange } from '../measurement/useDraftChange';
import { VariableDialog } from '../measurement/VariableDialog';
import styles from '../measurement/Measurement.module.css';

type Editor = { type: ListTab; item?: Item; metric?: MetricInput; dataset?: DatasetInput };

function withoutId<T extends { id: string }>(item: T): Omit<T, 'id'> {
  const { id, ...value } = item;
  void id;
  return value;
}
const removers: Record<ListTab, (d: Draft, id: string) => DraftResult> = {
  variables: removeVariable,
  metrics: removeMetric,
  datasets: removeDataset,
  conditions: removeCondition,
};
const lower = (tab: Tab) => tabLabels[tab].toLocaleLowerCase();
const count = (value: number) => new Intl.NumberFormat('vi-VN').format(value);

export default function MeasurementSection() {
  const state = useResearchDesign();
  const change = useDraftChange();
  const [params, setParams] = useSearchParams();
  const [picker, setPicker] = useState<'metrics' | 'datasets' | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [deleting, setDeleting] = useState<Item | null>(null);
  const closePicker = useCallback(() => setPicker(null), []);
  if (state.loading) return <Loading />;
  // TODO: add "Thử lại" once the provider offers reload().
  if (state.error) return <Empty title="Không tải được measurement." />;
  const { draft } = state.design;
  const bank = state.bank;
  const tab = readTab(params);
  const chainFlags = checkChain(draft);
  const designFlags = checkDesign(draft, bank);
  const counts: Record<Tab, number> = {
    chain: draft.hypotheses.length,
    variables: draft.variables.length,
    metrics: draft.metrics.length,
    datasets: draft.datasets.length,
    conditions: draft.conditions.length,
  };
  const rows: Item[] = tab === 'chain' ? [] : draft[tab];
  const deletingUsers = deleting ? users(draft, deleting.id) : [];
  return (
    <div className={styles.stack}>
      <SectionSuggest state={state} target="metrics" />
      <RepinNotice
        flags={designFlags}
        bank={bank}
        onRepin={(b) => {
          void change((d) => repin(d, b));
        }}
      />
      <Tabs label="Measurement">
        {(Object.keys(tabLabels) as Tab[]).map((t) => (
          <Button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setParams(new URLSearchParams(tabHref(params, t)))}
          >
            {`${tabLabels[t]} (${count(counts[t])})`}
          </Button>
        ))}
      </Tabs>
      {tab === 'chain' ? (
        <ChainTab draft={draft} change={change} />
      ) : (
        <>
          <div className={styles.toolbar}>
            <Button
              variant="primary"
              onClick={() =>
                tab === 'metrics' || tab === 'datasets' ? setPicker(tab) : setEditor({ type: tab })
              }
            >
              Thêm {lower(tab)}
            </Button>
          </div>
          {!rows.length && <Empty title={`Chưa có ${lower(tab)} nào.`} />}
          <div className={styles.list}>
            {rows.map((item) => (
              <Card key={item.id} padding="md">
                <div className={styles.row}>
                  <p className={styles.title}>
                    <span className={styles.mono}>{item.id}</span> {item.name}{' '}
                    {'baseline' in item && item.baseline && <Badge>Baseline</Badge>}
                  </p>
                  <ItemDetails
                    item={item}
                    draft={draft}
                    bank={bank}
                    metricsHref={tabHref(params, 'metrics')}
                  />
                  {chainFlags
                    .filter((f) => f.subject === item.id)
                    .map((f, i) => (
                      <p key={i}>
                        <Badge tone="warning">Cần xem lại</Badge> {chainFlagText(f, draft)}
                      </p>
                    ))}
                  {designFlags.map((f, i) =>
                    f.rule === 'DS-05' && f.reason !== 'other_release' && f.subject === item.id ? (
                      <p key={i}>
                        <Badge tone="warning">Cần xem lại</Badge> {referenceFlagText(f, draft)}
                      </p>
                    ) : null,
                  )}
                  <div className={styles.actions}>
                    <Button variant="ghost" onClick={() => setEditor({ type: tab, item })}>
                      Sửa
                    </Button>
                    <Button variant="ghost" onClick={() => setDeleting(item)}>
                      Xoá
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
      {picker && (
        <Pickers
          kind={picker}
          bank={bank}
          close={closePicker}
          metric={(metric) => {
            setPicker(null);
            setEditor({ type: 'metrics', metric });
          }}
          dataset={(dataset) => {
            setPicker(null);
            setEditor({ type: 'datasets', dataset });
          }}
        />
      )}
      {editor?.type === 'variables' && (
        <VariableDialog
          item={editor.item as DraftVariable | undefined}
          draft={draft}
          close={() => setEditor(null)}
          save={(v) => change((d) => (editor.item ? editVariable(d, editor.item.id, v) : addVariable(d, v)))}
        />
      )}
      {editor?.type === 'metrics' && (editor.item || editor.metric) && (
        <MetricDialog
          initial={editor.item ? withoutId(editor.item as DraftMetric) : (editor.metric as MetricInput)}
          bank={bank}
          close={() => setEditor(null)}
          save={(v) => change((d) => (editor.item ? editMetric(d, editor.item.id, v) : addMetric(d, v)))}
        />
      )}
      {editor?.type === 'datasets' && (editor.item || editor.dataset) && (
        <DatasetDialog
          initial={editor.item ? withoutId(editor.item as DraftDataset) : (editor.dataset as DatasetInput)}
          close={() => setEditor(null)}
          save={(v) => change((d) => (editor.item ? editDataset(d, editor.item.id, v) : addDataset(d, v)))}
        />
      )}
      {editor?.type === 'conditions' && (
        <ConditionDialog
          initial={editor.item as DraftCondition | undefined}
          close={() => setEditor(null)}
          save={(v) =>
            change((d) => (editor.item ? editCondition(d, editor.item.id, v) : addCondition(d, v)))
          }
        />
      )}
      {deleting && tab !== 'chain' && (
        <Dialog
          title={`Xoá ${lower(tab)}`}
          description={
            deletingUsers.length
              ? `${deleting.id} đang được dùng bởi ${deletingUsers
                  .map((id) => (id === 'runMatrix' ? 'lưới chạy' : id))
                  .join(', ')}. Gỡ liên kết trước khi xoá.`
              : `Xoá ${deleting.id} «${deleting.name}»?`
          }
          onClose={() => setDeleting(null)}
        >
          <DialogActions>
            <Button onClick={() => setDeleting(null)}>Hủy</Button>
            {!deletingUsers.length && (
              <Button
                variant="danger"
                onClick={() => {
                  void change((d) => removers[tab](d, deleting.id)).then((ok) => {
                    if (ok) setDeleting(null);
                  });
                }}
              >
                Xoá
              </Button>
            )}
          </DialogActions>
        </Dialog>
      )}
    </div>
  );
}
