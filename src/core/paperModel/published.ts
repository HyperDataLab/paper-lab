import type { PaperModel } from '../schemas';

export function publishedPaperId(model: PaperModel, localPaperId: string): string {
  return publishedIdFor(model.document.source.sha256, localPaperId);
}

/** The id a paper is published under: `sha256-<hex>` of its file, or its local id when it has no file hash. */
export function publishedIdFor(sha: string | null | undefined, localPaperId: string): string {
  if (!sha) return localPaperId.toLowerCase();
  const match = /^(?:sha256:)?([0-9a-f]{64})$/u.exec(sha);
  if (!match) throw new Error('Invalid source SHA-256');
  return `sha256-${match[1]}`;
}

export async function contentEtag(model: PaperModel): Promise<string> {
  const content: Partial<PaperModel> = { ...model };
  delete content.generatedAt;
  const bytes = new TextEncoder().encode(JSON.stringify(content));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
