import { useState } from 'react';
import { z } from 'zod';
import { addMember } from '@/core/corpus/intake';
import { drawSample, harvestQuery, type Work } from '@/core/corpus/sampling';
import type { Corpus } from '@/core/schemas/corpus';
import { createScholarClient } from '@/shared/scholar/client';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';

const workSchema = z.object({
  id: z.string(),
  doi: z.string().nullable(),
  title: z.string().nullable(),
  publication_year: z.number(),
  type: z.string(),
  is_retracted: z.boolean(),
  primary_location: z
    .object({ source: z.object({ id: z.string().optional() }).nullable().optional() })
    .nullable()
    .optional(),
  biblio: z
    .object({ volume: z.string().nullable().optional(), issue: z.string().nullable().optional() })
    .nullable()
    .optional(),
  authorships: z
    .array(
      z.object({
        author: z.object({ id: z.string().optional() }).optional(),
        institutions: z.array(z.object({ country_code: z.string().nullable().optional() })).optional(),
      }),
    )
    .optional(),
});

export function JournalHarvest({ corpus, save }: { corpus: Corpus; save: (value: Corpus) => Promise<void> }) {
  const repo = useRepositories();
  const [progress, setProgress] = useState('');
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ReturnType<typeof drawSample>['report']>();
  async function run() {
    const protocol = corpus.protocol.at(-1)?.body;
    if (!protocol || !('venues' in protocol)) return;
    setBusy(true);
    setReport(undefined);
    try {
      const years = [...protocol.years].sort((a, b) => a - b);
      if (
        !years.length ||
        protocol.venues.some((v) => !v.openalexSourceId) ||
        !protocol.venues.length ||
        !protocol.seed
      )
        throw new Error('Cần năm, seed và OpenAlex source id cho mỗi tạp chí.');
      const buckets = Array.from({ length: Math.ceil(years.length / 2) }, (_, i) => ({
        from: years[i * 2] ?? 0,
        to: years[i * 2 + 1] ?? years[i * 2] ?? 0,
        target: undefined as number | undefined,
      }));
      if (corpus.kind === 'control') {
        const targetId = protocol.samplingRule.startsWith('match:') ? protocol.samplingRule.slice(6) : '';
        const target = targetId ? await repo.corpora.get(targetId) : undefined;
        if (!target || target.members.filter((m) => m.role).length === 0)
          throw new Error('Hãy lấy mẫu corpus mục tiêu trước; giao thức đối chứng cần match:<id corpus>.');
        for (const bucket of buckets)
          bucket.target = target.members.filter(
            (m) => m.role && m.stratum.year && m.stratum.year >= bucket.from && m.stratum.year <= bucket.to,
          ).length;
      }
      const client = createScholarClient({});
      const records: Work[] = [];
      for (const venue of protocol.venues) {
        let venueCount = 0;
        for (const bucket of buckets) {
          let cursor: string | null = '*';
          let count = 0;
          const url = harvestQuery({
            sourceId: venue.openalexSourceId ?? '',
            years: [bucket.from, bucket.to],
          });
          while (cursor && count < 150 && venueCount < 2000) {
            setProgress(`${venue.name} · ${bucket.from}–${bucket.to}: ${count} bản ghi`);
            const page = await client.harvestWorks(url, cursor);
            for (const raw of page.results.slice(0, Math.min(150 - count, 2000 - venueCount))) {
              const parsed = workSchema.safeParse(raw);
              if (parsed.success) records.push(parsed.data);
            }
            count += page.results.length;
            venueCount += page.results.length;
            cursor = page.results.length ? page.nextCursor : null;
          }
        }
      }
      const result = drawSample(records, {
        size: 150,
        buckets,
        minPerBucket: 20,
        capPerIssue: protocol.capPerIssue,
        heldOutShare: 0.2,
        seed: protocol.seed,
      });
      let next = corpus;
      const at = new Date().toISOString();
      for (const { work, role } of result.sample) {
        const added = addMember(
          next,
          { doi: work.doi, openalexId: work.id, title: work.title, year: work.publication_year },
          at,
        );
        next = added.corpus;
        if (!('memberId' in added)) continue;
        next = {
          ...next,
          members: next.members.map((m) =>
            m.memberId !== added.memberId
              ? m
              : {
                  ...m,
                  role,
                  version: 'publishedVersion',
                  stratum: {
                    ...m.stratum,
                    year: work.publication_year,
                    articleType: work.type,
                    issue: [work.biblio?.volume, work.biblio?.issue].filter(Boolean).join('/') || undefined,
                  },
                  authorIds: [
                    ...new Set(
                      (work.authorships ?? [])
                        .map((a) => a.author?.id)
                        .filter((v): v is string => Boolean(v)),
                    ),
                  ],
                  countries: [
                    ...new Set(
                      (work.authorships ?? [])
                        .flatMap((a) => (a.institutions ?? []).map((i) => i.country_code))
                        .filter((v): v is string => Boolean(v)),
                    ),
                  ],
                },
          ),
        };
      }
      await save(next);
      setReport(result.report);
      setProgress(`Đã chọn ${result.sample.length} bài.`);
    } catch (e) {
      setProgress(`Lỗi: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <h2>Lấy mẫu từ OpenAlex</h2>
      <p>
        Seed:{' '}
        {'seed' in (corpus.protocol.at(-1)?.body ?? {})
          ? (corpus.protocol.at(-1)?.body as { seed: string }).seed
          : ''}
      </p>
      <p>Chỉ các bài xuất bản mở; lựa chọn OA hỗn hợp có thể làm lệch quốc gia, tài trợ và chủ đề.</p>
      <Button disabled={busy} onClick={() => void run()}>
        Lấy mẫu từ OpenAlex
      </Button>
      <p role="status">{progress}</p>
      {report && (
        <div>
          <h3>Báo cáo lấy mẫu</h3>
          <ul>
            {report.buckets.map((b) => (
              <li key={b.from}>
                {b.from}–{b.to}: {b.count}/{b.target}, thiếu {b.shortfall}
              </li>
            ))}
          </ul>
          <p>Loại: {JSON.stringify(report.exclusions)}</p>
        </div>
      )}
    </Card>
  );
}
