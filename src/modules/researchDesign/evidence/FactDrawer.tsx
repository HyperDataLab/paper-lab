import { useState } from 'react';
import { Link } from 'react-router-dom';
import { findBenchmark, findMetric } from '@/core/researchDesign/bank/readSnapshot';
import type { BankDoc } from '@/core/researchDesign/bank/snapshot';
import { resolveAnchors } from '@/core/researchDesign/facts/anchors';
import type { ExperimentFact } from '@/core/researchDesign/facts/experimentFacts';
import type { FactsDoc } from '@/core/researchDesign/facts/factsDoc';
import { matchState, offerMatches, resolveMatch } from '@/core/researchDesign/facts/match';
import type { Paper, PaperModelView } from '@/core/researchDesign/papers';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Drawer } from '@/shared/ui/Drawer';
import { SheetSection } from '@/shared/ui/SheetSection';
import { TextField } from '@/shared/ui/TextField';
import styles from './evidence.module.css';

export function FactDrawer({
  paper,
  fact,
  doc,
  model,
  bank,
  close,
  change,
  match,
}: {
  paper: Paper;
  fact: ExperimentFact;
  doc: FactsDoc;
  model: PaperModelView;
  bank: BankDoc | null;
  close: () => void;
  change: (action: 'use' | 'exclude' | 'clear', reason: string | null) => Promise<boolean>;
  match: (id: string | null) => void;
}) {
  const [reason, setReason] = useState('');
  const [excluding, setExcluding] = useState(false);
  const decideFact = async (action: 'use' | 'exclude' | 'clear', input: string | null) => {
    if (await change(action, input)) {
      setExcluding(false);
      setReason('');
    }
  };
  const anchors = resolveAnchors(fact, model);
  const decision = Object.hasOwn(doc.decisions, fact.id) ? doc.decisions[fact.id] : undefined;
  const confirmed = doc.matches?.[fact.id]?.bank;
  const resolved = confirmed && resolveMatch(confirmed, bank);
  const entry = resolved
    ? fact.kind === 'metric'
      ? findMetric(bank, resolved)
      : findBenchmark(bank, resolved)
    : undefined;
  const offers = offerMatches(fact, bank);
  const value = (id: string | null) => doc.facts.facts.find((item) => item.id === id)?.value ?? id;
  const paperId = paper.model?.paperlab?.paperId;
  const place = (page: number | null | undefined) => (page != null ? ` · Tr. ${page}` : '');
  const opener = (page: number | null | undefined) =>
    paperId ? (
      <Link className={styles.link} to={`/papers/${encodeURIComponent(paperId)}`}>
        {paper.title}
        {place(page)}
      </Link>
    ) : (
      <span className={styles.where}>
        {paper.title}
        {place(page)}
      </span>
    );
  const details = [
    ['Số', fact.number === null ? null : String(fact.number)],
    ['Đơn vị', fact.unit],
    ['Độ bất định', fact.uncertainty],
    ['Điều kiện', fact.condition],
    ['Metric', fact.metric && value(fact.metric)],
    ['Dataset', fact.dataset && value(fact.dataset)],
    ['Hệ thống', fact.system && value(fact.system)],
  ].filter((row): row is [string, string] => !!row[1]);
  return (
    <Drawer
      open
      onClose={close}
      side="right"
      label="Chi tiết dữ kiện"
      title={fact.value}
      description={`PaperLab: ${fact.status === 'candidate' ? 'Chưa duyệt' : 'Đã duyệt'}`}
      footer={
        <>
          <Button variant="ghost" onClick={() => void decideFact('clear', null)}>
            Bỏ quyết định
          </Button>
          <Button onClick={() => setExcluding(true)}>Loại</Button>
          <Button variant="primary" disabled={!anchors.anchored} onClick={() => void decideFact('use', null)}>
            Dùng
          </Button>
        </>
      }
    >
      {details.length > 0 && (
        <dl className={styles.details}>
          {details.map(([label, text]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{text}</dd>
            </div>
          ))}
        </dl>
      )}
      <SheetSection title="Nguồn trong bài">
        {anchors.sentences.map((sentence) =>
          sentence.found ? (
            <div className={styles.quote} key={sentence.key}>
              <blockquote>{sentence.text}</blockquote>
              {opener(sentence.page)}
            </div>
          ) : (
            <p className={styles.missing} key={sentence.key}>
              Không tìm thấy trong paper model đang giữ ({sentence.key})
            </p>
          ),
        )}
        {anchors.tableCell &&
          (anchors.tableCell.found ? (
            <div className={styles.quote}>
              <p>
                Bảng, hàng {anchors.tableCell.row}, cột {anchors.tableCell.column}
              </p>
              {(anchors.tableCell.rowHeader || anchors.tableCell.columnHeader) && (
                <p>
                  {[anchors.tableCell.rowHeader, anchors.tableCell.columnHeader].filter(Boolean).join(' ')}
                </p>
              )}
              <blockquote>{anchors.tableCell.blockText}</blockquote>
              {opener(anchors.tableCell.page)}
            </div>
          ) : (
            <p className={styles.missing}>Không tìm thấy trong paper model đang giữ</p>
          ))}
        {!anchors.anchored && (
          <p className={styles.hint}>Chưa thể đặt Dùng: không tìm thấy neo nào của dữ kiện này.</p>
        )}
      </SheetSection>
      {bank && (fact.kind === 'metric' || fact.kind === 'dataset') && (
        <SheetSection title="Writing Bank">
          {confirmed ? (
            <div className={styles.row}>
              <span>
                {entry?.name ?? fact.value} · <code>{confirmed.id}</code> · {confirmed.release}
              </span>
              {entry?.status === 'draft' && <Badge>Bản nháp</Badge>}
              {matchState(confirmed, bank) === 'other_release' && (
                <Badge tone="warning">Khác bản phát hành</Badge>
              )}
              <Button size="sm" variant="ghost" onClick={() => match(null)}>
                Bỏ khớp
              </Button>
            </div>
          ) : offers.length ? (
            offers.map((offer) => (
              <div className={styles.row} key={offer.id}>
                <span>Khớp theo tên: {offer.name}</span>
                {(findMetric(bank, offer.id) ?? findBenchmark(bank, offer.id))?.status === 'draft' && (
                  <Badge>Bản nháp</Badge>
                )}
                <Button size="sm" onClick={() => match(offer.id)}>
                  Xác nhận
                </Button>
              </div>
            ))
          ) : (
            <p className={styles.hint}>Không có mục trùng tên trong Writing Bank</p>
          )}
        </SheetSection>
      )}
      <SheetSection title="Quyết định của dự án">
        {decision ? (
          <p>
            {decision.decision === 'use' ? 'Dùng' : 'Loại'} · {new Date(decision.at).toLocaleString('vi-VN')}
            {decision.reason && ` · ${decision.reason}`}
          </p>
        ) : (
          <p className={styles.hint}>Chưa có quyết định.</p>
        )}
        {excluding && (
          <div className={styles.row}>
            <TextField
              label="Lý do loại"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            <Button onClick={() => void decideFact('exclude', reason)}>Xác nhận loại</Button>
          </div>
        )}
      </SheetSection>
    </Drawer>
  );
}
