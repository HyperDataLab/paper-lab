import { segmentPaper } from '@/core/paper';
import { guardPaperSize } from './sizeGuard';
export async function parseMarkdown(text: string) {
  guardPaperSize(new TextEncoder().encode(text).length);
  return segmentPaper(text);
}
export const parsePlainText = parseMarkdown;
