import { z } from 'zod';
import {
  AuditEventSchema,
  ExtractionProjectSchema,
  type AuditEvent,
  type ExtractionProject,
} from '@/core/schemas';
import type { DocStore, DocTx } from './docStore';
import { SPIKE_COLLECTIONS } from './compositeDocStore';

const projects = 'extractionProjects';
const summarySchema = ExtractionProjectSchema.pick({
  id: true,
  title: true,
  researchQuestion: true,
  updatedAt: true,
}).extend({ papers: z.number(), visibleFields: z.number(), verified: z.number() });
export type ExtractionProjectSummary = z.output<typeof summarySchema>;
export type ExtractionEvent = { action: 'run_extraction' | 'review_extraction'; after: unknown };

function projectSummary(project: ExtractionProject): ExtractionProjectSummary {
  return {
    id: project.id,
    title: project.title,
    researchQuestion: project.researchQuestion,
    updatedAt: project.updatedAt,
    papers: project.papers.length,
    visibleFields: project.fields.filter((field) => !field.hidden).length,
    verified: project.cells.filter((cell) => cell.status === 'VERIFIED').length,
  };
}

export function createExtractionRepository(
  store: DocStore,
  now: () => string,
  makeAudit: (id: string, action: AuditEvent['action'], actor: AuditEvent['actor']) => AuditEvent,
) {
  async function log(tx: DocTx, id: string, event: ExtractionEvent, at: string) {
    const audit = AuditEventSchema.parse({
      ...makeAudit(id, event.action, event.action === 'run_extraction' ? 'model' : 'human'),
      at,
      after: event.after,
    });
    if (tx.appendAudit) await tx.appendAudit(audit.id, audit);
    else await tx.put('auditEvents', audit.id, audit, null);
  }
  async function get(id: string) {
    const row = await store.get(projects, id);
    return row ? ExtractionProjectSchema.parse(row.doc) : undefined;
  }
  return {
    get,
    async forPaper(paperId: string) {
      const [row] = await store.query(projects, { where: { paperId }, limit: 1 });
      return row ? ExtractionProjectSchema.parse(row.doc) : undefined;
    },
    async list() {
      const rows = await store.query(projects, { orderBy: 'updatedAt', desc: true });
      return rows.map((row) => ExtractionProjectSchema.parse(row.doc));
    },
    async listSummaries() {
      const rows = await store.query(projects, { orderBy: 'updatedAt', desc: true, select: 'summary' });
      const results = rows.map((row) => summarySchema.safeParse(row.doc));
      const missing = rows.filter((_, i) => !results[i]?.success);
      const bodies = await store.getMany(
        projects,
        missing.map(({ id }) => id),
      );
      const byId = new Map(missing.map(({ id }, i) => [id, bodies[i]]));
      return rows.flatMap(({ id }, i) => {
        const summary = results[i];
        if (summary?.success) return [summary.data];
        const body = byId.get(id);
        return body ? [projectSummary(ExtractionProjectSchema.parse(body.doc))] : [];
      });
    },
    async checkpoint(input: ExtractionProject) {
      const value = ExtractionProjectSchema.parse({ ...input, updatedAt: now() });
      if (store.checkpoint) return store.checkpoint(projects, value.id, () => value);
      await store.put(projects, value.id, value);
      return value;
    },
    flush: (id: string) => store.flush?.(projects, id) ?? Promise.resolve(),
    async recordEvents(id: string, events: ExtractionEvent[]) {
      if (!events.length) return;
      await store.unitOfWork(
        async (tx) => {
          if (!(await tx.get(projects, id))) throw new Error('Project not found');
          for (const event of events) await log(tx, id, event, now());
        },
        [projects],
      );
    },
    async save(input: ExtractionProject, event?: ExtractionEvent) {
      const value = ExtractionProjectSchema.parse({ ...input, updatedAt: now() });
      await store.unitOfWork(
        async (tx) => {
          await tx.put(projects, value.id, value);
          if (event) await log(tx, value.id, event, value.updatedAt);
        },
        [projects],
      );
      return value;
    },
    async remove(id: string) {
      await store.unitOfWork(async (tx) => {
        await tx.remove(projects, id);
        await tx.remove('researchDesigns', id);
        await tx.remove('researchDesignBanks', id);
        for (const run of await tx.query('autoresearchRuns', { where: { projectId: id }, select: 'summary' }))
          await tx.remove('autoresearchRuns', run.id);
      }, SPIKE_COLLECTIONS);
    },
  };
}
