import {
  AnalysisSchema,
  AuditEventSchema,
  RevisionSchema,
  GenerationSchema,
  type Generation,
  ExportPackageSchema,
  validateAnalysisSpans,
  type Analysis,
  type AuditEvent,
  type SentenceAnnotation,
  type TextAnalysis,
  type Issue,
  type Revision,
  PaperSchema,
  type Paper,
  SectionSchema,
  PaperRunSchema,
  type PaperRun,
} from '@/core/schemas';
import { buildExportPackage } from '@/core/transfer/buildExportPackage';
import { planImport, type ImportPlan } from '@/core/transfer/planImport';
import { sourceHash } from '@/core/text/hash';
import { analyzeText } from '@/core/text/analyzeText';
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
    | 'scores'
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
      const { values } = await readAnalyses();
      return values.filter((value) => value.origin?.kind === 'paper' && value.origin.paperId === paperId);
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
  const papers = {
    async editRole(id: string, sectionId: string, role: Paper['sections'][number]['role']) {
      const validatedRole = SectionSchema.shape.role.parse(role);
      return db.transaction('rw', db.papers, db.auditEvents, async () => {
        const current = await papers.get(id);
        if (!current) throw new Error('Paper not found');
        const section = current.sections.find((item) => item.id === sectionId);
        if (!section) throw new Error('Section not found');
        if (section.role === validatedRole) return current;
        const value = PaperSchema.parse({
          ...current,
          updatedAt: now(),
          sections: current.sections.map((item) =>
            item.id === sectionId ? { ...item, role: validatedRole } : item,
          ),
        });
        await db.papers.put(value);
        await db.auditEvents.add(
          AuditEventSchema.parse({
            ...makeAudit(id, 'edit_label', 'human'),
            before: { sectionId, role: section.role },
            after: { sectionId, role: validatedRole },
          }),
        );
        return value;
      });
    },
    async create(input: Paper) {
      const value = PaperSchema.parse(input);
      await db.transaction('rw', db.papers, db.auditEvents, async () => {
        await db.papers.add(value);
        await db.auditEvents.add(makeAudit(value.id, 'import_paper', 'human'));
      });
      return value;
    },
    async get(id: string) {
      const value = await db.papers.get(id);
      return value ? PaperSchema.parse(value) : undefined;
    },
    async list() {
      return (await db.papers.toArray())
        .map((value) => PaperSchema.parse(value))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async delete(id: string) {
      await db.transaction('rw', db.papers, db.auditEvents, async () => {
        if (await db.papers.get(id)) {
          await db.papers.delete(id);
          await db.auditEvents.add(makeAudit(id, 'delete_paper', 'human'));
        }
      });
    },
  };
  const paperRuns = {
    async create(input: PaperRun) {
      const value = PaperRunSchema.parse(input);
      await db.transaction('rw', db.paperRuns, db.auditEvents, async () => {
        await db.paperRuns.add(value);
        await db.auditEvents.add(makeAudit(value.paperId, 'start_run', 'system'));
      });
      return value;
    },
    async get(id: string) {
      const value = await db.paperRuns.get(id);
      return value ? PaperRunSchema.parse(value) : undefined;
    },
    async listByPaper(paperId: string) {
      return (await db.paperRuns.where('paperId').equals(paperId).toArray())
        .map((value) => PaperRunSchema.parse(value))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async save(input: PaperRun) {
      const value = PaperRunSchema.parse(input);
      await db.transaction('rw', db.paperRuns, db.auditEvents, async () => {
        const previous = await paperRuns.get(value.id);
        if (!previous || previous.paperId !== value.paperId) throw new Error('Run not found');
        await db.paperRuns.put(value);
        if (value.status === 'done' && previous.status !== 'done')
          await db.auditEvents.add(makeAudit(value.paperId, 'finish_run', 'system'));
      });
      return value;
    },
  };
  const transfer = {
    async exportAll(appVersion: string) {
      const a = await readAnalyses();
      const events = await audit.listAll();
      const storedRevisions = (await db.revisions.toArray()).map((item) => RevisionSchema.parse(item));
      return buildExportPackage(
        a.values,
        events.items,
        appVersion,
        clock(),
        storedRevisions,
        await generations.list(),
        await papers.list(),
      );
    },
    async previewImport(raw: unknown) {
      const a = await readAnalyses();
      const events = await audit.listAll();
      const parsed = ExportPackageSchema.extend({ analyses: z.array(z.unknown()) }).safeParse(raw);
      const hashes = new Map<string, string>();
      const revisionHashes = new Map<string, string>();
      if (parsed.success)
        for (const rawItem of parsed.data.analyses) {
          const item = AnalysisSchema.safeParse(rawItem);
          if (item.success) hashes.set(item.data.id, await sourceHash(item.data.text.sourceText));
        }
      if (parsed.success)
        for (const revision of parsed.data.revisions)
          revisionHashes.set(revision.id, await sourceHash(revision.revisedText));
      return planImport(
        raw,
        new Map(a.values.map((v) => [v.id, { updatedAt: v.updatedAt, sourceHash: v.text.sourceHash }])),
        new Set(events.items.map((v) => v.id)),
        hashes,
        revisionHashes,
        new Set(await db.revisions.toCollection().primaryKeys()),
        new Set(await db.generations.toCollection().primaryKeys()),
        new Map(
          (await papers.list()).map((paper) => [
            paper.id,
            { updatedAt: paper.updatedAt, sha256: paper.source.sha256 },
          ]),
        ),
      );
    },
    async applyImport(plan: Extract<ImportPlan, { ok: true }>) {
      for (const revision of plan.revisionsToInsert)
        if ((await sourceHash(revision.revisedText)) !== revision.revisedHash)
          throw new Error('Revision hash mismatch');
      await db.transaction(
        'rw',
        db.analyses,
        db.auditEvents,
        db.revisions,
        db.generations,
        db.papers,
        async () => {
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
          for (const raw of plan.revisionsToInsert) {
            const revision = RevisionSchema.parse(raw);
            const source = await analyses.get(revision.sourceAnalysisId);
            if (!source || source.text.sourceHash !== revision.sourceHash)
              throw new Error('Revision source mismatch');
            if (await db.revisions.get(revision.id)) throw new Error('Import preview is out of date');
            const sourceLength = Array.from(source.text.sourceText).length;
            const revisedLength = Array.from(revision.revisedText).length;
            if (
              revision.hunks.some(
                (hunk) =>
                  (hunk.before && hunk.before.end > sourceLength) ||
                  (hunk.after && hunk.after.end > revisedLength) ||
                  hunk.changeIndexes.some((index) => index >= revision.changes.length),
              ) ||
              revision.checks.some((check) =>
                check.spans.some(
                  (span) => span.end > (span.side === 'source' ? sourceLength : revisedLength),
                ),
              )
            )
              throw new Error('Invalid revision spans');
            await db.revisions.add(revision);
          }
          for (const generation of plan.generationsToInsert) {
            if (await db.generations.get(generation.id)) throw new Error('Import preview is out of date');
            await db.generations.add(GenerationSchema.parse(generation));
          }
          for (const paper of plan.papersToInsert) {
            if (await db.papers.get(paper.id)) throw new Error('Import preview is out of date');
            await db.papers.add(PaperSchema.parse(paper));
          }
          for (const raw of plan.papersToUpdate) {
            const paper = PaperSchema.parse(raw);
            const current = await papers.get(paper.id);
            if (
              !current ||
              current.source.sha256 !== paper.source.sha256 ||
              Date.parse(paper.updatedAt) <= Date.parse(current.updatedAt)
            )
              throw new Error('Import preview is out of date');
            if (JSON.stringify(current.paragraphs) !== JSON.stringify(paper.paragraphs))
              throw new SourceImmutableError('Paper paragraphs are immutable');
            await db.papers.put(paper);
            await db.auditEvents.add(makeAudit(paper.id, 'import', 'system'));
          }
          for (const event of plan.auditEvents)
            if (!(await db.auditEvents.get(event.id)))
              await db.auditEvents.add(AuditEventSchema.parse(event));
        },
      );
    },
  };
  return { analyses, audit, revisions, generations, papers, paperRuns, transfer };
}
export type Repositories = ReturnType<typeof createRepositories>;
