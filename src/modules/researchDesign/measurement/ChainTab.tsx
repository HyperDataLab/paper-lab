import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { checkChain } from '@/core/researchDesign/draft/checkChain';
import { setHypothesisVariables } from '@/core/researchDesign/draft/measureOps';
import type { Draft, DraftHypothesis } from '@/core/researchDesign/draft/schema';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { Dialog, DialogActions } from '@/shared/ui/Dialog';
import { OptionCard } from '@/shared/ui/OptionCard';
import { SheetSection } from '@/shared/ui/SheetSection';
import { Empty } from '@/shared/ui/StateNote';
import { ChainLine } from '../analyses/ChainLine';
import { chainFlagText } from './flagText';
import type { Change } from './useDraftChange';
import styles from './Measurement.module.css';

type Selection = { independent: string[]; dependent: string[] };

/** Hypothesis → dependent variable → metric, one line per hypothesis, with the CH checks that the line does not show. */
export function ChainTab({ draft, change }: { draft: Draft; change: Change }) {
  const [params] = useSearchParams();
  const [editing, setEditing] = useState<DraftHypothesis | null>(null);
  const [selected, setSelected] = useState<Selection>({ independent: [], dependent: [] });
  const flags = checkChain(draft);
  const questionsHref = (() => {
    const next = new URLSearchParams(params);
    next.set('design', 'questions');
    return `?${next.toString()}`;
  })();
  return (
    <>
      {!draft.hypotheses.length && (
        <Empty title="Chưa có giả thuyết nào.">
          <Link to={questionsHref}>Câu hỏi và giả thuyết</Link>
        </Empty>
      )}
      {!!draft.hypotheses.length && !draft.variables.length && (
        <p className={styles.quiet}>Chưa có biến nào. Thêm biến ở tab Biến.</p>
      )}
      <div className={styles.list}>
        {draft.hypotheses.map((h) => (
          <Card key={h.id} padding="md">
            <div className={styles.row}>
              <ChainLine draft={draft} hypothesisId={h.id} />
              {flags
                .filter(
                  (f) =>
                    f.subject === h.id &&
                    // The line already says these: no dependent variable, or one that does not exist.
                    f.rule !== 'CH-01' &&
                    !(f.rule === 'CH-03' && f.which === 'missing' && h.dependent.includes(f.variable)),
                )
                .map((f, i) => (
                  <p key={i}>
                    <Badge tone="warning">Cần xem lại</Badge> {chainFlagText(f, draft)}
                  </p>
                ))}
              <div className={styles.actions}>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setEditing(h);
                    setSelected({ independent: h.independent, dependent: h.dependent });
                  }}
                >
                  Gắn biến
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
      {editing && (
        <Dialog
          kind="form"
          title="Gắn biến"
          description="Chọn các biến của giả thuyết."
          onClose={() => setEditing(null)}
        >
          {(['independent', 'dependent'] as const).map((role) => (
            <SheetSection key={role} title={role === 'independent' ? 'Biến độc lập' : 'Biến phụ thuộc'}>
              {draft.variables
                .filter((v) => v.role === role)
                .map((v) => (
                  <OptionCard
                    key={v.id}
                    checked={selected[role].includes(v.id)}
                    onChange={(checked) =>
                      setSelected({
                        ...selected,
                        [role]: checked
                          ? [...selected[role], v.id]
                          : selected[role].filter((id) => id !== v.id),
                      })
                    }
                    title={`${v.id} ${v.name}`}
                  />
                ))}
            </SheetSection>
          ))}
          <DialogActions>
            <Button onClick={() => setEditing(null)}>Hủy</Button>
            <Button
              variant="primary"
              onClick={() => {
                void change((d) => setHypothesisVariables(d, editing.id, selected)).then((ok) => {
                  if (ok) setEditing(null);
                });
              }}
            >
              Lưu
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </>
  );
}
