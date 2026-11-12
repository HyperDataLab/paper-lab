import {
  type Analysis,
  type SentenceAnnotation,
  type TextAnalysis,
  type Issue,
  AuditEventSchema,
} from '@/core/schemas';
import { checkedAnalysis, readAnalyses, SourceImmutableError, type StorageDeps } from './storageShared';
import type { ParagraphDb } from './db';
export type AnalysisPatch = Partial<
  Pick<
    Analysis,
    | 'title'
    | 'context'
    | 'contextLimited'
    | 'versions'
    | 'sentenceAnnotations'
    | 'issues'
    | 'paragraph'
    | 'flowLinks'
    | 'paragraphMetrics'
    | 'scores'
  >
>;
export function createAnalysesRepository(db: ParagraphDb, deps: StorageDeps) {
  const { now, ids, makeAudit } = deps;
  const analyses = {
    async reviewIssue(
      id: string,
      issueId: string,
      change: { status?: Issue['status']; severity?: Issue['severity'] },
    ) {
      return db.transaction('rw', db.analyses, db.auditEvents, db.calibrationLabels, async () => {
        const current = await analyses.get(id);
        if (!current) throw new Error('Analysis not found');
        const issue = current.issues.find((item) => item.id === issueId);
        if (!issue) throw new Error('Issue not found');
        let updated = issue;
        for (const field of ['status', 'severity'] as const) {
          const next = change[field];
          if (next === undefined || next === updated[field]) continue;
          const action =
            field === 'severity'
              ? 'edit_severity'
              : next === 'confirmed_by_human'
                ? 'confirm'
                : next === 'dismissed_by_human'
                  ? 'dismiss'
                  : 'reopen';
          const lastAudit = await db.auditEvents.orderBy('at').last();
          const lastLabel = await db.calibrationLabels.orderBy('importedAt').last();
          const at = new Date(
            Math.max(
              Date.parse(now()),
              Date.parse(lastAudit?.at ?? '1970-01-01T00:00:00.000Z') + 1,
              Date.parse(lastLabel?.importedAt ?? '1970-01-01T00:00:00.000Z') + 1,
            ),
          ).toISOString();
          await db.auditEvents.add(
            AuditEventSchema.parse({
              ...makeAudit(id, action, 'human'),
              at,
              issueId,
              before: { [field]: updated[field] },
              after: { [field]: next },
            }),
          );
          updated = { ...updated, [field]: next };
        }
        const value = checkedAnalysis({
          ...current,
          updatedAt: now(),
          issues: current.issues.map((item) => (item.id === issueId ? updated : item)),
        });
        await db.analyses.put(value);
        return value;
      });
    },
    async create(input: {
      text: TextAnalysis;
      title?: string;
      context?: Analysis['context'];
      versions?: Partial<Analysis['versions']>;
      sentenceAnnotations?: SentenceAnnotation[];
      issues?: Issue[];
      paragraph?: Analysis['paragraph'];
      flowLinks?: Analysis['flowLinks'];
      paragraphMetrics?: Analysis['paragraphMetrics'];
      scores?: Analysis['scores'];
      origin?: Analysis['origin'];
      contextLimited?: boolean;
    }) {
      const at = now();
      const value = checkedAnalysis({
        schemaVersion: 1,
        id: ids(),
        createdAt: at,
        updatedAt: at,
        text: input.text,
        title: input.title,
        context: input.context ?? { before: null, after: null, audience: null },
        contextLimited: input.contextLimited ?? true,
        versions: { rubric: null, prompt: null, model: null, syntaxProvider: null, ...input.versions },
        sentenceAnnotations: input.sentenceAnnotations ?? [],
        paragraph: input.paragraph ?? null,
        flowLinks: input.flowLinks ?? [],
        paragraphMetrics: input.paragraphMetrics ?? null,
        scores: input.scores ?? null,
        issues: input.issues ?? [],
        parentAnalysisId: null,
        origin: input.origin ?? null,
      });
      await db.transaction('rw', db.analyses, db.auditEvents, async () => {
        await db.analyses.add(value);
        await db.auditEvents.add(makeAudit(value.id, 'create_analysis', 'human'));
      });
      return value;
    },
    async get(id: string) {
      const row = await db.analyses.get(id);
      if (!row) return undefined;
      return checkedAnalysis(row);
    },
    async listByPaper(paperId: string) {
      const { values } = await readAnalyses(db);
      return values.filter((value) => value.origin?.kind === 'paper' && value.origin.paperId === paperId);
    },
    async list() {
      const { values, corrupt } = await readAnalyses(db);
      return {
        items: values
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .map((a) => ({
            id: a.id,
            title: a.title,
            createdAt: a.createdAt,
            updatedAt: a.updatedAt,
            preview: Array.from(a.text.sourceText).slice(0, 120).join(''),
            sentenceCount: a.text.sentences.length,
            issueCount: a.issues.length,
            sourceHash: a.text.sourceHash,
            paperId: a.origin?.kind === 'paper' ? a.origin.paperId : null,
          })),
        corrupt,
      };
    },
    async update(id: string, patch: AnalysisPatch) {
      return db.transaction('rw', db.analyses, async () => {
        const allowed = new Set([
          'title',
          'context',
          'contextLimited',
          'versions',
          'sentenceAnnotations',
          'paragraph',
          'flowLinks',
          'paragraphMetrics',
          'scores',
          'issues',
        ]);
        if ('text' in patch) throw new SourceImmutableError('Source text is immutable');
        if (Object.keys(patch).some((key) => !allowed.has(key))) throw new Error('Invalid analysis patch');
        const current = await analyses.get(id);
        if (!current) throw new Error('Analysis not found');
        const clearsScores =
          'sentenceAnnotations' in patch ||
          'paragraph' in patch ||
          'flowLinks' in patch ||
          'paragraphMetrics' in patch;
        const value = checkedAnalysis({
          ...current,
          ...patch,
          ...(clearsScores && !('scores' in patch) ? { scores: null } : {}),
          id,
          updatedAt: now(),
        });
        await db.analyses.put(value);
        return value;
      });
    },
    async delete(id: string) {
      await db.transaction('rw', db.analyses, db.auditEvents, async () => {
        if (await db.analyses.get(id)) {
          await db.analyses.delete(id);
          await db.auditEvents.add(makeAudit(id, 'delete_analysis', 'human'));
        }
      });
    },
  };
  return analyses;
}
