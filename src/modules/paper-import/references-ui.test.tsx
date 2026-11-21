import { webcrypto } from 'node:crypto';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Paper } from '@/core/schemas';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import { PaperReferences } from './PaperReferences';
import { testRepositories } from '@/shared/storage/testRepositories';

const at = '2026-01-01T00:00:00.000Z';
const paper: Paper = {
  schemaVersion: 1,
  id: '00000000-0000-4000-8000-0000000000ab',
  title: 'T',
  createdAt: at,
  updatedAt: at,
  source: { kind: 'pdf', fileName: 'a.pdf', pageCount: 9, sha256: '' },
  sections: [{ id: 'r', heading: 'References', role: 'references', level: 1, pageStart: 9 }],
  paragraphs: [
    {
      id: 'r0',
      sectionId: 'r',
      order: 0,
      kind: 'body',
      text: '[1] A. Author, Federated learning, 2020. [2] B. Writer, Edge AI, arXiv:2101.00001 [3] C. Coder, Green ML, doi:10.1000/xyz, 2021.',
      pageStart: 9,
      textHash: '',
    },
  ],
};

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
});

it('RA-13 retraction check retains a saved reference audit', async () => {
  const repo = testRepositories();
  const audit = { schemaVersion: 1 as const, auditedAt: at, items: [], reviewed: ['hash'] };
  await repo.paperContext.save({
    schemaVersion: 1,
    paperId: paper.id,
    checkedAt: at,
    paperDoi: null,
    checked: 0,
    found: 0,
    retracted: [],
    retractionChecked: false,
    metadata: null,
    referenceAudit: audit,
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ results: [] }), { status: 200 })),
  );
  render(
    <StorageProvider repositories={repo}>
      <PaperReferences paper={paper} onLocation={() => {}} />
    </StorageProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Kiểm tra rút bài' }));
  await waitFor(async () => expect((await repo.paperContext.get(paper.id))?.retractionChecked).toBe(true));
  expect((await repo.paperContext.get(paper.id))?.referenceAudit).toEqual(audit);
  vi.unstubAllGlobals();
});

it('the reference list shows every entry on its own line, and each opens its place', async () => {
  const repo = testRepositories();
  await repo.papers.create(paper);
  const onLocation = vi.fn();
  render(
    <StorageProvider repositories={repo}>
      <PaperReferences paper={paper} onLocation={onLocation} />
    </StorageProvider>,
  );
  const list = await screen.findByRole('list', { name: 'References' });
  const rows = within(list).getAllByRole('listitem');
  expect(rows).toHaveLength(3);
  expect(rows[0]).toHaveTextContent('A. Author, Federated learning, 2020.');
  expect(within(rows[2] as HTMLElement).getByRole('link', { name: 'DOI' })).toHaveAttribute(
    'href',
    'https://doi.org/10.1000/xyz',
  );
  fireEvent.click(within(rows[1] as HTMLElement).getByRole('button', { name: 'References · Tr. 9' }));
  expect(onLocation).toHaveBeenCalledWith(expect.objectContaining({ paragraphId: 'r0' }));
});
