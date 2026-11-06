import {
  AnalysisSchema,
  AuditEventSchema,
  ExportPackageSchema,
  validateAnalysisSpans,
  type Analysis,
  type AuditEvent,
  type SentenceAnnotation,
  type TextAnalysis,
  type Issue,
} from '@/core/schemas';
import { buildExportPackage } from '@/core/transfer/buildExportPackage';
import { planImport, type ImportPlan } from '@/core/transfer/planImport';
import { sourceHash } from '@/core/text/hash';
import { z } from 'zod';
import type { ParagraphDb } from './db';
export class SourceImmutableError extends Error {
  override name = 'SourceImmutableError';
}
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
  >
>;
export function createRepositories(
  db: ParagraphDb,
  clock = () => new Date(),
  ids = () => crypto.randomUUID(),
) {
  function checkedAnalysis(value: unknown) {
    const result = validateAnalysisSpans(AnalysisSchema.parse(value));
    if (result.suppressed.length) console.warn('Suppressed invalid analysis spans', result.suppressed);
    return result.valid;
  }
  const now = () => clock().toISOString();
  const makeAudit = (analysisId: string, action: AuditEvent['action'], actor: AuditEvent['actor']) =>
    AuditEventSchema.parse({
      schemaVersion: 1,
      id: ids(),
      analysisId,
      issueId: null,
      at: now(),
      actor,
      action,
      before: null,
      after: null,
      note: null,
    });
  async function readAnalyses() {
    const rows = await db.analyses.toArray();
    const values: Analysis[] = [];
    let corrupt = 0;
    for (const row of rows) {
      try {
        values.push(checkedAnalysis(row));
      } catch {
        corrupt++;
      }
    }
    return { values, corrupt };
  }
  async function readAudit() {
    const rows = await db.auditEvents.toArray();
    const values: AuditEvent[] = [];
    let corrupt = 0;
    for (const row of rows) {
      const result = AuditEventSchema.safeParse(row);
      if (result.success) values.push(result.data);
      else corrupt++;
    }
    return { values, corrupt };
  }
  const analyses = {
    async reviewIssue(
      id: string,
      issueId: string,
      change: { status?: Issue['status']; severity?: Issue['severity'] },
    ) {
      return db.transaction('rw', db.analyses, db.auditEvents, async () => {
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
          await db.auditEvents.add(
            AuditEventSchema.parse({
              ...makeAudit(id, action, 'human'),
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
        contextLimited: true,
        versions: { rubric: null, prompt: null, model: null, syntaxProvider: null, ...input.versions },
        sentenceAnnotations: input.sentenceAnnotations ?? [],
        paragraph: input.paragraph ?? null,
        flowLinks: input.flowLinks ?? [],
        paragraphMetrics: input.paragraphMetrics ?? null,
        issues: input.issues ?? [],
        parentAnalysisId: null,
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
    async list() {
      const { values, corrupt } = await readAnalyses();
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
          'issues',
        ]);
        if ('text' in patch) throw new SourceImmutableError('Source text is immutable');
        if (Object.keys(patch).some((key) => !allowed.has(key))) throw new Error('Invalid analysis patch');
        const current = await analyses.get(id);
        if (!current) throw new Error('Analysis not found');
        const value = checkedAnalysis({ ...current, ...patch, id, updatedAt: now() });
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
  const audit = {
    async append(event: AuditEvent) {
      await db.auditEvents.add(AuditEventSchema.parse(event));
    },
    async listAll() {
      const { values, corrupt } = await readAudit();
      return { items: values.sort((a, b) => a.at.localeCompare(b.at)), corrupt };
    },
    async listByAnalysis(id: string) {
      const result = await audit.listAll();
      return { ...result, items: result.items.filter((event) => event.analysisId === id) };
    },
  };
  const transfer = {
    async exportAll(appVersion: string) {
      const a = await readAnalyses();
      const events = await audit.listAll();
      return buildExportPackage(a.values, events.items, appVersion, clock());
    },
    async previewImport(raw: unknown) {
      const a = await readAnalyses();
      const events = await audit.listAll();
      const parsed = ExportPackageSchema.extend({ analyses: z.array(z.unknown()) }).safeParse(raw);
      const hashes = new Map<string, string>();
      if (parsed.success)
        for (const rawItem of parsed.data.analyses) {
          const item = AnalysisSchema.safeParse(rawItem);
          if (item.success) hashes.set(item.data.id, await sourceHash(item.data.text.sourceText));
        }
      return planImport(
        raw,
        new Map(a.values.map((v) => [v.id, { updatedAt: v.updatedAt, sourceHash: v.text.sourceHash }])),
        new Set(events.items.map((v) => v.id)),
        hashes,
      );
    },
    async applyImport(plan: Extract<ImportPlan, { ok: true }>) {
      await db.transaction('rw', db.analyses, db.auditEvents, async () => {
        if (plan.suppressed.length) console.warn('Suppressed invalid imported spans', plan.suppressed);
        for (const value of [...plan.toInsert, ...plan.toUpdate]) {
          const incoming = validateAnalysisSpans(AnalysisSchema.parse(value)).valid;
          const current = await db.analyses.get(incoming.id);
          if (current) {
            const existing = AnalysisSchema.parse(current);
            if (
              existing.text.sourceText !== incoming.text.sourceText ||
              existing.text.sourceHash !== incoming.text.sourceHash
            )
              throw new SourceImmutableError('Source text is immutable');
            if (Date.parse(incoming.updatedAt) <= Date.parse(existing.updatedAt))
              throw new Error('Import preview is out of date');
          }
          await db.analyses.put(incoming);
          await db.auditEvents.add(makeAudit(value.id, 'import', 'system'));
        }
        for (const event of plan.auditEvents)
          if (!(await db.auditEvents.get(event.id))) await db.auditEvents.add(AuditEventSchema.parse(event));
      });
    },
  };
  return { analyses, audit, transfer };
}
export type Repositories = ReturnType<typeof createRepositories>;
