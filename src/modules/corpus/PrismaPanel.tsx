import { Download } from 'lucide-react';
import { useState } from 'react';
import {
  prismaBoxes,
  prismaCounts,
  screeningLogRows,
  toCsv,
  type PrismaBox,
  type PrismaBoxKey,
  type PrismaColumn,
  type PrismaScope,
} from '@/core/corpus/prisma';
import { currentRound } from '@/core/corpus/updateSearch';
import type { Corpus } from '@/core/schemas';
import { downloadText } from '@/shared/calibration/download';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { DataTable } from '@/shared/ui/DataTable';
import { SegmentedControl } from '@/shared/ui/SegmentedControl';
import { prismaLabels, reasonLabels } from './labels';
import styles from './corpus.module.css';

const IDENTIFICATION: PrismaBoxKey[] = [
  'identified',
  'identifiedOtherMethods',
  'duplicatesRemoved',
  'awaitingDuplicateCheck',
  'recordsOutsideSearches',
];
function phaseOf(box: PrismaBox) {
  if (box.kind === 'source' || (box.kind === 'box' && IDENTIFICATION.includes(box.key))) return 'Nhận diện';
  if (box.kind === 'box' && box.key === 'studiesIncluded') return 'Đưa vào';
  return 'Sàng lọc';
}
const PHASES = ['Nhận diện', 'Sàng lọc', 'Đưa vào'];
const COLUMNS: Record<PrismaColumn, string> = {
  databases: 'Cơ sở dữ liệu và tệp nhập',
  otherMethods: 'Cách khác: tìm theo trích dẫn',
  total: 'Tổng',
};
// Excel reads a CSV without a byte-order mark in the ANSI code page and breaks the Vietnamese labels.
const BOM = String.fromCharCode(0xfeff);

function labelOf(box: PrismaBox): string {
  if (box.kind === 'source') {
    const { source } = box;
    const tail = `${source.retrieved}/${source.totalReported} bản ghi${source.notExhaustive ? ', chưa đầy đủ' : ''}`;
    const update = source.updateRound > 0 ? `, cập nhật ${source.updateRound}` : '';
    if (source.kind === 'citation')
      return `Trích dẫn ${source.source === 'snowball-backward' ? 'ngược' : 'xuôi'}, vòng ${source.snowballRound ?? 1}${update} (${tail})`;
    return `${source.kind === 'database' ? 'Cơ sở dữ liệu' : 'Tệp nhập'}: ${source.source}${update} (${tail})`;
  }
  if (box.kind === 'reason') return `— ${reasonLabels[box.code]}`;
  if (box.column === 'total') return 'Tổng số nghiên cứu được đưa vào tổng quan';
  return prismaLabels[box.key];
}

/** PRISMA 2020 flow counted from the searches and the decision log; nothing here is typed in by hand. */
export function PrismaPanel({ corpus }: { corpus: Corpus }) {
  const [scope, setScope] = useState<PrismaScope>('all');
  const round = currentRound(corpus);
  const counts = prismaCounts(corpus, scope);
  const boxes = prismaBoxes(counts);
  const slug = corpus.id.replace(/[^A-Za-z0-9_-]+/gu, '-');
  const truncated = [...counts.sources, ...counts.otherMethods.sources].some(
    (source) => source.notExhaustive,
  );
  const screeners = new Set(
    corpus.members.flatMap((member) =>
      member.decisions.flatMap((d) =>
        d.decider.kind === 'person' && d.decider.name ? [d.decider.name] : [],
      ),
    ),
  ).size;
  return (
    <Card>
      <section aria-labelledby="corpus-prisma">
        <div className={styles.cardHead}>
          <h2 id="corpus-prisma">PRISMA 2020</h2>
          <div className={styles.cardTools}>
            {round > 0 && (
              <SegmentedControl
                label="Phạm vi PRISMA"
                value={scope}
                onChange={(value) => setScope(value as PrismaScope)}
                options={[
                  { value: 'all', label: 'Mọi vòng' },
                  { value: 'latest', label: `Chỉ lần cập nhật ${round}` },
                ]}
              />
            )}
            <Button
              size="sm"
              leadingIcon={<Download size={16} aria-hidden="true" />}
              onClick={() =>
                downloadText(
                  `${slug}.prisma${counts.round === null ? '' : `.update-${counts.round}`}.csv`,
                  BOM +
                    toCsv([
                      ['column', 'label', 'n'],
                      ...boxes.map((box) => [COLUMNS[box.column], labelOf(box), box.n]),
                    ]),
                  'text/csv',
                )
              }
            >
              Tải PRISMA (CSV)
            </Button>
            <Button
              size="sm"
              leadingIcon={<Download size={16} aria-hidden="true" />}
              onClick={() =>
                downloadText(`${slug}.screening-log.csv`, BOM + toCsv(screeningLogRows(corpus)), 'text/csv')
              }
            >
              Tải nhật ký sàng lọc (CSV)
            </Button>
          </div>
        </div>
        {truncated && (
          <p className={styles.notice}>
            Có lượt tìm kiếm bị giới hạn số kết quả: nguồn đó chưa được tìm đầy đủ.
          </p>
        )}
        <DataTable aria-label="Bảng lưu chuyển PRISMA 2020" className={styles.prismaTable}>
          <thead>
            <tr>
              <th>Nguồn / nhánh</th>
              <th>Chỉ số PRISMA</th>
              <th className={styles.prismaCountHeader}>Số lượng</th>
            </tr>
          </thead>
          {PHASES.map((phase) => (
            <tbody key={phase}>
              <tr className={styles.prismaPhaseRow}>
                <th colSpan={3} scope="rowgroup">
                  {phase}
                </th>
              </tr>
              {boxes
                .map((box, index) => ({ box, index }))
                .filter(({ box }) => phaseOf(box) === phase)
                .map(({ box, index }) => (
                  <tr key={index}>
                    <td className={styles.prismaSource}>{COLUMNS[box.column]}</td>
                    <td>{labelOf(box)}</td>
                    <td className={styles.prismaCount}>{box.n}</td>
                  </tr>
                ))}
            </tbody>
          ))}
        </DataTable>
        <p className={styles.muted}>
          Chỉ quyết định của người sàng lọc được tính; gợi ý AI không được tính. {screeners} người đã sàng
          lọc; chưa có sàng lọc kép độc lập.
          {counts.round !== null && ` Chỉ tính lượt tìm kiếm và bài của lần cập nhật ${counts.round}.`}
        </p>
      </section>
    </Card>
  );
}
