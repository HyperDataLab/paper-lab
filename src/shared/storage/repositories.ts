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
  PaperOverviewRecordSchema,
  type PaperOverviewRecord,
  PaperChecksRecordSchema,
  type PaperChecksRecord,
  type CheckDecision,
  PaperReviewsRecordSchema,
} from '@/core/schemas';
import { validateLocations } from '@/core/paperChecks';
import { aggregatePaper, transitionStatus } from '@/core/paperOverview';
import { buildExportPackage } from '@/core/transfer/buildExportPackage';
import { planImport, type ImportPlan } from '@/core/transfer/planImport';
import { sourceHash } from '@/core/text/hash';
import { analyzeText } from '@/core/text/analyzeText';
import { z } from 'zod';
import type { ParagraphDb } from './db';
import { createPaperReviewsRepository, rebuildReviewRecord } from './paperReviews';
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
      await db.transaction(
        'rw',
        [
          db.papers,
          db.paperOverviews,
          db.paperChecks,
          db.paperRuns,
          db.paperReviews,
          db.reviewNgrams,
          db.auditEvents,
        ],
        async () => {
          if (await db.papers.get(id)) {
            await db.papers.delete(id);
            await db.paperOverviews.delete(id);
            await db.paperChecks.delete(id);
            await db.paperReviews.delete(id);
            await db.reviewNgrams.where('paperId').equals(id).delete();
            await db.paperRuns.where('paperId').equals(id).delete();
            await db.auditEvents.add(makeAudit(id, 'delete_paper', 'human'));
          }
        },
      );
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
  const paperOverviews = {
    async get(paperId: string) {
      const paper = await papers.get(paperId);
      if (!paper) return undefined;
      const stored = await db.paperOverviews.get(paperId);
      const saved = stored ? PaperOverviewRecordSchema.parse(stored).transitions : null;
      const paperAnalyses = await analyses.listByPaper(paperId);
      return PaperOverviewRecordSchema.parse({
        schemaVersion: 1,
        paperId,
        overview: aggregatePaper(paper, paperAnalyses),
        transitions: saved ? transitionStatus(paper, paperAnalyses, saved) : null,
      });
    },
    async save(input: PaperOverviewRecord) {
      const parsed = PaperOverviewRecordSchema.parse(input);
      const current = await paperOverviews.get(parsed.paperId);
      if (!current) throw new Error('Paper not found');
      const value = PaperOverviewRecordSchema.parse({ ...parsed, overview: current.overview });
      await db.paperOverviews.put(value);
      return value;
    },
    async reviewTransition(
      paperId: string,
      findingId: string,
      status: 'confirmed_by_human' | 'dismissed_by_human' | 'candidate',
    ) {
      return db.transaction('rw', db.paperOverviews, db.papers, db.analyses, db.auditEvents, async () => {
        const current = await paperOverviews.get(paperId);
        const finding = current?.transitions?.findings.find((item) => item.id === findingId);
        if (!current || !current.transitions || !finding) throw new Error('Transition finding not found');
        if (finding.status === status) return current;
        const reviewedAt = new Date(
          Math.max(
            Date.parse(now()),
            Date.parse(current.transitions.updatedAt) + 1,
            current.transitions.reviewedAt ? Date.parse(current.transitions.reviewedAt) + 1 : 0,
          ),
        ).toISOString();
        const value = PaperOverviewRecordSchema.parse({
          ...current,
          transitions: {
            ...current.transitions,
            reviewedAt,
            findings: current.transitions.findings.map((item) =>
              item.id === findingId ? { ...item, status } : item,
            ),
          },
        });
        await db.paperOverviews.put(value);
        await db.auditEvents.add(
          AuditEventSchema.parse({
            ...makeAudit(paperId, 'review_transition', 'human'),
            at: reviewedAt,
            issueId: findingId,
            before: { status: finding.status },
            after: { status },
          }),
        );
        return value;
      });
    },
  };
  const paperChecks = {
    async get(paperId: string) {
      const value = await db.paperChecks.get(paperId);
      return value ? PaperChecksRecordSchema.parse(value) : undefined;
    },
    async save(input: PaperChecksRecord) {
      return db.transaction('rw', db.papers, db.paperChecks, async () => {
        const parsed = PaperChecksRecordSchema.parse(input);
        const paper = await papers.get(parsed.paperId);
        if (!paper) throw new Error('Paper not found');
        const current = await paperChecks.get(parsed.paperId);
        const decisions = new Map(parsed.decisions.map((d) => [d.findingId, d]));
        for (const decision of current?.decisions ?? []) {
          const incoming = decisions.get(decision.findingId);
          if (!incoming || incoming.at < decision.at) decisions.set(decision.findingId, decision);
        }
        let dropped = 0;
        const checks = parsed.report.checks.map((check) => {
          const validated = validateLocations(paper, check.findings);
          dropped += validated.dropped;
          return { ...check, findings: validated.findings };
        });
        const value = PaperChecksRecordSchema.parse({
          ...parsed,
          report: { ...parsed.report, checks, droppedLocations: parsed.report.droppedLocations + dropped },
          decisions: [...decisions.values()],
        });
        await db.paperChecks.put(value);
        return value;
      });
    },
    async review(
      paperId: string,
      findingId: string,
      status: CheckDecision['status'] | 'candidate',
      note = '',
    ) {
      return db.transaction('rw', db.paperChecks, db.auditEvents, async () => {
        const current = await paperChecks.get(paperId);
        if (!current?.report.checks.some((check) => check.findings.some((f) => f.id === findingId)))
          throw new Error('Check finding not found');
        const before = current.decisions.find((d) => d.findingId === findingId);
        const at = new Date(
          Math.max(
            Date.parse(now()),
            Date.parse(current.report.generatedAt) + 1,
            Date.parse(current.reviewedAt ?? current.report.generatedAt) + 1,
            ...current.decisions.map((d) => Date.parse(d.at) + 1),
          ),
        ).toISOString();
        const decisions = current.decisions.filter((d) => d.findingId !== findingId);
        if (status !== 'candidate') decisions.push({ findingId, status, note, at });
        const value = PaperChecksRecordSchema.parse({ ...current, decisions, reviewedAt: at });
        await db.paperChecks.put(value);
        await db.auditEvents.add(
          AuditEventSchema.parse({
            ...makeAudit(paperId, 'review_check', 'human'),
            issueId: findingId,
            at,
            before: before ?? null,
            after: status === 'candidate' ? null : decisions[decisions.length - 1],
            note,
          }),
        );
        return value;
      });
    },
  };
  const paperReviews = createPaperReviewsRepository(db, now, makeAudit);
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
        (
          await Promise.all(
            (await db.paperOverviews.toCollection().primaryKeys()).map((id) => paperOverviews.get(id)),
          )
        ).filter((value): value is PaperOverviewRecord => value !== undefined),
        (await db.paperChecks.toArray()).map((value) => PaperChecksRecordSchema.parse(value)),
        (await db.paperReviews.toArray()).map((value) => PaperReviewsRecordSchema.parse(value)),
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
      const ngrams = await db.reviewNgrams.toArray();
      const preparedReviews = new Map<
        string,
        {
          paper: Paper;
          previousUpdatedAt: string | undefined;
          rebuilt: Awaited<ReturnType<typeof rebuildReviewRecord>>;
        }
      >();
      for (const record of plan.paperReviews) {
        const paper =
          [...plan.papersToInsert, ...plan.papersToUpdate].find((p) => p.id === record.paperId) ??
          (await papers.get(record.paperId));
        const existing = await paperReviews.get(record.paperId);
        if (paper && (!existing || record.updatedAt > existing.updatedAt))
          preparedReviews.set(record.paperId, {
            paper,
            previousUpdatedAt: existing?.updatedAt,
            rebuilt: await rebuildReviewRecord(paper, record, []),
          });
      }
      const corpus = ngrams.filter((item) => !preparedReviews.has(item.paperId));
      for (const prepared of preparedReviews.values()) corpus.push(...prepared.rebuilt.ngrams);
      for (const [paperId, prepared] of preparedReviews) {
        const record = plan.paperReviews.find((item) => item.paperId === paperId);
        if (record) prepared.rebuilt = await rebuildReviewRecord(prepared.paper, record, corpus);
      }
      await db.transaction(
        'rw',
        [
          db.analyses,
          db.auditEvents,
          db.revisions,
          db.generations,
          db.papers,
          db.paperOverviews,
          db.paperChecks,
          db.paperReviews,
          db.reviewNgrams,
        ],
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
          const importedFindings = new Map<string, Set<string>>();
          for (const record of plan.paperOverviews) {
            if (!(await db.papers.get(record.paperId))) continue;
            const existing = await db.paperOverviews.get(record.paperId);
            if (
              !existing ||
              (record.transitions &&
                (!existing.transitions ||
                  Math.max(
                    Date.parse(record.transitions.updatedAt),
                    Date.parse(record.transitions.reviewedAt ?? record.transitions.updatedAt),
                  ) >
                    Math.max(
                      Date.parse(existing.transitions.updatedAt),
                      Date.parse(existing.transitions.reviewedAt ?? existing.transitions.updatedAt),
                    )))
            ) {
              await db.paperOverviews.put(PaperOverviewRecordSchema.parse(record));
              importedFindings.set(
                record.paperId,
                new Set(record.transitions?.findings.map((finding) => finding.id) ?? []),
              );
            }
          }
          for (const record of plan.paperChecks) {
            const paper = await papers.get(record.paperId);
            if (!paper) continue;
            const existing = await paperChecks.get(record.paperId);
            const changed = (value: PaperChecksRecord) =>
              Math.max(
                Date.parse(value.report.generatedAt),
                Date.parse(value.reviewedAt ?? value.report.generatedAt),
                ...value.decisions.map((decision) => Date.parse(decision.at)),
              );
            if (!existing || changed(record) > changed(existing)) {
              let dropped = 0;
              const checks = record.report.checks.map((check) => {
                const valid = validateLocations(paper, check.findings);
                dropped += valid.dropped;
                return { ...check, findings: valid.findings };
              });
              const value = PaperChecksRecordSchema.parse({
                ...record,
                report: {
                  ...record.report,
                  checks,
                  droppedLocations: record.report.droppedLocations + dropped,
                },
              });
              await db.paperChecks.put(value);
            }
          }
          for (const record of plan.paperReviews) {
            const paper = await papers.get(record.paperId);
            if (!paper) continue;
            const existing = await paperReviews.get(record.paperId);
            const prepared = preparedReviews.get(record.paperId);
            if (prepared && prepared.previousUpdatedAt !== existing?.updatedAt)
              throw new Error('Review changed; retry');
            if (!existing || record.updatedAt > existing.updatedAt) {
              if (!prepared || JSON.stringify(prepared.paper.paragraphs) !== JSON.stringify(paper.paragraphs))
                throw new Error('Paper changed');
              const rebuilt = prepared.rebuilt;
              await db.paperReviews.put(rebuilt.record);
              await db.reviewNgrams.where('paperId').equals(record.paperId).delete();
              await db.reviewNgrams.bulkPut(rebuilt.ngrams);
            }
          }
          for (const event of plan.auditEvents)
            if (
              (event.action !== 'review_transition' ||
                (event.issueId && importedFindings.get(event.analysisId)?.has(event.issueId))) &&
              !(await db.auditEvents.get(event.id))
            )
              await db.auditEvents.add(AuditEventSchema.parse(event));
        },
      );
    },
  };
  return {
    analyses,
    audit,
    revisions,
    generations,
    papers,
    paperRuns,
    paperOverviews,
    paperChecks,
    paperReviews,
    transfer,
  };
}
export type Repositories = ReturnType<typeof createRepositories>;
