import { ChevronDown, ChevronUp, Download } from 'lucide-react';
import { Fragment, useState } from 'react';
import { MMAT_SCREENING, appraisalCsvRows, currentAppraisal, includedMembers } from '@/core/corpus/appraisal';
import { toCsv } from '@/core/corpus/prisma';
import type { Corpus } from '@/core/schemas';
import { downloadText } from '@/shared/calibration/download';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { DataTable } from '@/shared/ui/DataTable';
import { Dialog } from '@/shared/ui/Dialog';
import { IconButton } from '@/shared/ui/IconButton';
import { AppraisalForm } from './AppraisalForm';
import { categoryLabel, criterionLabel, judgementLabels } from './appraisalLabels';
import styles from './corpus.module.css';

const BOM = String.fromCharCode(0xfeff);

/** MMAT 2018 appraisal of the included studies: answers per criterion, counted, never summed into a score. */
export function AppraisalPanel({ corpus, save }: { corpus: Corpus; save: (value: Corpus) => Promise<void> }) {
  const [open, setOpen] = useState<string[]>([]);
  const [editing, setEditing] = useState<string>();
  const members = includedMembers(corpus);
  const target = members.find((member) => member.memberId === editing);
  const slug = corpus.id.replace(/[^A-Za-z0-9_-]+/gu, '-');
  return (
    <Card>
      <section aria-labelledby="corpus-appraisal">
        <div className={styles.cardHead}>
          <h2 id="corpus-appraisal">Đánh giá chất lượng (MMAT 2018)</h2>
          <div className={styles.cardTools}>
            <Button
              size="sm"
              leadingIcon={<Download size={16} aria-hidden="true" />}
              disabled={members.length === 0}
              onClick={() =>
                downloadText(`${slug}.mmat.csv`, BOM + toCsv(appraisalCsvRows(corpus)), 'text/csv')
              }
            >
              Tải đánh giá (CSV)
            </Button>
          </div>
        </div>
        <p className={styles.muted}>
          Không có điểm tổng: MMAT khuyên không cộng điểm vì một con số che mất tiêu chí nào chưa đạt, nên
          bảng chỉ đếm Có / Không / Không rõ.
        </p>
        {members.length === 0 ? (
          <p className={styles.muted}>Chưa có bài nào được chọn ở bước toàn văn.</p>
        ) : (
          <DataTable>
            <thead>
              <tr>
                <th>Nghiên cứu</th>
                <th>Loại nghiên cứu</th>
                <th>{judgementLabels.yes}</th>
                <th>{judgementLabels.no}</th>
                <th>{judgementLabels.cant_tell}</th>
                <th>Người đánh giá</th>
                <th aria-label="Thao tác" />
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const current = currentAppraisal(member);
                const title = member.title ?? member.identifiers.doi ?? member.exportId;
                const expanded = open.includes(member.memberId);
                return (
                  <Fragment key={member.memberId}>
                    <tr>
                      <td className={styles.memberTitle}>{title}</td>
                      <td>{current ? categoryLabel(current.category.id) : 'Chưa đánh giá'}</td>
                      <td>{current?.counts.yes ?? '—'}</td>
                      <td>{current?.counts.no ?? '—'}</td>
                      <td>{current?.counts.cant_tell ?? '—'}</td>
                      <td>{current?.appraiser ?? '—'}</td>
                      <td>
                        <span className={styles.cardTools}>
                          {current && (
                            <IconButton
                              size="sm"
                              label={`${expanded ? 'Ẩn' : 'Xem'} từng tiêu chí của ${title}`}
                              onClick={() =>
                                setOpen((ids) =>
                                  expanded
                                    ? ids.filter((id) => id !== member.memberId)
                                    : [...ids, member.memberId],
                                )
                              }
                            >
                              {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                            </IconButton>
                          )}
                          <Button size="sm" onClick={() => setEditing(member.memberId)}>
                            {current ? 'Đánh giá lại' : 'Đánh giá'}
                          </Button>
                        </span>
                      </td>
                    </tr>
                    {current && expanded && (
                      <tr>
                        <td colSpan={7}>
                          <ul className={styles.appraisalDetail} aria-label={`Tiêu chí của ${title}`}>
                            {[...MMAT_SCREENING, ...current.category.criteria].map((criterion) => {
                              const answer = current.answers[criterion.id];
                              return (
                                <li key={criterion.id}>
                                  {criterionLabel(criterion)}:{' '}
                                  {answer ? judgementLabels[answer.judgement] : 'Không trả lời'}
                                  {answer?.quote && ` — “${answer.quote}”`}
                                  {answer?.note && ` · ${answer.note}`}
                                </li>
                              );
                            })}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </DataTable>
        )}
      </section>
      {target && (
        <Dialog
          kind="form"
          title="Đánh giá MMAT 2018"
          description={target.title ?? target.identifiers.doi ?? target.exportId}
          onClose={() => setEditing(undefined)}
        >
          <AppraisalForm corpus={corpus} member={target} save={save} onDone={() => setEditing(undefined)} />
        </Dialog>
      )}
    </Card>
  );
}
