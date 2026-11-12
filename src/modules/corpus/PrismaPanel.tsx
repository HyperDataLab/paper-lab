import { Download } from 'lucide-react';
import {
  prismaBoxes,
  prismaCounts,
  screeningLogRows,
  toCsv,
  type PrismaBox,
  type PrismaBoxKey,
} from '@/core/corpus/prisma';
import type { Corpus } from '@/core/schemas';
import { downloadText } from '@/shared/calibration/download';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
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
// Excel reads a CSV without a byte-order mark in the ANSI code page and breaks the Vietnamese labels.
const BOM = String.fromCharCode(0xfeff);

function labelOf(box: PrismaBox): string {
  if (box.kind === 'source')
    return `${box.source.kind === 'database' ? 'Cơ sở dữ liệu' : 'Tệp nhập'}: ${box.source.source} (${box.source.retrieved}/${box.source.totalReported} bản ghi${box.source.notExhaustive ? ', chưa đầy đủ' : ''})`;
  if (box.kind === 'reason') return `— ${reasonLabels[box.code]}`;
  return prismaLabels[box.key];
}

/** PRISMA 2020 flow counted from the searches and the decision log; nothing here is typed in by hand. */
export function PrismaPanel({ corpus }: { corpus: Corpus }) {
  const counts = prismaCounts(corpus);
  const boxes = prismaBoxes(counts);
  const slug = corpus.id.replace(/[^A-Za-z0-9_-]+/gu, '-');
  const truncated = counts.sources.some((source) => source.notExhaustive);
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
            <Button
              size="sm"
              leadingIcon={<Download size={16} aria-hidden="true" />}
              onClick={() =>
                downloadText(
                  `${slug}.prisma.csv`,
                  BOM + toCsv([['label', 'n'], ...boxes.map((box) => [labelOf(box), box.n])]),
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
        <div className={styles.prisma}>
          {PHASES.map((phase) => (
            <div key={phase}>
              <h3>{phase}</h3>
              <dl className={styles.facts} aria-label={`PRISMA: ${phase}`}>
                {boxes
                  .map((box, index) => ({ box, index }))
                  .filter(({ box }) => phaseOf(box) === phase)
                  .map(({ box, index }) => (
                    <div key={index}>
                      <dt>{labelOf(box)}</dt>
                      <dd>{box.n}</dd>
                    </div>
                  ))}
              </dl>
            </div>
          ))}
        </div>
        <p className={styles.muted}>
          Chỉ quyết định của người sàng lọc được tính; gợi ý AI không được tính. {screeners} người đã sàng
          lọc; chưa có sàng lọc kép độc lập.
        </p>
      </section>
    </Card>
  );
}
