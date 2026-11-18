import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { exampleCorpus } from '@/core/corpus/contract';
import { exportIdOf } from '@/core/corpus';
import { sentenceIndex } from '@/core/paperModel';
import type { Paper, ScgContribution, ScgPaperRun, ScgPrerequisite } from '@/core/schemas';
import type { Corpus, CorpusMember } from '@/core/schemas/corpus';
import type { LlmClient } from '@/shared/llm/client';
import { getConfig } from '@/shared/llm/config';
import { acceptConsent } from '@/shared/llm/consent';
import { LlmProvider } from '@/shared/llm/LlmProvider';
import { createDb } from '@/shared/storage/db';
import { createRepositories } from '@/shared/storage/repositories';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import { chooseSelectOption } from '@/test/selectOption';
import { CorpusScgRoadmap } from './CorpusScgRoadmap';

const at = '2026-01-01T00:00:00.000Z';
const uuid = (n: number) => `00000000-0000-4000-8000-00000000010${n}`;
function paper(n: number, text: string): Paper {
  return {
    schemaVersion: 1,
    id: uuid(n),
    title: `Synthetic ${n}`,
    createdAt: at,
    updatedAt: at,
    source: { kind: 'text', fileName: '', pageCount: 1, sha256: '' },
    sections: [{ id: 's', heading: 'Method', role: 'methods', level: 1, pageStart: 1 }],
    paragraphs: [{ id: 'p', sectionId: 's', order: 0, kind: 'body', text, pageStart: 1, textHash: '' }],
  };
}
const contribution = (
  id: string,
  name: string,
  key: string,
  prerequisites: ScgPrerequisite[] = [],
  over: Partial<ScgContribution> = {},
): ScgContribution => ({
  id,
  name,
  description: '',
  types: [{ type: 'models_or_architectures', explanation: '' }],
  sections: [],
  prerequisites,
  sourceSentenceKeys: [key],
  review: 'candidate',
  ...over,
});
function run(paperId: string, contributions: ScgContribution[]): ScgPaperRun {
  return {
    schemaVersion: 1,
    paperId,
    doi: null,
    s2CorpusId: null,
    s2CheckedAt: null,
    idBase: paperId,
    promptVersion: 'a+b+c',
    promptVersions: { contributions: 'a', prerequisites: 'b', alignment: 'c' },
    requestedModel: 'm',
    model: 'm',
    status: 'complete',
    callsUsed: 0,
    dropped: { quotes: 0, contributions: 0, prerequisites: 0, references: 0, matches: 0 },
    contributions,
    progress: { fingerprint: 'f', contributionBatches: {}, prerequisitesDone: [], alignmentDone: [] },
    reviewCarry: {},
    createdAt: at,
    updatedAt: at,
  };
}

function Where() {
  const location = useLocation();
  return <p data-testid="where">{`${location.pathname}${location.search}`}</p>;
}

it('S3 shows coverage, the most built-upon list, a chain with evidence links, filters, and backfills', async () => {
  vi.stubGlobal('crypto', webcrypto);
  localStorage.clear();
  acceptConsent(getConfig(), true);
  const repo = createRepositories(createDb(`roadmap-ui-${crypto.randomUUID()}`));
  const papers = [
    paper(1, 'We release the Alpha corpus.'),
    paper(2, 'Our Beta parser is trained on the Alpha corpus.'),
    paper(3, 'We propose the Gamma tagger.'),
  ];
  for (const item of papers) await repo.papers.create(item);
  const [keyA, keyB, keyC] = papers.map((item) => sentenceIndex(item)[0]!.key);
  const [a, b, c] = papers.map((item) => item.id) as [string, string, string];
  await repo.scg.save(
    run(a, [
      contribution(`${a}.c0`, 'Alpha corpus', keyA!, [], {
        review: 'accepted',
        types: [{ type: 'resource_dataset', explanation: '' }],
      }),
    ]),
  );
  await repo.scg.save(
    run(b, [
      contribution(`${b}.c0`, 'Beta parser', keyB!, [
        {
          id: `${b}.c0.p0`,
          name: 'Alpha corpus',
          description: '',
          explanation: 'Beta is trained on Alpha.',
          coreOrPeripheral: 'core',
          references: [],
          matches: [{ contributionId: `${a}.c0`, explanation: '', matchType: 'strong', review: 'candidate' }],
          sourceSentenceKeys: [keyB!],
          review: 'candidate',
        },
      ]),
    ]),
  );
  const base = exampleCorpus();
  const template = base.members[0]!;
  const member = (n: number, id: string, year: number): CorpusMember => {
    const memberId = uuid(n + 4);
    return {
      ...template,
      memberId,
      exportId: exportIdOf(memberId),
      title: `Synthetic ${n}`,
      retrieval: 'retrieved',
      stratum: { year },
      identifiers: { ...template.identifiers, paperIds: [id] },
      inputs: {
        textHashes: [],
        metadataDigest: 'sha256:0',
        insightRunIds: [],
        stanceRunIds: [],
        segmenterVersion: 'x',
        sentenceKeyVersion: 'x',
      },
    };
  };
  const corpus: Corpus = { ...base, members: [member(1, a, 2019), member(2, b, 2021), member(3, c, 2022)] };

  const completeJson = vi.fn(async (request: Parameters<LlmClient['completeJson']>[0]) => {
    await request.onRequest?.();
    const outputs: Record<string, unknown> = {
      scg_contributions: {
        contributions: [
          {
            name: 'Gamma tagger',
            description: 'A tagger.',
            types: [{ type: 'techniques_algorithms', explanation: '' }],
            sections: ['Method'],
            evidence: [{ sentenceKey: keyC, quote: 'the Gamma tagger' }],
          },
        ],
      },
      scg_prerequisites: { prerequisites: [] },
    };
    return {
      data: request.schema.parse(outputs[request.schemaName]),
      meta: { model: 'm', promptVersion: request.promptVersion, latencyMs: 1, repaired: false },
    };
  });
  render(
    <MemoryRouter initialEntries={['/corpus/x']}>
      <StorageProvider repositories={repo}>
        <LlmProvider innerClient={{ completeJson } as unknown as LlmClient}>
          <Routes>
            <Route path="/corpus/x" element={<CorpusScgRoadmap corpus={corpus} />} />
            <Route path="/papers/:id" element={<Where />} />
          </Routes>
        </LlmProvider>
      </StorageProvider>
    </MemoryRouter>,
  );

  expect(
    await screen.findByText(/2\/3 bài có kết quả trích contribution · 2 contribution · 1 liên kết/u),
  ).toBeInTheDocument();
  const top = screen.getByRole('list', { name: 'Được xây dựa trên nhiều nhất' });
  expect(within(top).getAllByRole('listitem')).toHaveLength(1);
  expect(top).toHaveTextContent('Alpha corpus · Synthetic 1 (2019)');
  expect(top).toHaveTextContent('điểm 2 · 1 cốt lõi, 0 phụ · 1 bài');

  // Selecting it shows what builds on it, with the evidence link into the citing paper.
  fireEvent.click(within(top).getByRole('button', { name: /Alpha corpus/u }));
  expect(
    screen.getByRole('img', { name: /Đồ thị chuỗi của Alpha corpus: 2 nút, 1 liên kết/u }),
  ).toBeInTheDocument();
  expect(screen.queryByRole('list', { name: 'Alpha corpus dựa trên' })).toBeNull();
  const builtOnBy = screen.getByRole('list', { name: 'Dựa vào Alpha corpus' });
  expect(builtOnBy).toHaveTextContent('Beta parser');
  expect(builtOnBy).toHaveTextContent('cốt lõi');
  expect(builtOnBy).toHaveTextContent('Ứng viên');
  expect(builtOnBy).toHaveTextContent('Beta is trained on Alpha.');

  // Its chain from the other side lists Alpha as what it builds on.
  fireEvent.click(within(builtOnBy).getByRole('button', { name: /Beta parser/u }));
  const builtOn = screen.getByRole('list', { name: 'Beta parser dựa trên' });
  expect(builtOn).toHaveTextContent('Alpha corpus');

  // Only accepted items: the candidate link and Beta drop out, so the selection clears.
  fireEvent.click(screen.getByRole('checkbox', { name: 'Chỉ mục đã chấp nhận' }));
  expect(screen.getByText(/1 contribution · 0 liên kết/u)).toBeInTheDocument();
  expect(screen.queryByRole('list', { name: 'Beta parser dựa trên' })).toBeNull();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Chỉ mục đã chấp nhận' }));

  // The type filter narrows the list to datasets, then to nothing for models.
  chooseSelectOption('Loại contribution', 'resource_dataset (1)');
  expect(screen.getByRole('list', { name: 'Được xây dựa trên nhiều nhất' })).toHaveTextContent(
    'Alpha corpus',
  );
  chooseSelectOption('Loại contribution', 'models_or_architectures (1)');
  expect(screen.getByText('Chưa có contribution nào được contribution khác dựa vào.')).toBeInTheDocument();
  chooseSelectOption('Loại contribution', 'Mọi loại');

  // Backfill runs the pass for the one member with a model and no run.
  fireEvent.click(screen.getByRole('button', { name: 'Trích contribution cho 1 bài còn thiếu' }));
  expect(await screen.findByText('Đã trích contribution cho 1/1 bài.')).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.getByText(/3\/3 bài có kết quả trích contribution · 3 contribution/u)).toBeInTheDocument(),
  );
  expect(screen.queryByRole('button', { name: /bài còn thiếu/u })).toBeNull();
  expect((await repo.scg.get(c))?.contributions[0]?.name).toBe('Gamma tagger');
  expect(completeJson).toHaveBeenCalledTimes(2);

  // "Xem trong bài" opens the citing paper at the evidence sentence.
  fireEvent.click(
    within(screen.getByRole('list', { name: 'Được xây dựa trên nhiều nhất' })).getByRole('button'),
  );
  fireEvent.click(
    within(screen.getByRole('list', { name: 'Dựa vào Alpha corpus' })).getByRole('button', {
      name: 'Xem trong bài',
    }),
  );
  const sentence = sentenceIndex(papers[1]!)[0]!;
  expect(await screen.findByTestId('where')).toHaveTextContent(
    `/papers/${b}?p=p&s=${sentence.start}&e=${sentence.end}`,
  );
});
