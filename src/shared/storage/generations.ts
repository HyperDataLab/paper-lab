import { GenerationSchema, AuditEventSchema, type Generation } from '@/core/schemas';
import { analyzeText } from '@/core/text/analyzeText';
import { appendAudit, checkedAnalysis, type StorageDeps } from './storageShared';
import type { DocStore } from './docStore';
export function createGenerationsRepository(store: DocStore, deps: StorageDeps) {
  const { now, ids, makeAudit } = deps;
  const generations = {
    async create(input: Generation) {
      const value = GenerationSchema.parse(input);
      return store.unitOfWork(
        async (tx) => {
          await tx.put('generations', value.id, value, null);
          await appendAudit(
            tx,
            AuditEventSchema.parse({
              ...makeAudit(value.id, 'create_generation', 'human'),
              after: { generationId: value.id },
            }),
          );
          return value;
        },
        ['generations'],
      );
    },
    async get(id: string) {
      const row = await store.get('generations', id);
      return row ? GenerationSchema.parse(row.doc) : undefined;
    },
    async list() {
      return (await store.query('generations'))
        .map((row) => GenerationSchema.parse(row.doc))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async acceptGeneration(id: string, override = false) {
      const generation = await generations.get(id);
      if (!generation) throw new Error('Generation not found');
      if (!override && generation.checks.overall.some((check) => check.status === 'fail'))
        throw new Error('Generation has failed provenance checks');
      const text = await analyzeText(generation.paragraph);
      return store.unitOfWork(
        async (tx) => {
          const row = await tx.get('generations', id);
          const current = row && GenerationSchema.parse(row.doc);
          if (!current || JSON.stringify(current) !== JSON.stringify(generation))
            throw new Error('Generation changed');
          const at = now();
          const value = checkedAnalysis({
            schemaVersion: 1,
            id: ids(),
            createdAt: at,
            updatedAt: at,
            title: `Đoạn soạn: ${generation.input.mainClaim}`,
            text,
            context: { before: null, after: null, audience: generation.input.audience },
            contextLimited: true,
            versions: { rubric: null, prompt: null, model: null, syntaxProvider: null },
            sentenceAnnotations: [],
            issues: [],
            parentAnalysisId: null,
            origin: { kind: 'generated', generationId: id },
          });
          await tx.put('analyses', value.id, value, null);
          await appendAudit(
            tx,
            AuditEventSchema.parse({
              ...makeAudit(value.id, 'accept_generation', 'human'),
              after: { generationId: id, override },
            }),
          );
          return value;
        },
        ['generations', 'analyses'],
      );
    },
  };
  return generations;
}
