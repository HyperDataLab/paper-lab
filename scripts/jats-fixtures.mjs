// Generate synthetic exports through the same Vite SSR loader used for the contracts.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({
  root,
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false, watch: null },
  appType: 'custom',
});
try {
  const { paperModelToJats } = await server.ssrLoadModule('/src/core/paperModel/jats.ts');
  const example = JSON.parse(await readFile(resolve(root, 'examples/paper-model.example.json'), 'utf8'));
  const preprint = structuredClone(example);
  preprint.document.metadata.doi = null;
  preprint.document.metadata.venue = null;
  const complex = structuredClone(example);
  Object.assign(complex.document.metadata, {
    title: 'A synthetic study',
    authors: ['A. Example'],
    affiliations: ['Example Institute'],
    doi: '10.5555/synthetic',
    venue: 'Journal of Examples',
    year: 2024,
    volume: '2',
    issue: '1',
    pages: '10–12',
    keywords: ['synthetic'],
  });
  complex.document.sections.push({
    id: 'nested',
    parentId: 'res',
    title: 'Details',
    level: 2,
    role: 'results',
    page: 3,
  });
  for (const [index, kind] of ['list', 'equation', 'table', 'caption', 'footnote'].entries()) {
    complex.document.blocks.push({
      id: `extra${index}`,
      sectionId: 'nested',
      kind,
      page: 3,
      text: `Synthetic ${kind} text.`,
      textHash: 'sha256:0',
    });
  }
  complex.document.blocks.push({
    id: 'citations',
    sectionId: 'nested',
    kind: 'body',
    page: 3,
    text: 'Synthetic evidence [3–5] and unresolved [99].',
    textHash: 'sha256:0',
  });
  complex.document.references = [3, 4, 5].map((n) => ({
    id: `ref${n}`,
    text: `Synthetic reference ${n}.`,
    year: 2024,
    doi: n === 3 ? '10.5555/ref3' : null,
  }));
  const fixtures = [
    ['example.xml', example, undefined],
    ['preprint.xml', preprint, undefined],
    ['complex.xml', complex, undefined],
    ['complex-sentences.xml', complex, { sentences: true }],
  ];
  await mkdir(resolve(root, '.jats-check'), { recursive: true });
  for (const [name, model, options] of fixtures) {
    await writeFile(resolve(root, '.jats-check', name), paperModelToJats(model, options), 'utf8');
    console.log(`wrote .jats-check/${name}`);
  }
} finally {
  await server.close();
}
