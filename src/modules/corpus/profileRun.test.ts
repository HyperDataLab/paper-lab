import { describe, expect, it, vi } from 'vitest';
import { exampleProfileInputs } from '@/core/corpusProfile/contract';
import { bodySentences } from '@/core/corpusProfile/measure';
import { profileEligible } from '@/core/corpusProfile/profile';
import type { ParseResult } from '@/core/syntaxParse';
import type { NlpClient } from '@/shared/nlp';
import { examplePaper, exampleInsights } from '@/core/paperModel/contract';
import type { Argument, PaperInsightsRecord } from '@/core/schemas/paperInsights';
import { corpusEvidenceLevels, parseProfileSyntax } from './profileRun';

const result = (items: { key: string }[]): ParseResult => ({
  model: 'fake_model',
  modelVersion: '1',
  spacyVersion: '0',
  version: 'fake-1',
  sentences: items.map(({ key }) => ({
    key,
    tokens: [],
    root: null,
    voice: 'passive',
    tense: 'past',
    modal: null,
  })),
});

describe('P7 corpus evidence levels', () => {
  it('P7 counts graded main claims of live arguments only', () => {
    const { target, papers } = exampleProfileInputs();
    const member = target.members.find(profileEligible);
    const paper = member && papers.get(member.memberId);
    if (!member || !paper) throw new Error('missing paper');
    const base = exampleInsights(examplePaper());
    const run = '00000000-0000-4000-8000-0000000000e1';
    const span = { paragraphId: 'p1', sectionId: 's1', page: 1, start: 0, end: 3, excerpt: 'Toy' };
    const argument = (id: string, extra: Partial<Argument>): Argument => ({
      id,
      importance: 'main',
      claim: span,
      claimType: 'comparative',
      data: [],
      statedWarrant: null,
      inferredWarrant: null,
      backing: [],
      qualifier: null,
      rebuttals: [],
      ...extra,
    });
    const insights: PaperInsightsRecord = {
      ...base,
      argumentRuns: [
        {
          id: run,
          createdAt: '2026-01-01T00:00:00.000Z',
          model: 'example-model',
          promptVersion: 'example-arguments-1',
          callsUsed: 1,
          sectionIds: ['s1'],
          failedSectionIds: [],
          discarded: { claim_not_found: 0, element_not_found: 0, duplicate: 0 },
          arguments: [
            argument('live', { importance: 'main', evidenceLevel: 'E3' }),
            argument('dismissed', { importance: 'main', evidenceLevel: 'E1' }),
            argument('supporting', { importance: 'supporting', evidenceLevel: 'E2' }),
          ],
        },
      ],
      decisions: [{ run_id: run, item_id: 'dismissed', decision: 'dismiss', at: '2026-01-01T00:00:00.000Z' }],
    };
    const only = new Map([[member.memberId, { ...paper, insights }]]);
    const result = corpusEvidenceLevels(target, only);
    expect(result).toMatchObject({ counted: 1, missing: 0, papers: 1, papersWithLevel: 1 });
    expect(result.shares.E3).toBe(1);
  });
});

describe('P6 profile syntax parsing', () => {
  it('P6 parses each profiled paper once with unique keys and reports progress', async () => {
    const { target, control, papers } = exampleProfileInputs();
    const parse = vi.fn<NlpClient['parse']>(async (items) => {
      expect(new Set(items.map((item) => item.key)).size).toBe(items.length);
      return result(items);
    });
    const progress = vi.fn();
    const syntax = await parseProfileSyntax([target, control], papers, { parse }, undefined, progress);
    const profiled = [...target.members, ...control.members].filter(profileEligible);
    expect(parse).toHaveBeenCalledTimes(profiled.length);
    expect(syntax.papers.size).toBe(profiled.length);
    expect(syntax.parser).toBe('fake-1+spacy-0 fake_model-1');
    expect(syntax.error).toBeUndefined();
    expect(progress).toHaveBeenLastCalledWith({ done: profiled.length, total: profiled.length });
    const first = profiled[0];
    const paper = first && papers.get(first.memberId);
    if (!first || !paper) throw new Error('missing paper');
    const keys = new Set(bodySentences(paper.model).map((s) => s.key));
    expect([...(syntax.papers.get(first.memberId)?.keys() ?? [])].sort()).toEqual([...keys].sort());
  });

  it('P6 stops at the first failure and leaves the rest unparsed; an abort is rethrown', async () => {
    const { target, control, papers } = exampleProfileInputs();
    let calls = 0;
    const failing: NlpClient = {
      parse: async (items) => {
        calls += 1;
        if (calls === 2) throw new Error('Phân tích cú pháp thất bại (502)');
        return result(items);
      },
    };
    const syntax = await parseProfileSyntax([target, control], papers, failing);
    expect(calls).toBe(2);
    expect(syntax.papers.size).toBe(1);
    expect(syntax.error).toBe('Phân tích cú pháp thất bại (502)');

    const controller = new AbortController();
    const aborting: NlpClient = {
      parse: async () => {
        controller.abort(new DOMException('stop', 'AbortError'));
        throw new DOMException('stop', 'AbortError');
      },
    };
    await expect(parseProfileSyntax([target, control], papers, aborting, controller.signal)).rejects.toThrow(
      'stop',
    );
  });
});
