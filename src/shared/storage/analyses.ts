import {
  type Analysis,
  type SentenceAnnotation,
  type TextAnalysis,
  type Issue,
  AuditEventSchema,
} from '@/core/schemas';
import {
  appendAudit,
  checkedAnalysis,
  readAnalyses,
  SourceImmutableError,
  type StorageDeps,
} from './storageShared';
import { z } from 'zod';
import type { DocReader, DocStore } from './docStore';

export async function getAnalysis(reader: DocReader, id: string) {
  const row = await reader.get('analyses', id);
  return row ? checkedAnalysis(row.doc) : undefined;
}
const summarySchema = z.object({
  id: z.uuid(),
  title: z.string().optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  preview: z.string(),
  sentenceCount: z.number(),
  issueCount: z.number(),
  sourceHash: z.string(),
  paperId: z.uuid().nullable(),
});
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
export function createAnalysesRepository(
  store: DocStore,
  deps: StorageDeps,
  latestAuditAt: (id: string) => Promise<string | undefined>,
  latestLabelAt: () => Promise<string | undefined>,
) {
  const { now, ids, makeAudit } = deps;
  const analyses = {
    async reviewIssue(
      id: string,
      issueId: string,
      change: { status?: Issue['status']; severity?: Issue['severity'] },
    ) {
      const [lastAudit, lastLabel] = await Promise.all([latestAuditAt(id), latestLabelAt()]);
      return store.unitOfWork(
        async (tx) => {
          const current = await getAnalysis(tx, id);
          if (!current) throw new Error('Analysis not found');
          const issue = current.issues.find((item) => item.id === issueId);
          if (!issue) throw new Error('Issue not found');
          let updated = issue;
          let lastDecision = Math.max(
            Date.parse(current.updatedAt),
            Date.parse(lastAudit ?? '1970-01-01T00:00:00.000Z'),
          );
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
            const at = new Date(
              Math.max(
                Date.parse(now()),
                lastDecision + 1,
                Date.parse(lastLabel ?? '1970-01-01T00:00:00.000Z') + 1,
              ),
            ).toISOString();
            lastDecision = Date.parse(at);
            await appendAudit(
              tx,
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
          await tx.put('analyses', value.id, value);
          return value;
        },
        ['analyses'],
      );
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
      await store.unitOfWork(
        async (tx) => {
          await tx.put('analyses', value.id, value, null);
          await appendAudit(tx, makeAudit(value.id, 'create_analysis', 'human'));
        },
        ['analyses'],
      );
      return value;
    },
    async get(id: string) {
      return getAnalysis(store, id);
    },
    async getMany(ids: readonly string[]) {
      return (await store.getMany('analyses', ids)).flatMap((row) => (row ? [checkedAnalysis(row.doc)] : []));
    },
    async listByPaper(paperId: string, sourceHash?: string) {
      return (await readAnalyses(store, paperId, sourceHash)).values;
    },
    async list() {
      const rows = await store.query('analyses', { select: 'summary', orderBy: 'updatedAt', desc: true });
      const items = rows.flatMap(({ doc }) => {
        const result = summarySchema.safeParse(doc);
        return result.success ? [result.data] : [];
      });
      return { items, corrupt: rows.length - items.length };
    },
    async update(id: string, patch: AnalysisPatch) {
      return store.unitOfWork(
        async (tx) => {
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
          const current = await getAnalysis(tx, id);
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
          await tx.put('analyses', value.id, value);
          return value;
        },
        ['analyses'],
      );
    },
    async delete(id: string) {
      await store.unitOfWork(
        async (tx) => {
          if (await tx.get('analyses', id)) {
            await tx.remove('analyses', id);
            await appendAudit(tx, makeAudit(id, 'delete_analysis', 'human'));
          }
        },
        ['analyses'],
      );
    },
  };
  return analyses;
}
