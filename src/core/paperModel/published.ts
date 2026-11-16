import type { PaperModel } from '../schemas';

export function publishedPaperId(model: PaperModel, localPaperId: string): string {
  const sha = model.document.source.sha256;
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
