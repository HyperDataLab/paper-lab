import {
  AnalysisSchema,
  validateAnalysisSpans,
  RevisionSchema,
  GenerationSchema,
  PaperSchema,
  type Paper,
  PaperOverviewRecordSchema,
  PaperChecksRecordSchema,
  type PaperChecksRecord,
  PaperReviewsRecordSchema,
  PaperProbesRecordSchema,
  MeasurementsRecordSchema,
  StanceRecordSchema,
  PaperInsightsRecordSchema,
} from '@/core/schemas';
import { validateLocations } from '@/core/paperChecks';
import type { ImportPlan } from '@/core/transfer/planImport';
import type { z } from 'zod';
import type { DocReader, DocStore } from './docStore';
import { getAnalysis } from './analyses';
import { appendAudit, SourceImmutableError, type StorageDeps } from './storageShared';
import { rebuildReviewRecord } from './paperReviews';
import { clearMeasurementPending, readMeasurementPending } from './measurementCheckpoints';
import { checkpointParts } from './paperCheckpoints';
import { paperImportBatches, type PaperImport } from './paperImportBatches';
import { readReviewNgrams, replaceReviewNgrams } from './reviewNgrams';

async function read<S extends z.ZodType>(
  tx: DocReader,
  collection: string,
  id: string,
  schema: S,
): Promise<z.output<S> | undefined> {
  const row = await tx.get(collection, id);
  return row ? schema.parse(row.doc) : undefined;
}

export async function applyPaperImport(
  store: DocStore,
  makeAudit: StorageDeps['makeAudit'],
  plan: Extract<ImportPlan, { ok: true }>,
  knownAuditIds: Set<string>,
) {
  const ngrams = plan.paperReviews.length ? await readReviewNgrams(store) : [];
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
      (await read(store, 'papers', record.paperId, PaperSchema));
    const existing = await read(store, 'paperReviews', record.paperId, PaperReviewsRecordSchema);
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
  if (plan.suppressed.length) console.warn('Suppressed invalid imported spans', plan.suppressed);
  for (const batch of paperImportBatches(plan)) {
    await commitPaperImport(store, makeAudit, batch, preparedReviews, knownAuditIds);
  }
}

async function commitPaperImport(
  store: DocStore,
  makeAudit: StorageDeps['makeAudit'],
  plan: PaperImport,
  preparedReviews: Map<
    string,
    {
      paper: Paper;
      previousUpdatedAt: string | undefined;
      rebuilt: Awaited<ReturnType<typeof rebuildReviewRecord>>;
    }
  >,
  knownAuditIds: Set<string>,
) {
  await store.unitOfWork(
    async (tx) => {
      for (const value of [...plan.toInsert, ...plan.toUpdate]) {
        const incoming = validateAnalysisSpans(AnalysisSchema.parse(value)).valid;
        const current = (await tx.get('analyses', incoming.id))?.doc;
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
        await tx.put('analyses', incoming.id, incoming);
        await appendAudit(tx, makeAudit(value.id, 'import', 'system'));
      }
      for (const raw of plan.revisionsToInsert) {
        const revision = RevisionSchema.parse(raw);
        const source = await getAnalysis(tx, revision.sourceAnalysisId);
        if (!source || source.text.sourceHash !== revision.sourceHash)
          throw new Error('Revision source mismatch');
        if (await tx.get('revisions', revision.id)) throw new Error('Import preview is out of date');
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
            check.spans.some((span) => span.end > (span.side === 'source' ? sourceLength : revisedLength)),
          )
        )
          throw new Error('Invalid revision spans');
        await tx.put('revisions', revision.id, revision, null);
      }
      for (const generation of plan.generationsToInsert) {
        if (await tx.get('generations', generation.id)) throw new Error('Import preview is out of date');
        await tx.put('generations', generation.id, GenerationSchema.parse(generation), null);
      }
      for (const paper of plan.papersToInsert) {
        if (await tx.get('papers', paper.id)) throw new Error('Import preview is out of date');
        await tx.put('papers', paper.id, PaperSchema.parse(paper), null);
      }
      for (const raw of plan.papersToUpdate) {
        const paper = PaperSchema.parse(raw);
        const current = await read(tx, 'papers', paper.id, PaperSchema);
        if (
          !current ||
          current.source.sha256 !== paper.source.sha256 ||
          Date.parse(paper.updatedAt) <= Date.parse(current.updatedAt)
        )
          throw new Error('Import preview is out of date');
        if (JSON.stringify(current.paragraphs) !== JSON.stringify(paper.paragraphs))
          throw new SourceImmutableError('Paper paragraphs are immutable');
        await tx.put('papers', paper.id, paper);
        await appendAudit(tx, makeAudit(paper.id, 'import', 'system'));
      }
      const importedFindings = new Map<string, Set<string>>();
      for (const record of plan.paperOverviews) {
        if (!(await tx.get('papers', record.paperId))) continue;
        const existing = await read(tx, 'paperOverviews', record.paperId, PaperOverviewRecordSchema);
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
          await tx.put('paperOverviews', record.paperId, PaperOverviewRecordSchema.parse(record));
          importedFindings.set(
            record.paperId,
            new Set(record.transitions?.findings.map((finding) => finding.id) ?? []),
          );
        }
      }
      for (const record of plan.paperChecks) {
        const paper = await read(tx, 'papers', record.paperId, PaperSchema);
        if (!paper) continue;
        const existing = await read(tx, 'paperChecks', record.paperId, PaperChecksRecordSchema);
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
          await tx.put('paperChecks', record.paperId, value);
        }
      }
      for (const record of plan.paperReviews) {
        const paper = await read(tx, 'papers', record.paperId, PaperSchema);
        if (!paper) continue;
        const existing = await read(tx, 'paperReviews', record.paperId, PaperReviewsRecordSchema);
        const prepared = preparedReviews.get(record.paperId);
        if (prepared && prepared.previousUpdatedAt !== existing?.updatedAt)
          throw new Error('Review changed; retry');
        if (!existing || record.updatedAt > existing.updatedAt) {
          if (!prepared || JSON.stringify(prepared.paper.paragraphs) !== JSON.stringify(paper.paragraphs))
            throw new Error('Paper changed');
          const rebuilt = prepared.rebuilt;
          await tx.put('paperReviews', record.paperId, rebuilt.record);
          await replaceReviewNgrams(tx, record.paperId, rebuilt.ngrams);
        }
      }
      for (const record of plan.paperProbes) {
        if (!(await tx.get('papers', record.paperId))) continue;
        const existing = await read(tx, 'paperProbes', record.paperId, PaperProbesRecordSchema);
        if (!existing || record.updatedAt > existing.updatedAt)
          await tx.put('paperProbes', record.paperId, PaperProbesRecordSchema.parse(record));
      }
      for (const record of plan.measurements) {
        if (!(await tx.get('papers', record.paperId))) continue;
        const existing = await read(tx, 'measurements', record.paperId, MeasurementsRecordSchema);
        const pending = await readMeasurementPending(tx, record.paperId);
        if (
          (!existing || record.updatedAt > existing.updatedAt) &&
          (!pending || record.updatedAt > pending.updatedAt)
        ) {
          await clearMeasurementPending(tx, record.paperId);
          await tx.put('measurements', record.paperId, MeasurementsRecordSchema.parse(record));
        }
      }
      for (const record of plan.stance) {
        if (!(await tx.get('papers', record.paperId))) continue;
        const existing = await read(tx, 'stance', record.paperId, StanceRecordSchema);
        if (!existing || record.updatedAt > existing.updatedAt)
          await tx.put('stance', record.paperId, StanceRecordSchema.parse(record));
      }
      for (const record of plan.paperInsights) {
        if (!(await tx.get('papers', record.paperId))) continue;
        const existing = await read(tx, 'paperInsights', record.paperId, PaperInsightsRecordSchema);
        if (!existing || record.updatedAt > existing.updatedAt)
          await tx.put('paperInsights', record.paperId, PaperInsightsRecordSchema.parse(record));
      }

      for (const event of plan.auditEvents)
        if (
          !knownAuditIds.has(event.id) &&
          (event.action !== 'review_transition' ||
            (event.issueId && importedFindings.get(event.analysisId)?.has(event.issueId)))
        ) {
          await appendAudit(tx, event);
        }
    },
    [
      'analyses',
      'revisions',
      'generations',
      'papers',
      'paperOverviews',
      'paperChecks',
      'paperReviews',
      'paperProbes',
      'measurements',
      'stance',
      'paperInsights',
      'reviewNgrams',
      checkpointParts,
    ],
  );
}
