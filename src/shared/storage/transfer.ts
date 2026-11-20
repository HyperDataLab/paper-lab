import {
  AnalysisSchema,
  AuditEventSchema,
  RevisionSchema,
  PaperReviewsRecordSchema,
  ExportPackageSchema,
  type PaperOverviewRecord,
  PaperChecksRecordSchema,
  PaperProbesRecordSchema,
  LibraryItemSchema,
  StanceRecordSchema,
  PaperInsightsRecordSchema,
  ExtractionProjectSchema,
  CalibrationLabelSetSchema,
} from '@/core/schemas';
import { buildExportPackage } from '@/core/transfer/buildExportPackage';
import { planImport, type ImportPlan } from '@/core/transfer/planImport';
import { sourceHash } from '@/core/text/hash';
import { z } from 'zod';
import type { ParagraphDb } from './db';
import type { DocStore } from './docStore';
import { applyPaperImport } from './paperTransfer';
import { createMeasurementsRepository } from './measurements';
import { createLibraryRepository, libraryByDois } from './library';
import { CorpusSchema } from '@/core/schemas/corpus';
import { readAnalyses, type StorageDeps } from './storageShared';
import type { createAuditRepository } from './audit';
import type { createGenerationsRepository } from './generations';
import type { createPapersRepository } from './papers';
import type { createPaperOverviewsRepository } from './paperOverviews';
import type { createCalibrationLabelsRepository } from './calibrationLabels';
import { StoredCorpusProfileSchema } from '@/core/schemas/corpusProfile';
import type { createCorporaRepository } from './corpora';
import { ResearchDesignSchema } from '@/core/schemas/researchDesign';
import { bankDocSchema } from '@/core/researchDesign/bank/snapshot';
import { snapshotRelease } from '@/core/researchDesign/bank/release';
import { toBankDoc } from '@/core/researchDesign/bank/readSnapshot';
import { canResume } from '@/core/autoresearch/artifacts';
import { runSchema } from '@/core/autoresearch/record';
/** Writes per lab commit for the corpus-group part of an import; the lab server accepts at most 100. */
const IMPORT_BATCH = 50;
const chunks = <T>(values: readonly T[]) =>
  Array.from({ length: Math.ceil(values.length / IMPORT_BATCH) }, (_, i) =>
    values.slice(i * IMPORT_BATCH, (i + 1) * IMPORT_BATCH),
  );

export function createTransferRepository(
  db: ParagraphDb,
  store: DocStore,
  clock: () => Date,
  deps: StorageDeps,
  repositories: {
    audit: ReturnType<typeof createAuditRepository>;
    generations: ReturnType<typeof createGenerationsRepository>;
    papers: ReturnType<typeof createPapersRepository>;
    paperOverviews: ReturnType<typeof createPaperOverviewsRepository>;
    measurements: ReturnType<typeof createMeasurementsRepository>;
    library: ReturnType<typeof createLibraryRepository>;
    calibrationLabels: ReturnType<typeof createCalibrationLabelsRepository>;
    corpora: ReturnType<typeof createCorporaRepository>;
  },
) {
  const { makeAudit } = deps;
  const { audit, generations, papers, paperOverviews, measurements, library, calibrationLabels, corpora } =
    repositories;
  async function list<S extends z.ZodType>(collection: string, schema: S): Promise<z.output<S>[]> {
    return (await store.query(collection)).map(({ doc }) => schema.parse(doc));
  }
  const pendingLocalImports = new WeakSet<Extract<ImportPlan, { ok: true }>>();
  const transfer = {
    async exportAll(appVersion: string) {
      const a = await readAnalyses(store);
      const events = await audit.listAll();
      const storedRevisions = await list('revisions', RevisionSchema);
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
            (await store.query('paperOverviews', { select: 'summary' })).map(({ id }) =>
              paperOverviews.get(id),
            ),
          )
        ).filter((value): value is PaperOverviewRecord => value !== undefined),
        await list('paperChecks', PaperChecksRecordSchema),
        await list('paperReviews', PaperReviewsRecordSchema),
        await list('paperProbes', PaperProbesRecordSchema),
        await calibrationLabels.list(),
        await measurements.list(),
        await library.list(),
        await list('stance', StanceRecordSchema),
        await list('paperInsights', PaperInsightsRecordSchema),
        (await db.extractionProjects.toArray()).map((value) => ExtractionProjectSchema.parse(value)),
        await corpora.list(),
        await list('corpusProfiles', StoredCorpusProfileSchema),
        (await db.researchDesigns.toArray()).map((row) => ResearchDesignSchema.parse(row)),
        (await db.researchDesignBanks.toArray()).map((row) => ({
          projectId: row.projectId,
          bank: bankDocSchema.parse(row.bank),
          bytes: row.bytes,
        })),
        (await db.autoresearchRuns.toArray()).map((row) => runSchema.parse(row)),
      );
    },
    async previewImport(raw: unknown) {
      const a = await readAnalyses(store);
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
        new Set((await store.query('revisions', { select: 'summary' })).map((row) => row.id)),
        new Set((await store.query('generations', { select: 'summary' })).map((row) => row.id)),
        new Map(
          (await papers.list()).map((paper) => [
            paper.id,
            { updatedAt: paper.updatedAt, sha256: paper.source.sha256 },
          ]),
        ),
        new Set((await store.query('calibrationLabels', { select: 'summary' })).map((row) => row.id)),
      );
    },
    async applyImport(plan: Extract<ImportPlan, { ok: true }>) {
      const researchRuns = plan.autoresearchRuns.map((run) => runSchema.parse(run));
      for (const run of researchRuns)
        if (!(await canResume(run))) throw new Error('AutoResearch artifact hash mismatch');
      for (const row of plan.researchDesignBanks) {
        const bytes = new Uint8Array(row.bytes).buffer;
        const data: unknown = JSON.parse(new TextDecoder().decode(bytes));
        const result = await snapshotRelease(data, bytes);
        if (
          !result.ok ||
          JSON.stringify(toBankDoc(result.file, result.release, row.bank.importedBy, row.bank.importedAt)) !==
            JSON.stringify(row.bank)
        )
          throw new Error('Invalid research design bank snapshot');
      }
      for (const revision of plan.revisionsToInsert)
        if ((await sourceHash(revision.revisedText)) !== revision.revisedHash)
          throw new Error('Revision hash mismatch');
      const localActions = new Set(['import_labels', 'run_extraction', 'review_extraction']);
      if (!pendingLocalImports.has(plan)) {
        if (
          (
            await store.getMany(
              'calibrationLabels',
              plan.calibrationLabels.map(({ id }) => id),
            )
          ).some(Boolean)
        )
          throw new Error('Import preview is out of date');
        await applyPaperImport(
          store,
          makeAudit,
          { ...plan, auditEvents: plan.auditEvents.filter(({ action }) => !localActions.has(action)) },
          new Set((await audit.listAll()).items.map((event) => event.id)),
        );
        pendingLocalImports.add(plan);
      }
      const linkedPaperIds = [
        ...new Set(plan.library.flatMap(({ paper_id }) => (paper_id ? [paper_id] : []))),
      ];
      const knownPapers = new Set(
        (await papers.getMany(linkedPaperIds)).flatMap((paper) => (paper ? [paper.id] : [])),
      );
      await db.transaction(
        'rw',
        [
          db.library,
          db.auditEvents,
          db.extractionProjects,
          db.researchDesigns,
          db.researchDesignBanks,
          db.autoresearchRuns,
        ],
        async () => {
          for (const event of plan.auditEvents) {
            if (localActions.has(event.action) && !(await db.auditEvents.get(event.id)))
              await db.auditEvents.add(AuditEventSchema.parse(event));
          }
          for (const record of plan.extractionProjects) {
            const existing = await db.extractionProjects.get(record.id);
            if (!existing || record.updatedAt > existing.updatedAt)
              await db.extractionProjects.put(ExtractionProjectSchema.parse(record));
          }
          for (const record of plan.researchDesigns) {
            if (!(await db.extractionProjects.get(record.projectId))) continue;
            const existing = await db.researchDesigns.get(record.projectId);
            if (existing) continue;
            const bank = plan.researchDesignBanks.find((row) => row.projectId === record.projectId);
            if (record.bankRelease && (!bank || bank.bank.release !== record.bankRelease))
              throw new Error('Missing research design bank');
            await db.researchDesigns.add(ResearchDesignSchema.parse(record));
            if (bank)
              await db.researchDesignBanks.add({
                projectId: record.projectId,
                bank: bankDocSchema.parse(bank.bank),
                bytes: bank.bytes,
              });
          }
          for (const run of researchRuns) {
            if (!(await db.extractionProjects.get(run.projectId)) || (await db.autoresearchRuns.get(run.id)))
              continue;
            if (
              run.status !== 'ended' &&
              (await db.autoresearchRuns
                .where('projectId')
                .equals(run.projectId)
                .filter((existing) => existing.status !== 'ended')
                .first())
            )
              throw new Error('AutoResearch project already has an active run');
            await db.autoresearchRuns.add(
              runSchema.parse({
                ...run,
                status: run.status === 'running' ? 'waiting' : run.status,
              }),
            );
          }
        },
      );
      // The corpus group sits on the lab store when signed in. Each batch commits on its own and skips what an
      // earlier, interrupted run already wrote, so applying the same plan again finishes the rest.
      for (const part of chunks(plan.calibrationLabels))
        await store.unitOfWork(
          async (tx) => {
            for (const item of part)
              if (!(await tx.get('calibrationLabels', item.id)))
                await tx.put('calibrationLabels', item.id, CalibrationLabelSetSchema.parse(item), null);
          },
          ['calibrationLabels'],
        );
      for (const part of chunks(plan.corpora))
        await store.unitOfWork(
          async (tx) => {
            const rows = await tx.getMany(
              'corpora',
              part.map(({ id }) => id),
            );
            for (const [i, record] of part.entries()) {
              const existing = rows[i] ? CorpusSchema.parse(rows[i].doc) : undefined;
              if (!existing || record.updatedAt > existing.updatedAt)
                await tx.put('corpora', record.id, CorpusSchema.parse(record));
            }
          },
          ['corpora'],
        );
      for (const part of chunks(plan.corpusProfiles))
        await store.unitOfWork(
          async (tx) => {
            const rows = await tx.getMany(
              'corpusProfiles',
              part.map(({ corpusId }) => corpusId),
            );
            for (const [i, record] of part.entries()) {
              const existing = rows[i] ? StoredCorpusProfileSchema.parse(rows[i].doc) : undefined;
              if (!existing || record.savedAt > existing.savedAt)
                await tx.put('corpusProfiles', record.corpusId, StoredCorpusProfileSchema.parse(record));
            }
          },
          ['corpusProfiles'],
        );
      for (const part of chunks(plan.library))
        await store.unitOfWork(
          async (tx) => {
            const byDoi = new Map(
              (
                await libraryByDois(
                  tx,
                  part.map(({ doi }) => doi),
                )
              ).map((item) => [item.doi, item]),
            );
            for (const record of part) {
              const existing = byDoi.get(record.doi);
              if (existing && record.updatedAt <= existing.updatedAt) continue;
              const paperKnown = record.paper_id !== null && knownPapers.has(record.paper_id);
              const value = LibraryItemSchema.parse({
                ...record,
                id: existing?.id ?? record.id,
                paper_id: paperKnown ? record.paper_id : null,
                file_matches_title: paperKnown ? record.file_matches_title : null,
              });
              await tx.put('library', value.id, value);
            }
          },
          ['library'],
        );
      pendingLocalImports.delete(plan);
    },
  };
  return transfer;
}
