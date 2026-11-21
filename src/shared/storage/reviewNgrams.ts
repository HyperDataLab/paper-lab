import { ReviewNgramSchema } from '@/core/schemas';
import { ReviewNgramBucketSchema } from '@/core/storage/collections';
import type { z } from 'zod';
import type { DocReader, DocTx } from './docStore';

type Ngram = z.infer<typeof ReviewNgramSchema>;
const collection = 'reviewNgrams';

export async function readReviewNgrams(reader: DocReader) {
  return (await reader.query(collection)).flatMap(({ doc }) => {
    const bucket = ReviewNgramBucketSchema.safeParse(doc);
    return bucket.success
      ? bucket.data.hashes.map((hash) => ({ hash, paperId: bucket.data.paperId }))
      : [ReviewNgramSchema.parse(doc)];
  });
}

export async function replaceReviewNgrams(tx: DocTx, paperId: string, ngrams: Ngram[]) {
  const current = new Map((await tx.query(collection, { where: { paperId } })).map((row) => [row.id, row]));
  // Real reviews produce hundreds of hashes. Pack them so a replacement fits in one atomic worker commit.
  const size = 700;
  const hashes = ngrams.map((item) => item.hash).sort();
  const records =
    ngrams.length <= 25
      ? ngrams
      : Array.from({ length: Math.ceil(hashes.length / size) }, (_, i) =>
          ReviewNgramBucketSchema.parse({
            paperId,
            hash: `bucket:${i}`,
            hashes: hashes.slice(i * size, (i + 1) * size),
          }),
        );
  for (const doc of records) {
    const id = `${paperId}:${doc.hash}`;
    const previous = current.get(id);
    if (JSON.stringify(previous?.doc) !== JSON.stringify(doc))
      await tx.put(collection, id, doc, previous?.version ?? null);
    current.delete(id);
  }
  for (const { id, version } of current.values()) await tx.remove(collection, id, version);
}
