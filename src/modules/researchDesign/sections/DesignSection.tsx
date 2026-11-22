import { useState } from 'react';
import { Link } from 'react-router-dom';
import { findClaimType, findDesign, findThreat } from '@/core/researchDesign/bank/readSnapshot';
import { checkDesign, type DesignFlag } from '@/core/researchDesign/draft/checkDesign';
import {
  addThreat,
  editThreat,
  removeThreat,
  repin,
  setAssignment,
  setDesign,
} from '@/core/researchDesign/draft/ops';
import type { Draft, DraftThreat } from '@/core/researchDesign/draft/schema';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { Dialog } from '@/shared/ui/Dialog';
import { SegmentedControl } from '@/shared/ui/SegmentedControl';
import { Empty, Loading } from '@/shared/ui/StateNote';
import { useToast } from '@/shared/ui/toastContext';
import { useResearchDesign } from '../ResearchDesignProvider';
import { SectionSuggest } from '../evidence/SectionSuggest';
import { DesignDrawer } from '../design/DesignDrawer';
import { ThreatDialog } from '../design/ThreatDialog';
import { flagText } from '../design/flagText';
import { assignments, word } from '../design/words';
import { saveDraftChange } from '../design/saveDraftChange';

export default function DesignSection() {
  const state = useResearchDesign();
  const toast = useToast();
  const [drawer, setDrawer] = useState(false);
  const [editing, setEditing] = useState<DraftThreat | 'new' | null>(null);
  const [deleting, setDeleting] = useState<DraftThreat | null>(null);
  if (state.loading) return <Loading />;
  if (state.error) return <Empty title="Không tải được research design." />;
  const { draft } = state.design;
  const { bank } = state;
  const change = (fn: Parameters<typeof saveDraftChange>[1]) => saveDraftChange(state.save, fn, toast);
  const flags = checkDesign(draft, bank);
  const design = draft.design?.bank && findDesign(bank, draft.design.bank.id);
  const offered =
    design?.threats
      .map((id) => findThreat(bank, id))
      .filter((t) => t && !draft.threats.some((x) => x.bank?.id === t.id)) ?? [];
  const warning = (flag: DesignFlag) => (
    <p key={`${flag.rule}-${flag.subject}-${'id' in flag ? flag.id : ''}`}>
      <Badge tone="warning">Cần xem lại</Badge> {flagText(flag, draft, bank)}
    </p>
  );
  return (
    <>
      <p>Chọn research design, xem nó cho phép kết luận gì, ghi threat to validity và cách giảm.</p>
      <SectionSuggest state={state} target="threats" />
      {bank && flags.some((f) => f.rule === 'DS-05' && f.reason === 'other_release') && (
        <Card>
          <p>Một số tham chiếu thuộc bản chụp cũ nhưng vẫn có trong bản chụp hiện tại.</p>
          <Button onClick={() => void change((d) => repin(d, bank))}>Ghim lại theo bản chụp hiện tại</Button>
        </Card>
      )}
      <Card>
        <h3>Thiết kế nghiên cứu đã chọn</h3>
        {!draft.design ? (
          <Empty title="Chưa chọn research design" hint="Chọn một research design để bắt đầu.">
            <Button variant="primary" onClick={() => setDrawer(true)}>
              Chọn research design
            </Button>
          </Empty>
        ) : (
          <>
            <p>
              {draft.design.name} {design?.status === 'draft' && <Badge>Bản nháp của bank</Badge>}
            </p>
            {flags
              .filter((f) => f.rule === 'DS-05' && f.reason !== 'other_release' && f.subject === 'design')
              .map(warning)}
            <p>Cách phân nhóm</p>
            <fieldset disabled={!!design && design.assignment !== 'either'}>
              <SegmentedControl
                label="Cách phân nhóm"
                value={draft.design.assignment ?? ''}
                options={assignments}
                onChange={(v) =>
                  void change((d) => setAssignment(d, v as NonNullable<Draft['design']>['assignment']))
                }
              />
            </fieldset>
            {design && design.assignment !== 'either' && (
              <p>Writing Bank quy định cách phân nhóm của research design này.</p>
            )}
            {flags.filter((f) => f.rule === 'DS-03').map(warning)}
            <Button variant="ghost" onClick={() => setDrawer(true)}>
              Đổi research design
            </Button>
          </>
        )}
      </Card>
      <Card>
        <h3>Research design này cho phép kết luận gì</h3>
        {!draft.design ? (
          <p>Chưa chọn research design.</p>
        ) : !draft.design.bank ? (
          <p>
            Research design tự mô tả không có thông tin từ Writing Bank, nên không kiểm tra được hypothesis.
          </p>
        ) : design ? (
          <>
            <p>Khả năng kết luận nhân quả: {word('causalLicence', design.causalLicence)}</p>
            <h4>Hỗ trợ</h4>
            <ul>
              {design.supports.map((id) => (
                <li key={id}>
                  {findClaimType(bank, id)?.name ?? id}{' '}
                  {findClaimType(bank, id)?.status === 'draft' && <Badge>Bản nháp của bank</Badge>}
                </li>
              ))}
            </ul>
            <h4>Không hỗ trợ</h4>
            <ul>
              {design.cannotSupport.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
            <h4>Hypotheses cần xem lại</h4>
            {flags.some((f) => f.rule === 'DS-01') ? (
              flags
                .filter((f) => f.rule === 'DS-01')
                .map((f) => (
                  <div key={f.subject}>
                    <Link to="?design=questions">{f.subject}</Link>
                    {warning(f)}
                  </div>
                ))
            ) : (
              <p>Không có hypothesis nào cần xem lại.</p>
            )}
          </>
        ) : (
          <p>Không có thông tin research design trong bản chụp hiện tại.</p>
        )}
      </Card>
      <Card>
        <h3>Threats to validity</h3>
        {draft.threats.length === 0 && <p>Chưa có threat to validity trong danh sách.</p>}
        {draft.threats.map((t) => (
          <div key={t.id}>
            <p>
              {t.id} · {t.name}{' '}
              {t.bank && findThreat(bank, t.bank.id)?.status === 'draft' && <Badge>Bản nháp của bank</Badge>}
            </p>
            <p>
              {t.mitigation ? (
                `Cách giảm trong nghiên cứu này: ${t.mitigation}`
              ) : (
                <>
                  <Badge tone="warning">Cần xem lại</Badge> Chưa ghi cách giảm
                </>
              )}
            </p>
            {flags
              .filter((f) => f.rule === 'DS-05' && f.reason !== 'other_release' && f.subject === t.id)
              .map(warning)}
            <Button variant="ghost" onClick={() => setEditing(t)}>
              Sửa
            </Button>
            <Button variant="ghost" onClick={() => setDeleting(t)}>
              Xoá
            </Button>
          </div>
        ))}
        {offered.length > 0 && <h4>Gợi ý từ research design</h4>}
        {design && design.threats.length > 0 && offered.length === 0 && (
          <p>Đã thêm mọi threats to validity mà research design này gợi ý.</p>
        )}
        {offered.map(
          (t) =>
            t && (
              <div key={t.id}>
                <strong>{t.name}</strong> {t.status === 'draft' && <Badge>Bản nháp của bank</Badge>}
                <p>
                  {word('validity', t.type)} · {t.mechanism}
                </p>
                <p>Gợi ý chung của bank: {t.mitigation}</p>
                {bank && (
                  <Button
                    onClick={() =>
                      void change((d) =>
                        addThreat(d, {
                          name: t.name,
                          mitigation: '',
                          bank: { id: t.id, release: bank.release },
                        }),
                      )
                    }
                  >
                    Thêm vào danh sách
                  </Button>
                )}
              </div>
            ),
        )}
        <Button onClick={() => setEditing('new')}>Thêm threat to validity</Button>
      </Card>
      {drawer && (
        <DesignDrawer
          bank={bank}
          onClose={() => setDrawer(false)}
          choose={(value) =>
            void change((d) => setDesign(d, value)).then((ok) => {
              if (ok) setDrawer(false);
            })
          }
        />
      )}
      {editing && (
        <ThreatDialog
          threat={editing === 'new' ? null : editing}
          close={() => setEditing(null)}
          save={(name, mitigation) =>
            void change((d) =>
              editing === 'new'
                ? addThreat(d, { name, mitigation, bank: null })
                : editThreat(d, editing.id, { name, mitigation }),
            ).then((ok) => {
              if (ok) setEditing(null);
            })
          }
        />
      )}
      {deleting && (
        <Dialog
          title="Xoá threat to validity"
          description={`Xoá «${deleting.name}» khỏi danh sách?`}
          onClose={() => setDeleting(null)}
        >
          <Button onClick={() => setDeleting(null)}>Hủy</Button>
          <Button
            variant="danger"
            onClick={() =>
              void change((d) => removeThreat(d, deleting.id)).then((ok) => {
                if (ok) setDeleting(null);
              })
            }
          >
            Xoá
          </Button>
        </Dialog>
      )}
    </>
  );
}
