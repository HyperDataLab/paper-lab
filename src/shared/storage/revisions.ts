import { RevisionSchema, AuditEventSchema, type Revision } from '@/core/schemas';
import { sourceHash } from '@/core/text/hash';
import { analyzeText } from '@/core/text/analyzeText';
import { checkedAnalysis, type StorageDeps } from './storageShared';
import type { createAnalysesRepository } from './analyses';
import type { ParagraphDb } from './db';
export function createRevisionsRepository(
  db: ParagraphDb,
  deps: StorageDeps,
  analyses: ReturnType<typeof createAnalysesRepository>,
) {
  const { now, ids, makeAudit } = deps;
  const revisions = {
    async create(input: Revision) {
      const value = RevisionSchema.parse(input);
      if ((await sourceHash(value.revisedText)) !== value.revisedHash)
        throw new Error('Revision hash mismatch');
      return db.transaction('rw', db.analyses, db.revisions, db.auditEvents, async () => {
        const source = await analyses.get(value.sourceAnalysisId);
        if (!source || source.text.sourceHash !== value.sourceHash)
          throw new Error('Revision source mismatch');
        const sourceLength = Array.from(source.text.sourceText).length;
        const revisedLength = Array.from(value.revisedText).length;
        if (
          value.hunks.some(
            (hunk) =>
              (hunk.before && hunk.before.end > sourceLength) ||
              (hunk.after && hunk.after.end > revisedLength) ||
              hunk.changeIndexes.some((index) => index >= value.changes.length),
          ) ||
          value.checks.some((check) =>
            check.spans.some((span) => span.end > (span.side === 'source' ? sourceLength : revisedLength)),
          )
        )
          throw new Error('Invalid revision spans');
        await db.revisions.add(value);
        await db.auditEvents.add(makeAudit(source.id, 'create_revision', 'human'));
        return value;
      });
    },
    async get(id: string) {
      const row = await db.revisions.get(id);
      return row ? RevisionSchema.parse(row) : undefined;
    },
    async listBySource(id: string) {
      return (await db.revisions.where('sourceAnalysisId').equals(id).toArray())
        .map((row) => RevisionSchema.parse(row))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async applyRevision(sourceId: string, revisionId: string) {
      const revision = await revisions.get(revisionId);
      if (!revision || revision.sourceAnalysisId !== sourceId) throw new Error('Revision source mismatch');
      const text = await analyzeText(revision.revisedText);
      if (text.sourceHash !== revision.revisedHash) throw new Error('Revision hash mismatch');
      return db.transaction('rw', db.analyses, db.revisions, db.auditEvents, async () => {
        const source = await analyses.get(sourceId);
        const current = await revisions.get(revisionId);
        if (
          !source ||
          !current ||
          current.sourceHash !== source.text.sourceHash ||
          current.revisedHash !== text.sourceHash
        )
          throw new Error('Revision source mismatch');
        const at = now();
        const value = checkedAnalysis({
          schemaVersion: 1,
          id: ids(),
          createdAt: at,
          updatedAt: at,
          title: `Bản sửa của ${source.title || 'đoạn văn'}`,
          text,
          context: source.context,
          contextLimited: source.contextLimited,
          versions: { rubric: null, prompt: null, model: null, syntaxProvider: null },
          sentenceAnnotations: [],
          issues: [],
          parentAnalysisId: source.id,
          origin: { kind: 'revision', revisionId },
        });
        await db.analyses.add(value);
        await db.auditEvents.add(
          AuditEventSchema.parse({
            ...makeAudit(sourceId, 'apply_revision', 'human'),
            after: { revisionId, analysisId: value.id },
          }),
        );
        return value;
      });
    },
  };
  return revisions;
}
