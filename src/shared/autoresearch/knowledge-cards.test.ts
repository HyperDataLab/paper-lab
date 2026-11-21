import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { at, outputs } from '@/core/autoresearch/fixtures';
import { emptyStage } from '@/core/autoresearch/record';
import { passStage } from '@/core/autoresearch/validation';
import { newProject } from '@/core/extraction';
import { buildPaperModel } from '@/core/paperModel';
import type { Paper } from '@/core/schemas';
import { testRepositories } from '@/shared/storage/testRepositories';
import { cardInputs, loadProjectFullTexts } from './card-sources';
import { extractCards } from './knowledge-cards';

beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());

const doi = '10.1000/model';
const local: Paper = {
  schemaVersion: 1,
  id: '00000000-0000-4000-8000-000000000001',
  title: 'Synthetic imported study',
  createdAt: at,
  updatedAt: at,
  source: { kind: 'text', fileName: 'synthetic', pageCount: 2, sha256: 'fixture' },
  sections: [
    { id: 'abstract', heading: 'Abstract', role: 'abstract', level: 1, pageStart: 1 },
    { id: 'methods', heading: 'Methods', role: 'methods', level: 1, pageStart: 2 },
  ],
  paragraphs: [
    {
      id: 'pa',
      sectionId: 'abstract',
      order: 0,
      kind: 'body',
      pageStart: 1,
      textHash: 'a',
      text: 'The study compared reviewers. DOI: 10.1000/model',
    },
    {
      id: 'pm',
      sectionId: 'methods',
      order: 1,
      kind: 'body',
      pageStart: 2,
      textHash: 'b',
      text: 'We compared 12 reviewers.',
    },
  ],
};

it('S6 uses DOI-matched PaperLab sections and resolves sentence keys while using Abstract for other works', async () => {
  {
    const repo = testRepositories();
    await repo.papers.create(local);
    const project = newProject({ id: 'project', title: 'Synthetic', researchQuestion: 'Q?', now: at });
    const fullTexts = (dois: string[]) => loadProjectFullTexts(repo, project, dois);
    const prior = structuredClone(outputs);
    const [candidate] = prior.S4.candidates;
    const [decision] = prior.S5.decisions;
    const [card] = prior.S6.cards;
    if (!candidate || !decision || !card) throw new Error('Missing fixture');
    prior.S4.candidates.push({ ...candidate, id: doi, doi, abstract: null });
    prior.S5.decisions.push({ ...decision, id: 'screen:local', paperId: doi });
    const inputs = await cardInputs(prior.S4.candidates, prior.S5.decisions, fullTexts);
    const model = buildPaperModel({ paper: local, metadata: null, now: new Date(at) });
    const key = model.sentences.find((sentence) => sentence.sectionId === 'methods')?.key ?? '';
    expect(inputs).toMatchObject([
      { decisionId: decision.id, evidence_scope: 'abstract', abstract: candidate.abstract },
      {
        decisionId: 'screen:local',
        evidence_scope: 'full_text',
        paperId: local.id,
        sections: expect.arrayContaining([
          expect.objectContaining({
            title: 'Methods',
            sentences: [{ key, page: 2, text: 'We compared 12 reviewers.' }],
          }),
        ]),
      },
    ]);
    const fullCard = {
      ...card,
      id: 'card-local',
      decisionId: 'screen:local',
      evidence_scope: 'full_text' as const,
    };
    const abstractCard = { ...card, quote_anchors: [] };
    const state = emptyStage('S6', 1);
    const checkpoint = vi.fn(async () => {});
    const result = await extractCards(inputs, prior, state, checkpoint, async (batch) => ({
      cards:
        batch[0]?.evidence_scope === 'full_text' ? [{ ...fullCard, quote_anchors: [key] }] : [abstractCard],
    }));
    expect(result?.cards[1]).toMatchObject({
      quote_anchors: [key],
      full_text_source: {
        paperId: local.id,
        sentences: [{ key, section: 'Methods', page: 2, text: 'We compared 12 reviewers.' }],
      },
    });
    if (!result) throw new Error('Missing extraction');
    expect(passStage('S6', result, prior)).toBeNull();
    expect(checkpoint).toHaveBeenCalledTimes(2);
    const invented = { ...fullCard, quote_anchors: ['0000000000000000#1'] };
    const fullOnly = inputs.filter((input) => input.evidence_scope === 'full_text');
    expect(
      await extractCards(fullOnly, prior, state, checkpoint, async () => ({ cards: [invented] })),
    ).toBeNull();
    expect(
      await extractCards(fullOnly, prior, state, checkpoint, async () => ({
        cards: [{ ...fullCard, method: 'Compared 99 reviewers', quote_anchors: [key] }],
      })),
    ).toBeNull();
    const ask = vi.fn(async () => ({ cards: [abstractCard] }));
    expect(
      await extractCards(
        inputs,
        prior,
        { ...state, cardInputHash: `sha256:${'a'.repeat(64)}` },
        checkpoint,
        ask,
      ),
    ).toBeNull();
    expect(ask).not.toHaveBeenCalled();
  }
});
