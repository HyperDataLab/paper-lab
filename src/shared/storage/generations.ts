import { GenerationSchema, AuditEventSchema, type Generation } from '@/core/schemas';
import { analyzeText } from '@/core/text/analyzeText';
import { checkedAnalysis, type StorageDeps } from './storageShared';
import type { ParagraphDb } from './db';
export function createGenerationsRepository(db: ParagraphDb, deps: StorageDeps) {
  const { now, ids, makeAudit } = deps;
  const generations = {
    async create(input: Generation) {
      const value = GenerationSchema.parse(input);
      return db.transaction('rw', db.generations, db.auditEvents, async () => {
        await db.generations.add(value);
        await db.auditEvents.add(
          AuditEventSchema.parse({
            ...makeAudit(value.id, 'create_generation', 'human'),
            after: { generationId: value.id },
          }),
        );
        return value;
      });
    },
    async get(id: string) {
      const row = await db.generations.get(id);
      return row ? GenerationSchema.parse(row) : undefined;
    },
    async list() {
      return (await db.generations.toArray())
        .map((row) => GenerationSchema.parse(row))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async acceptGeneration(id: string, override = false) {
      const generation = await generations.get(id);
      if (!generation) throw new Error('Generation not found');
      if (!override && generation.checks.overall.some((check) => check.status === 'fail'))
        throw new Error('Generation has failed provenance checks');
      const text = await analyzeText(generation.paragraph);
      return db.transaction('rw', db.generations, db.analyses, db.auditEvents, async () => {
        const current = await generations.get(id);
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
        await db.analyses.add(value);
        await db.auditEvents.add(
          AuditEventSchema.parse({
            ...makeAudit(value.id, 'accept_generation', 'human'),
            after: { generationId: id, override },
          }),
        );
        return value;
      });
    },
  };
  return generations;
}
