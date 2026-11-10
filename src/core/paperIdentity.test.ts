import { describe, expect, it } from 'vitest';
import { authorsShort, detectTitle, paperIdentity } from './paperIdentity';
import type { LibraryItem, Paper, PaperMetadata } from './schemas';

const at = '2026-01-01T00:00:00.000Z';
const paragraph = (id: string, sectionId: string, order: number, text: string, kind = 'body') =>
  ({ id, sectionId, order, text, kind, textHash: id, pageStart: 1 }) as Paper['paragraphs'][number];
const paper = (first: string, role = 'other'): Paper =>
  ({
    schemaVersion: 1,
    id: '00000000-0000-4000-8000-000000000001',
    title: '2605.03202v2',
    createdAt: at,
    updatedAt: at,
    source: { kind: 'pdf', fileName: '2605.03202v2.pdf', pageCount: 3, sha256: 'x' },
    sections: [
      { id: 'front', heading: 'Front matter', role, level: 1, pageStart: 1 },
      { id: 'abs', heading: 'Abstract', role: 'abstract', level: 1, pageStart: 1 },
    ],
    paragraphs: [
      paragraph('p2', 'front', 1, 'Ada Lovelace  Alan Turing'),
      paragraph('p1', 'front', 0, first),
      paragraph('p3', 'abs', 2, 'We study things.'),
    ],
  }) as Paper;
const metadata = {
  title: 'The Real Title',
  authors: ['Ada Lovelace', 'Alan Turing'],
  year: 2026,
  venue: 'arXiv',
} as PaperMetadata;
const library = { title: 'Library Title', authors: ['L. One'], year: 2020, venue: 'J' } as LibraryItem;

describe('paper identity', () => {
  it('reads the title from the first line of the front matter', () => {
    expect(detectTitle(paper('Stop  Automating\nPeer Review'))).toBe('Stop Automating Peer Review');
  });
  it('does not guess when the first page gives nothing usable', () => {
    expect(detectTitle(paper('v2'))).toBeNull();
    expect(detectTitle(paper('x'.repeat(301)))).toBeNull();
    // A paper that opens straight on a named section has no front matter to read.
    expect(detectTitle(paper('Stop Automating Peer Review', 'introduction'))).toBeNull();
  });
  it('prefers looked-up metadata, then the DOI library, then the detected title, then the file name', () => {
    const detected = paper('Stop Automating Peer Review');
    expect(paperIdentity(detected, { metadata, library })).toEqual({
      title: 'The Real Title',
      titleSource: 'metadata',
      authors: ['Ada Lovelace', 'Alan Turing'],
      year: 2026,
      venue: 'arXiv',
    });
    expect(paperIdentity(detected, { metadata: null, library })).toMatchObject({
      title: 'Library Title',
      titleSource: 'library',
      authors: ['L. One'],
      year: 2020,
    });
    expect(paperIdentity(detected)).toEqual({
      title: 'Stop Automating Peer Review',
      titleSource: 'detected',
      authors: [],
      year: null,
      venue: null,
    });
    expect(paperIdentity(paper('v2'))).toMatchObject({ title: '2605.03202v2', titleSource: 'file' });
  });
  it('shortens a long author list', () => {
    expect(authorsShort(['A', 'B'])).toBe('A, B');
    expect(authorsShort(['A', 'B', 'C', 'D', 'E'])).toBe('A, B, C và 2 người khác');
  });
});
