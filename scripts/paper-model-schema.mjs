// Regenerates the paper-model contract (JSON Schema) and its synthetic example from PaperLab code.
// Usage: npm run schema:paper-model
// The code is TypeScript with `@/` aliases, so it is loaded through Vite's SSR loader rather than plain node.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({
  root,
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false, watch: null },
  appType: 'custom',
});
try {
  const contract = await server.ssrLoadModule('/src/core/paperModel/contract.ts');
  const corpus = await server.ssrLoadModule('/src/core/corpus/contract.ts');
  const files = [
    [contract.PAPER_MODEL_SCHEMA_FILE, contract.paperModelJsonSchema()],
    [contract.PAPER_MODEL_SCHEMA_PUBLIC_FILE, contract.paperModelJsonSchema()],
    [contract.PAPER_MODEL_EXAMPLE_FILE, contract.examplePaperModel()],
    [corpus.CORPUS_SCHEMA_FILE, corpus.corpusJsonSchema()],
    [corpus.CORPUS_SCHEMA_PUBLIC_FILE, corpus.corpusJsonSchema()],
    [corpus.CORPUS_EXAMPLE_FILE, corpus.exampleCorpus()],
  ];
  for (const [file, value] of files) {
    const path = resolve(root, file);
    const options = (await prettier.resolveConfig(path)) ?? {};
    const text = await prettier.format(JSON.stringify(value), { ...options, filepath: path });
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text);
    console.log(`wrote ${file}`);
  }
} finally {
  await server.close();
}
