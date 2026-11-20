import { z } from 'zod';
import {
  CorpusKeywordsSchema,
  CorpusTopicsSchema,
  DoiKeywordsSchema,
  ExportPackageSchema,
  GrobidRecordSchema,
  PaperContextRecordSchema,
  ScgPaperRunSchema,
  TopicNameSchema,
} from '@/core/schemas';
import { PaperRunSchema } from '@/core/schemas/paperRun';
import { PDF_WORKER_URL } from '@/shared/pdfStore';

const projectSchema = z.object({ id: z.uuid(), name: z.string() });
export const ProjectWorkspaceSnapshotSchema = z.object({
  format: z.literal('paperlab-project-workspace'),
  schemaVersion: z.literal(1),
  projectId: z.uuid(),
  updatedAt: z.iso.datetime(),
  payload: z.object({
    package: ExportPackageSchema,
    paperRuns: z.array(PaperRunSchema),
    paperContext: z.array(PaperContextRecordSchema),
    corpusTopics: z.array(CorpusTopicsSchema.extend({ corpusIds: z.array(z.string()) })),
    topicNames: z.array(TopicNameSchema),
    corpusKeywords: z.array(CorpusKeywordsSchema),
    doiKeywords: z.array(DoiKeywordsSchema),
    scgRuns: z.array(ScgPaperRunSchema),
    grobid: z.array(GrobidRecordSchema),
  }),
});
export type ProjectWorkspaceSnapshot = z.infer<typeof ProjectWorkspaceSnapshotSchema>;

const responseSchema = z.object({
  project: projectSchema,
  snapshot: ProjectWorkspaceSnapshotSchema.nullable(),
  version: z.string().nullable(),
});
export class ProjectWorkspaceError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly latestVersion: string | null = null,
  ) {
    super(message);
  }
}

function endpoint(projectId: string) {
  return `${PDF_WORKER_URL}/v1/workspaces/${encodeURIComponent(projectId)}`;
}

function errorMessage(status: number, body: unknown) {
  if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
    const detail = 'message' in body && typeof body.message === 'string' ? body.message : '';
    return detail ? `${body.error}: ${detail}` : body.error;
  }
  return `ResearchHub project request failed (${status})`;
}

export async function pullProjectWorkspace(projectId: string, token: string) {
  let response: Response;
  try {
    response = await fetch(endpoint(projectId), { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    throw new ProjectWorkspaceError(0, 'Không kết nối được máy chủ PaperLab.');
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new ProjectWorkspaceError(response.status, errorMessage(response.status, body));
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success || parsed.data.project.id !== projectId)
    throw new ProjectWorkspaceError(502, 'Máy chủ trả dữ liệu project không hợp lệ.');
  return parsed.data;
}

export async function pushProjectWorkspace(
  snapshot: ProjectWorkspaceSnapshot,
  version: string | null,
  token: string,
) {
  const value = ProjectWorkspaceSnapshotSchema.parse(snapshot);
  let response: Response;
  try {
    response = await fetch(endpoint(value.projectId), {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(version ? { 'If-Match': version } : { 'If-None-Match': '*' }),
      },
      body: JSON.stringify(value),
    });
  } catch {
    throw new ProjectWorkspaceError(0, 'Không kết nối được máy chủ PaperLab.');
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const latest =
      body && typeof body === 'object' && 'version' in body && typeof body.version === 'string'
        ? body.version
        : null;
    throw new ProjectWorkspaceError(response.status, errorMessage(response.status, body), latest);
  }
  const result = z.object({ project: projectSchema, version: z.string() }).safeParse(body);
  if (!result.success) throw new ProjectWorkspaceError(502, 'Máy chủ lưu project nhưng trả phiên bản không hợp lệ.');
  return result.data;
}

export function projectWorkspaceSnapshot(
  projectId: string,
  payload: ProjectWorkspaceSnapshot['payload'],
): ProjectWorkspaceSnapshot {
  return ProjectWorkspaceSnapshotSchema.parse({
    format: 'paperlab-project-workspace',
    schemaVersion: 1,
    projectId,
    updatedAt: new Date().toISOString(),
    payload,
  });
}
