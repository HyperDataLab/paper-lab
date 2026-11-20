import {
  CorpusKeywordsSchema,
  CorpusTopicsSchema,
  DoiKeywordsSchema,
  ExportPackageSchema,
  GrobidRecordSchema,
  PaperContextRecordSchema,
  PaperRunSchema,
  ScgPaperRunSchema,
  TopicNameSchema,
} from '@/core/schemas';
import { ProjectWorkspaceSnapshotSchema, projectWorkspaceSnapshot } from '@/shared/projectWorkspace';
import type { ParagraphDb } from './db';
import type { Repositories } from './repositories';

export async function exportProjectWorkspace(db: ParagraphDb, repositories: Repositories, projectId: string) {
  const exported = await repositories.transfer.exportAll('0.1.0');
  const packageData = ExportPackageSchema.parse({
    ...exported,
    analyses: [],
    auditEvents: [],
    revisions: [],
    generations: [],
    calibrationLabels: [],
  });
  const payload = ProjectWorkspaceSnapshotSchema.shape.payload.parse({
    package: packageData,
    paperRuns: (await db.paperRuns.toArray()).map((row) => PaperRunSchema.parse(row)),
    paperContext: (await db.paperContext.toArray()).map((row) => PaperContextRecordSchema.parse(row)),
    corpusTopics: (await db.corpusTopics.toArray()).map((row) => ({
      ...CorpusTopicsSchema.parse(row),
      corpusIds: row.corpusIds,
    })),
    topicNames: (await db.topicNames.toArray()).map((row) => TopicNameSchema.parse(row)),
    corpusKeywords: (await db.corpusKeywords.toArray()).map((row) => CorpusKeywordsSchema.parse(row)),
    doiKeywords: (await db.doiKeywords.toArray()).map((row) => DoiKeywordsSchema.parse(row)),
    scgRuns: (await db.scgRuns.toArray()).map((row) => ScgPaperRunSchema.parse(row)),
    grobid: (await db.grobid.toArray()).map((row) => GrobidRecordSchema.parse(row)),
  });
  return projectWorkspaceSnapshot(projectId, payload);
}

export async function importProjectWorkspace(db: ParagraphDb, repositories: Repositories, value: unknown) {
  const { payload } = ProjectWorkspaceSnapshotSchema.parse(value);
  const plan = await repositories.transfer.previewImport(payload.package);
  if (!plan.ok) throw new Error('Dữ liệu project từ server không hợp lệ.');
  await repositories.transfer.applyImport(plan);
  await db.transaction(
    'rw',
    [db.paperRuns, db.paperContext, db.corpusTopics, db.topicNames, db.corpusKeywords, db.doiKeywords, db.scgRuns, db.grobid],
    async () => {
      await db.paperRuns.bulkPut(payload.paperRuns);
      await db.paperContext.bulkPut(payload.paperContext);
      await db.corpusTopics.bulkPut(payload.corpusTopics);
      await db.topicNames.bulkPut(payload.topicNames);
      await db.corpusKeywords.bulkPut(payload.corpusKeywords);
      await db.doiKeywords.bulkPut(payload.doiKeywords);
      await db.scgRuns.bulkPut(payload.scgRuns);
      await db.grobid.bulkPut(payload.grobid);
    },
  );
  return payload;
}

export function hasProjectData(value: Awaited<ReturnType<typeof exportProjectWorkspace>>['payload']) {
  const data = value.package;
  return Boolean(
    data.papers.length ||
      data.library.length ||
      data.extractionProjects.length ||
      data.corpora.length ||
      value.paperRuns.length ||
      value.paperContext.length ||
      value.corpusTopics.length ||
      value.topicNames.length ||
      value.corpusKeywords.length ||
      value.doiKeywords.length ||
      value.scgRuns.length ||
      value.grobid.length,
  );
}

export function sameWorkspaceData(
  left: Awaited<ReturnType<typeof exportProjectWorkspace>>['payload'],
  right: Awaited<ReturnType<typeof exportProjectWorkspace>>['payload'],
) {
  return JSON.stringify(left) === JSON.stringify(right);
}
