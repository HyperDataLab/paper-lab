// Regenerates the contracts with the Writing Bank (paper model, corpus, corpus profile and feature registry):
// JSON Schemas and synthetic examples, all from PaperLab code.
// Usage: npm run schema:paper-model (or schema:corpus, schema:corpus-profile; they run the same script)
// The code is TypeScript with `@/` aliases, so it is loaded through Vite's SSR loader rather than plain node.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = await mkdtemp(resolve(tmpdir(), 'paperlab-schema-'));
const server = await createServer({
  root,
  configLoader: 'runner',
  cacheDir,
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false, watch: null },
  appType: 'custom',
});
try {
  const contract = await server.ssrLoadModule('/src/core/paperModel/contract.ts');
  const corpus = await server.ssrLoadModule('/src/core/corpus/contract.ts');
  const profile = await server.ssrLoadModule('/src/core/corpusProfile/contract.ts');
  const profileV2 = await server.ssrLoadModule('/src/core/corpusProfile/contractV2.ts');
  const topics = await server.ssrLoadModule('/src/core/corpusTopics/contract.ts');
  const facts = await server.ssrLoadModule('/src/core/experimentFacts/contract.ts');
  const plan = await server.ssrLoadModule('/src/core/researchDesign/plan/contract.ts');
  const files = [
    [contract.PAPER_MODEL_SCHEMA_FILE, contract.paperModelJsonSchema()],
    [contract.PAPER_MODEL_SCHEMA_PUBLIC_FILE, contract.paperModelJsonSchema()],
    [contract.PAPER_MODEL_EXAMPLE_FILE, contract.examplePaperModel()],
    [corpus.CORPUS_SCHEMA_FILE, corpus.corpusJsonSchema()],
    [corpus.CORPUS_SCHEMA_PUBLIC_FILE, corpus.corpusJsonSchema()],
    [corpus.CORPUS_EXAMPLE_FILE, corpus.exampleCorpus()],
    [profile.CORPUS_PROFILE_SCHEMA_FILE, profile.corpusProfileJsonSchema()],
    [profile.CORPUS_PROFILE_SCHEMA_PUBLIC_FILE, profile.corpusProfileJsonSchema()],
    [profileV2.CORPUS_PROFILE_V2_SCHEMA_FILE, profileV2.corpusProfileV2JsonSchema()],
    [profileV2.CORPUS_PROFILE_V2_PUBLIC_FILE, profileV2.corpusProfileV2JsonSchema()],
    [profileV2.CORPUS_PROFILE_V2_EXAMPLE_FILE, await profileV2.exampleCorpusProfileV2()],
    [profileV2.FEATURE_REGISTRY_V2_FILE, await profileV2.featureRegistryV2Json()],
    [profile.CORPUS_PROFILE_EXAMPLE_FILE, await profile.exampleCorpusProfile()],
    [profile.FEATURE_REGISTRY_FILE, await profile.featureRegistryJson()],
    [topics.CORPUS_TOPICS_SCHEMA_FILE, topics.corpusTopicsJsonSchema()],
    [topics.CORPUS_TOPICS_SCHEMA_PUBLIC_FILE, topics.corpusTopicsJsonSchema()],
    [facts.EXPERIMENT_FACTS_SCHEMA_FILE, facts.experimentFactsJsonSchema()],
    [facts.EXPERIMENT_FACTS_SCHEMA_PUBLIC_FILE, facts.experimentFactsJsonSchema()],
    [facts.EXPERIMENT_FACTS_EXAMPLE_FILE, facts.exampleExperimentFacts()],
    ...plan.planContractFiles(),
  ];
  for (const [file, value] of files) {
    const path = resolve(root, file);
    const options = (await prettier.resolveConfig(path)) ?? {};
    // Preserve the published Research Design contract's JSON.stringify serialization.
    const text = file.includes('experiment-plan-')
      ? `${JSON.stringify(value, null, 2)}\n`
      : await prettier.format(JSON.stringify(value), { ...options, filepath: path });
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text);
    console.log(`wrote ${file}`);
  }
} finally {
  await server.close();
  await rm(cacheDir, { recursive: true, force: true });
}
