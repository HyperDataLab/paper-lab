import { CorpusSchema, type Corpus } from '@/core/schemas/corpus';

/** Downloads the validated corpus (members and protocol, no paper text) as `<slug>.corpus.json`. */
export function downloadManifest(corpus: Corpus) {
  const json = JSON.stringify(CorpusSchema.parse(corpus), null, 2);
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${
    corpus.title
      .normalize('NFKD')
      .replace(/[̀-ͯ]/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-|-$/gu, '') || 'corpus'
  }.corpus.json`;
  link.click();
  URL.revokeObjectURL(url);
}
