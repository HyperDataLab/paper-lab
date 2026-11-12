// Local corpus only; the proxy supplies credentials. No corpus text is written to output.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const args = process.argv.slice(2);
const options = { papers: 'A01,A02,A03,A04,A05', baseUrl: 'http://localhost:5179/llm', out: '.bench' };
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--dry-run') options.dryRun = true;
  else {
    const key = {
      '--corpus': 'corpus',
      '--papers': 'papers',
      '--base-url': 'baseUrl',
      '--model': 'model',
      '--out': 'out',
    }[arg];
    if (!key || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Invalid argument: ${arg}`);
    options[key] = args[++i];
  }
}
if (!options.corpus) throw new Error('--corpus is required');
const ids = options.papers.split(',');
if (!ids.length || new Set(ids).size !== ids.length || ids.some((id) => !/^A(?:0[1-9]|[1-3]\d|40)$/.test(id)))
  throw new Error('--papers must contain distinct IDs A01 through A40');
const base = new URL(options.baseUrl);
if (
  base.username ||
  base.password ||
  base.search ||
  base.hash ||
  !(base.protocol === 'https:' || (base.protocol === 'http:' && base.hostname === 'localhost'))
)
  throw new Error('Invalid base URL');
const server = await createServer({
  root: process.cwd(),
  configFile: false,
  envFile: false,
  resolve: { alias: { '@': resolve(process.cwd(), 'src') } },
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false, watch: null },
  appType: 'custom',
});
try {
  const bench = await server.ssrLoadModule('/src/core/bench/drInventor.ts');
  const argument = await server.ssrLoadModule('/src/core/argument/index.ts');
  const { CLAIM_TYPES } = await server.ssrLoadModule('/src/core/argument/claimTypes.ts');
  const prompts = await server.ssrLoadModule('/src/core/prompts/index.ts');
  const schemas = await server.ssrLoadModule('/src/core/schemas/index.ts');
  const { createLlmClient } = await server.ssrLoadModule('/src/shared/llm/client.ts');
  const { defaultConfig } = await server.ssrLoadModule('/src/shared/llm/config.ts');
  const model = options.model ?? defaultConfig().model;
  const client = createLlmClient(
    { baseUrl: '/llm', model },
    {
      fetch: (url, init) => fetch(`${base.href.replace(/\/$/, '')}${String(url).slice('/llm'.length)}`, init),
      sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
      now: () => Date.now(),
    },
  );
  const results = [];
  let planned = 0;
  for (const id of ids) {
    const raw = await readFile(resolve(options.corpus, `${id}.txt`), 'utf8');
    const ann = await readFile(resolve(options.corpus, `${id}.ann`), 'utf8');
    const { paper, mapping } = bench.toPaper(raw, id);
    const gold = bench.parseBrat(ann);
    const sectionIds = paper.sections.map((section) => section.id);
    const chunks = argument.planArguments(paper, sectionIds);
    planned += chunks.length;
    console.log(
      `${id}: ${paper.paragraphs.length} paragraphs, ${gold.length} gold spans, ${chunks.length} planned calls`,
    );
    if (options.dryRun) continue;
    if (!chunks.length) throw new Error(`${id}: no paragraphs to analyze`);
    const signature = createHash('sha256')
      .update(JSON.stringify([raw, ann, model, options.baseUrl, prompts.PROMPT_VERSIONS.argument, 1]))
      .digest('hex');
    const output = resolve(options.out, `${id}.json`);
    let cached;
    try {
      cached = JSON.parse(await readFile(output, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (cached) {
      if (cached.signature !== signature)
        throw new Error(
          `${id}: checkpoint does not match input or configuration; use a different output directory`,
        );
      results.push(cached);
      console.log(`${id}: checkpoint reused`);
      continue;
    }
    const outputs = {};
    let callsUsed = 0;
    for (const chunk of chunks) {
      const result = await client.completeJson({
        ...prompts.buildArgumentPrompt(chunk.paragraphs),
        schema: schemas.ArgumentOutputSchema,
        schemaName: 'arguments',
        promptVersion: prompts.PROMPT_VERSIONS.argument,
        temperature: 0.1,
        timeoutMs: 240000,
        onRequest: async () => {
          callsUsed++;
        },
      });
      outputs[chunk.id] = schemas.ArgumentOutputSchema.parse(result.data);
    }
    const run = argument.buildArgumentRun({
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      model,
      promptVersion: prompts.PROMPT_VERSIONS.argument,
      callsUsed,
      sectionIds,
      chunks,
      results: outputs,
    });
    const predicted = [];
    for (const item of run.arguments) {
      for (const [kind, span] of [['claim', item.claim], ...item.data.map((data) => ['data', data])]) {
        const mapped = bench.mapSpan(mapping, span.paragraphId, span.start, span.end);
        if (!mapped) throw new Error(`${id}: could not map verified span`);
        predicted.push({ kind, ...mapped });
      }
    }
    const result = {
      id,
      signature,
      model,
      promptVersion: prompts.PROMPT_VERSIONS.argument,
      callsUsed,
      discarded: run.discarded,
      claimTypes: run.arguments.map((item) => item.claimType),
      predicted,
      gold,
      score: bench.scoreSpans(predicted, gold),
    };
    await mkdir(resolve(options.out), { recursive: true });
    await writeFile(`${output}.tmp`, JSON.stringify(result, null, 2));
    await rename(`${output}.tmp`, output);
    results.push(result);
  }
  if (options.dryRun) console.log(`Total planned LLM calls: ${planned} (retries and repair may add calls)`);
  else {
    const score = bench.scoreSpans(
      results.flatMap((r, i) =>
        r.predicted.map((p) => ({ ...p, rawStart: p.rawStart + i * 1e9, rawEnd: p.rawEnd + i * 1e9 })),
      ),
      results.flatMap((r, i) =>
        r.gold.map((g) => ({ ...g, start: g.start + i * 1e9, end: g.end + i * 1e9 })),
      ),
    );
    const format = (n) => (n === null ? 'n/a' : `${(100 * n).toFixed(1)}%`);
    const rows = [
      '| Predicted | own_claim (C) | background_claim (S) | data (E) | none |',
      '| --- | ---: | ---: | ---: | ---: |',
      ...['claim', 'data'].map((kind) => `| ${kind} | ${Object.values(score.confusion[kind]).join(' | ')} |`),
    ];
    const types = results.flatMap((result) => result.claimTypes);
    const typeRows = [...CLAIM_TYPES, null].map(
      (type) => `| ${type ?? 'unclassified'} | ${types.filter((item) => item === type).length} |`,
    );
    const summary = `# Argument benchmark\n\nPapers: ${results.length}; model: ${model}; prompt: ${prompts.PROMPT_VERSIONS.argument}.\n\n${rows.join('\n')}\n\n| Measure | Value |\n| --- | ---: |\n| Claim precision | ${format(score.precision.claim)} |\n| Data precision | ${format(score.precision.data)} |\n| Data contains gold data (precision) | ${format(score.precision.dataContainsGold)} |\n| Own claim recall | ${format(score.recall.own_claim)} |\n| Data recall | ${format(score.recall.data)} |\n| Majority baseline (${score.majorityLabel ?? 'none'}) | ${format(score.majorityBaseline)} |\n\nClaim types (descriptive counts; no gold labels):\n\n| Type | Claims |\n| --- | ---: |\n${typeRows.join('\n')}\n`;
    await mkdir(resolve(options.out), { recursive: true });
    await writeFile(resolve(options.out, 'summary.md'), summary);
    console.log(summary);
  }
} finally {
  await server.close();
}
