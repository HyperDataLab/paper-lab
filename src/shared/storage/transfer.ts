import {
  AnalysisSchema,
  AuditEventSchema,
  RevisionSchema,
  GenerationSchema,
  ExportPackageSchema,
  validateAnalysisSpans,
  PaperSchema,
  type Paper,
  PaperOverviewRecordSchema,
  type PaperOverviewRecord,
  PaperChecksRecordSchema,
  type PaperChecksRecord,
  PaperReviewsRecordSchema,
  PaperProbesRecordSchema,
  MeasurementsRecordSchema,
  LibraryItemSchema,
  StanceRecordSchema,
  PaperInsightsRecordSchema,
  ExtractionProjectSchema,
  CalibrationLabelSetSchema,
} from '@/core/schemas';
import { validateLocations } from '@/core/paperChecks';
import { buildExportPackage } from '@/core/transfer/buildExportPackage';
import { planImport, type ImportPlan } from '@/core/transfer/planImport';
import { sourceHash } from '@/core/text/hash';
import { z } from 'zod';
import type { ParagraphDb } from './db';
import { createPaperReviewsRepository, rebuildReviewRecord } from './paperReviews';
import { createPaperProbesRepository } from './paperProbes';
import { createMeasurementsRepository } from './measurements';
import { createLibraryRepository } from './library';
import { createStanceRepository } from './stance';
import { createPaperInsightsRepository } from './paperInsights';
import { CorpusSchema } from '@/core/schemas/corpus';
import { readAnalyses, SourceImmutableError, type StorageDeps } from './storageShared';
import type { createAnalysesRepository } from './analyses';
import type { createAuditRepository } from './audit';
import type { createGenerationsRepository } from './generations';
import type { createPapersRepository } from './papers';
import type { createPaperOverviewsRepository } from './paperOverviews';
import type { createPaperChecksRepository } from './paperChecks';
import type { createCalibrationLabelsRepository } from './calibrationLabels';
import type { createCorporaRepository } from './corpora';
export function createTransferRepository(
  db: ParagraphDb,
  clock: () => Date,
  deps: StorageDeps,
  repositories: {
    analyses: ReturnType<typeof createAnalysesRepository>;
    audit: ReturnType<typeof createAuditRepository>;
    generations: ReturnType<typeof createGenerationsRepository>;
    papers: ReturnType<typeof createPapersRepository>;
    paperOverviews: ReturnType<typeof createPaperOverviewsRepository>;
    paperChecks: ReturnType<typeof createPaperChecksRepository>;
    paperReviews: ReturnType<typeof createPaperReviewsRepository>;
    paperProbes: ReturnType<typeof createPaperProbesRepository>;
    measurements: ReturnType<typeof createMeasurementsRepository>;
    library: ReturnType<typeof createLibraryRepository>;
    stance: ReturnType<typeof createStanceRepository>;
    paperInsights: ReturnType<typeof createPaperInsightsRepository>;
    calibrationLabels: ReturnType<typeof createCalibrationLabelsRepository>;
    corpora: ReturnType<typeof createCorporaRepository>;
  },
) {
  const { makeAudit } = deps;
  const {
    analyses,
    audit,
    generations,
    papers,
    paperOverviews,
    paperChecks,
    paperReviews,
    paperProbes,
    measurements,
    library,
    stance,
    paperInsights,
    calibrationLabels,
    corpora,
  } = repositories;
  const transfer = {
    async exportAll(appVersion: string) {
      const a = await readAnalyses(db);
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
        (await db.paperProbes.toArray()).map((value) => PaperProbesRecordSchema.parse(value)),
        await calibrationLabels.list(),
        (await db.measurements.toArray()).map((value) => MeasurementsRecordSchema.parse(value)),
        await library.list(),
        (await db.stance.toArray()).map((value) => StanceRecordSchema.parse(value)),
        (await db.paperInsights.toArray()).map((value) => PaperInsightsRecordSchema.parse(value)),
        (await db.extractionProjects.toArray()).map((value) => ExtractionProjectSchema.parse(value)),
        await corpora.list(),
      );
    },
    async previewImport(raw: unknown) {
      const a = await readAnalyses(db);
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
        new Set(await db.calibrationLabels.toCollection().primaryKeys()),
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
          db.paperProbes,
          db.measurements,
          db.library,
          db.stance,
          db.paperInsights,
          db.extractionProjects,
          db.corpora,
          db.reviewNgrams,
          db.calibrationLabels,
        ],
        async () => {
          for (const item of plan.calibrationLabels) {
            if (await db.calibrationLabels.get(item.id)) throw new Error('Import preview is out of date');
            await db.calibrationLabels.add(CalibrationLabelSetSchema.parse(item));
          }
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
          for (const record of plan.paperProbes) {
            if (!(await db.papers.get(record.paperId))) continue;
            const existing = await paperProbes.get(record.paperId);
            if (!existing || record.updatedAt > existing.updatedAt)
              await db.paperProbes.put(PaperProbesRecordSchema.parse(record));
          }
          for (const record of plan.measurements) {
            if (!(await db.papers.get(record.paperId))) continue;
            const existing = await measurements.get(record.paperId);
            if (!existing || record.updatedAt > existing.updatedAt)
              await db.measurements.put(MeasurementsRecordSchema.parse(record));
          }
          for (const record of plan.stance) {
            if (!(await db.papers.get(record.paperId))) continue;
            const existing = await stance.get(record.paperId);
            if (!existing || record.updatedAt > existing.updatedAt)
              await db.stance.put(StanceRecordSchema.parse(record));
          }
          for (const record of plan.paperInsights) {
            if (!(await db.papers.get(record.paperId))) continue;
            const existing = await paperInsights.get(record.paperId);
            if (!existing || record.updatedAt > existing.updatedAt)
              await db.paperInsights.put(PaperInsightsRecordSchema.parse(record));
          }
          for (const record of plan.extractionProjects) {
            const existing = await db.extractionProjects.get(record.id);
            if (!existing || record.updatedAt > existing.updatedAt)
              await db.extractionProjects.put(ExtractionProjectSchema.parse(record));
          }
          for (const record of plan.corpora) {
            const existing = await db.corpora.get(record.id);
            if (!existing || record.updatedAt > existing.updatedAt)
              await db.corpora.put(CorpusSchema.parse(record));
          }
          for (const record of plan.library) {
            const existing = await db.library.where('doi').equals(record.doi).first();
            if (existing && record.updatedAt <= existing.updatedAt) continue;
            const paperKnown = record.paper_id !== null && (await db.papers.get(record.paper_id));
            await db.library.put(
              LibraryItemSchema.parse({
                ...record,
                id: existing?.id ?? record.id,
                paper_id: paperKnown ? record.paper_id : null,
                file_matches_title: paperKnown ? record.file_matches_title : null,
              }),
            );
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
  return transfer;
}
