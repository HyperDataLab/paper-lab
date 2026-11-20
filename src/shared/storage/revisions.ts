import { RevisionSchema, AuditEventSchema, type Revision } from '@/core/schemas';
import { sourceHash } from '@/core/text/hash';
import { analyzeText } from '@/core/text/analyzeText';
import { appendAudit, checkedAnalysis, type StorageDeps } from './storageShared';
import { getAnalysis } from './analyses';
import type { DocStore } from './docStore';
export function createRevisionsRepository(store: DocStore, deps: StorageDeps) {
  const { now, ids, makeAudit } = deps;
  const revisions = {
    async create(input: Revision) {
      const value = RevisionSchema.parse(input);
      if ((await sourceHash(value.revisedText)) !== value.revisedHash)
        throw new Error('Revision hash mismatch');
      return store.unitOfWork(
        async (tx) => {
          const source = await getAnalysis(tx, value.sourceAnalysisId);
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
          await tx.put('revisions', value.id, value, null);
          await appendAudit(tx, makeAudit(source.id, 'create_revision', 'human'));
          return value;
        },
        ['analyses', 'revisions'],
      );
    },
    async get(id: string) {
      const row = await store.get('revisions', id);
      return row ? RevisionSchema.parse(row.doc) : undefined;
    },
    async listBySource(id: string) {
      return (await store.query('revisions', { where: { refId: id } }))
        .map((row) => RevisionSchema.parse(row.doc))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async applyRevision(sourceId: string, revisionId: string) {
      const revision = await revisions.get(revisionId);
      if (!revision || revision.sourceAnalysisId !== sourceId) throw new Error('Revision source mismatch');
      const text = await analyzeText(revision.revisedText);
      if (text.sourceHash !== revision.revisedHash) throw new Error('Revision hash mismatch');
      return store.unitOfWork(
        async (tx) => {
          const source = await getAnalysis(tx, sourceId);
          const row = await tx.get('revisions', revisionId);
          const current = row && RevisionSchema.parse(row.doc);
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
          await tx.put('analyses', value.id, value, null);
          await appendAudit(
            tx,
            AuditEventSchema.parse({
              ...makeAudit(sourceId, 'apply_revision', 'human'),
              after: { revisionId, analysisId: value.id },
            }),
          );
          return value;
        },
        ['analyses', 'revisions'],
      );
    },
  };
  return revisions;
}
