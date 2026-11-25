import { projectHeader } from '@/shared/scope';
import { z } from 'zod';
import { PDF_WORKER_URL, PdfRemoteError, projectScopedUrl } from './index';

const projectFileSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  contentType: z.string(),
  size: z.number().int().nonnegative(),
  uploadedAt: z.string(),
  projectId: z.string().uuid(),
});
const projectFilesPageSchema = z.object({ items: z.array(projectFileSchema), cursor: z.string().nullable() });

export type ResearchHubProjectFile = z.output<typeof projectFileSchema>;

async function request(path: string, projectId: string, token: string) {
  const response = await fetch(projectScopedUrl(`${PDF_WORKER_URL}${path}`, projectId), {
    headers: { Authorization: `Bearer ${token}`, ...projectHeader(projectId) },
    cache: 'no-store',
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const detail =
      body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
        ? body.error
        : undefined;
    throw new PdfRemoteError(response.status, detail);
  }
  return response;
}

export async function listResearchHubProjectFiles(
  projectId: string,
  token: string,
): Promise<ResearchHubProjectFile[]> {
  const files: ResearchHubProjectFile[] = [];
  let cursor: string | null = null;
  do {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    const response = await request(`/v1/researchhub/files${query}`, projectId, token);
    const page = projectFilesPageSchema.parse(await response.json());
    files.push(...page.items.filter((file) => file.projectId.toLowerCase() === projectId.toLowerCase()));
    cursor = page.cursor;
  } while (cursor);
  return files.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt) || a.id.localeCompare(b.id));
}

export async function downloadResearchHubProjectFile(
  fileId: string,
  projectId: string,
  token: string,
): Promise<Blob> {
  const response = await request(`/v1/researchhub/files/${encodeURIComponent(fileId)}`, projectId, token);
  return response.blob();
}
