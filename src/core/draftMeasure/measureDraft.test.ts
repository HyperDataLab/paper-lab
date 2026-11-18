import { describe, expect, it } from 'vitest';
import { measurePaperV2Detail } from '../corpusProfile/measureV2';
import { FEATURE_REGISTRY_V2, registryV2Digest } from '../corpusProfile/registryV2';
import { buildPaperModel } from '../paperModel/buildPaperModel';
import type { Paper } from '../schemas';
import { draftSentences, measureDraft, prepareDraft } from './measureDraft';
import { DraftMeasureSchema } from './schema';

// Synthetic text only.
const MARKDOWN = [
  '# A toy study of synthetic widgets',
  '',
  '## 1. Introduction',
  '',
  'Widgets may matter for toy tasks. We study them here.',
  '',
  'Prior toy work clearly ignored widgets.',
  '',
  '## 2. Methods',
  '',
  'The widgets were measured twice. We counted every widget.',
  '',
  '## 3. Results and discussion',
  '',
  'The widgets were larger than expected. This suggests a toy effect.',
  '',
  '## Acknowledgements',
  '',
  'We thank the synthetic lab.',
].join('\n');

const TEXT = [
  'Synthetic draft title line',
  '',
  'INTRODUCTION',
  '',
  'Widgets may matter for toy tasks.',
  '',
  'METHODS',
  '',
  'The widgets were measured twice.',
  '',
  'Our counts were repeated.',
  '',
  'CONCLUSION',
  '',
  'Widgets are toy objects.',
].join('\n');

const feature = (measure: Awaited<ReturnType<typeof measureDraft>>, id: string) =>
  measure.features.find((item) => item.id === id);

describe('measureDraft (Writing Bank B4)', () => {
  it('reads markdown headings into sections with roles, positions and paragraph counts', async () => {
    const measure = DraftMeasureSchema.parse(await measureDraft({ format: 'markdown', text: MARKDOWN }));
    expect(measure.title).toBe('A toy study of synthetic widgets');
    expect(
      measure.sections.map(({ line, heading, title, role, counted, paragraphs }) => ({
        line,
        heading,
        title,
        role,
        counted,
        paragraphs,
      })),
    ).toEqual([
      {
        line: 3,
        heading: '## 1. Introduction',
        title: '1. Introduction',
        role: 'INTRODUCTION',
        counted: true,
        paragraphs: 2,
      },
      {
        line: 9,
        heading: '## 2. Methods',
        title: '2. Methods',
        role: 'METHODS',
        counted: true,
        paragraphs: 1,
      },
      {
        line: 13,
        heading: '## 3. Results and discussion',
        title: '3. Results and discussion',
        role: 'RESULTS',
        counted: true,
        paragraphs: 1,
      },
      {
        line: 17,
        heading: '## Acknowledgements',
        title: 'Acknowledgements',
        role: 'OTHER',
        counted: false,
        paragraphs: 1,
      },
    ]);
    expect(measure.warnings.map((warning) => warning.code)).toEqual([
      'title_heading_lifted',
      'excluded_sections',
    ]);
    expect(feature(measure, 'structure.section_count')).toEqual({
      id: 'structure.section_count',
      value: 3,
      status: 'measured',
    });
    expect(feature(measure, 'structure.results_discussion_combined')?.value).toBe(1);
    expect(feature(measure, 'section.INTRODUCTION.paragraph_count')?.value).toBe(2);
    expect(feature(measure, 'section.METHODS.presence')?.value).toBe(1);
    expect(feature(measure, 'section.ABSTRACT.presence')?.value).toBe(0);
    // One "We" in the 9 words of Methods, per 1000 words.
    expect(feature(measure, 'section.METHODS.first_person')?.value).toBeCloseTo(1000 / 9);
  });

  it('reads plain-text headings with the existing heading detection', async () => {
    const measure = await measureDraft({ format: 'text', text: TEXT, title: 'Given title' });
    expect(measure.title).toBe('Given title');
    expect(
      measure.sections.map(({ line, heading, role, counted, paragraphs }) => [
        line,
        heading,
        role,
        counted,
        paragraphs,
      ]),
    ).toEqual([
      [null, null, 'OTHER', false, 1],
      [3, 'INTRODUCTION', 'INTRODUCTION', true, 1],
      [7, 'METHODS', 'METHODS', true, 2],
      [13, 'CONCLUSION', 'CONCLUSION', true, 1],
    ]);
    expect(measure.warnings.map((warning) => warning.code)).toEqual(['text_before_first_heading']);
    expect(feature(measure, 'section.METHODS.paragraph_length')?.value).toBe(4.5);
  });

  it('leaves only the text above the first heading unmeasured, whatever the heading levels', async () => {
    for (const text of [
      '# Toy title\n\nA. Author, Synthetic Lab\n\n## Introduction\n\nWidgets matter.\n\n## Methods\n\nWe counted widgets.',
      'A. Author, Synthetic Lab\n\n## Introduction\n\nWidgets matter.\n\n## Methods\n\nWe counted widgets.',
    ]) {
      const measure = await measureDraft({ format: 'markdown', text });
      expect(measure.sections.map(({ role, counted, paragraphs }) => [role, counted, paragraphs])).toEqual([
        ['OTHER', false, 1],
        ['INTRODUCTION', true, 1],
        ['METHODS', true, 1],
      ]);
      expect(feature(measure, 'structure.section_count')?.value).toBe(2);
      expect(feature(measure, 'section.METHODS.paragraph_count')?.value).toBe(1);
      expect(measure.warnings.map((warning) => warning.code)).toContain('text_before_first_heading');
    }
  });

  it('keeps a leading "# Methods" as a section, not the title', async () => {
    const measure = await measureDraft({
      format: 'markdown',
      text: '# Methods\n\nWe counted widgets.\n\n## Participants\n\nToy people took part.\n\n## Procedure\n\nWe counted again.',
    });
    expect(measure.title).toBeNull();
    expect(measure.sections.map(({ heading, role, counted }) => [heading, role, counted])).toEqual([
      ['# Methods', 'METHODS', true],
      ['## Participants', 'METHODS', true],
      ['## Procedure', 'METHODS', true],
    ]);
    expect(feature(measure, 'section.METHODS.paragraph_count')?.value).toBe(3);
    expect(feature(measure, 'structure.section_count')?.value).toBe(1);
  });

  it('warns when no heading is found', async () => {
    const measure = await measureDraft({ format: 'text', text: 'just some lower-case prose here.' });
    expect(measure.warnings.map((warning) => warning.code)).toEqual(['no_headings']);
    expect(measure.features.every((item) => item.status === 'unavailable')).toBe(true);
  });

  it('marks LLM and grammar features unavailable with their reasons', async () => {
    const measure = await measureDraft({ format: 'markdown', text: MARKDOWN });
    const registry = new Map(FEATURE_REGISTRY_V2.features.map((item) => [item.id, item]));
    expect(measure.features.map((item) => item.id)).toEqual([...registry.keys()]);
    expect(measure.registryDigest).toBe(await registryV2Digest());
    for (const item of measure.features) {
      const extractor = registry.get(item.id)?.extractor;
      if (extractor === 'llm')
        expect(item).toMatchObject({ status: 'unavailable', reason: 'needs_llm_pass' });
      if (extractor === 'tool')
        expect(item).toMatchObject({ status: 'unavailable', reason: 'grammar_service_unavailable' });
      if (extractor === 'deterministic' && item.status === 'unavailable') expect(item.reason).toBe('no_data');
    }
    expect(feature(measure, 'argument.with_data')).toMatchObject({ reason: 'needs_llm_pass' });
    expect(feature(measure, 'stance.hedges')).toMatchObject({ reason: 'needs_llm_pass' });
    expect(measure.grammar).toEqual({ status: 'not_configured', parser: null, sentences: 7, parsed: 0 });
  });

  it('measures passive voice and tense from a grammar parse', async () => {
    const prepared = await prepareDraft({ format: 'markdown', text: MARKDOWN });
    const sentences = draftSentences(prepared);
    const methods = sentences.filter((sentence) => /measured|counted/u.test(sentence.text));
    const measure = await measureDraft(
      { format: 'markdown', text: MARKDOWN },
      {
        status: 'parsed',
        result: {
          model: 'toy_model',
          modelVersion: '1',
          spacyVersion: '0',
          version: 'toy-1',
          sentences: methods.map((sentence, i) => ({
            key: sentence.key,
            tokens: [],
            root: null,
            voice: i === 0 ? 'passive' : 'active',
            tense: 'past',
            modal: null,
          })),
        },
      },
    );
    expect(feature(measure, 'section.METHODS.passive')?.value).toBe(0.5);
    expect(feature(measure, 'section.METHODS.tense.past')?.value).toBe(1);
    expect(feature(measure, 'section.INTRODUCTION.passive')).toMatchObject({ reason: 'no_data' });
    expect(measure.grammar).toEqual({
      status: 'parsed',
      parser: 'toy-1+spacy-0 toy_model-1',
      sentences: 7,
      parsed: 2,
    });
    expect(measure.warnings.map((warning) => warning.code)).toContain('grammar_partial');
    const failed = await measureDraft({ format: 'markdown', text: MARKDOWN }, { status: 'failed' });
    expect(failed.warnings.map((warning) => warning.code)).toContain('grammar_service_failed');
    expect(feature(failed, 'section.METHODS.passive')).toMatchObject({
      reason: 'grammar_service_unavailable',
    });
  });

  it('gives the values measurePaperV2Detail gives on an equivalent hand-built model', async () => {
    const at = '2026-11-18T00:00:00.000Z';
    const sections = [
      { id: 'a', heading: 'Introduction', role: 'introduction', level: 1, pageStart: null },
      { id: 'b', heading: 'Methods', role: 'methods', level: 1, pageStart: null },
      {
        id: 'c',
        heading: 'Results and discussion',
        role: 'results',
        level: 1,
        pageStart: null,
        combined: ['results', 'discussion'],
      },
      { id: 'd', heading: 'Acknowledgements', role: 'other', level: 1, pageStart: null },
    ] as Paper['sections'];
    const texts: [string, string][] = [
      ['a', 'Widgets may matter for toy tasks. We study them here.'],
      ['a', 'Prior toy work clearly ignored widgets.'],
      ['b', 'The widgets were measured twice. We counted every widget.'],
      ['c', 'The widgets were larger than expected. This suggests a toy effect.'],
      ['d', 'We thank the synthetic lab.'],
    ];
    const paper: Paper = {
      schemaVersion: 1,
      id: '00000000-0000-4000-8000-000000000009',
      title: 'Hand-built',
      createdAt: at,
      updatedAt: at,
      source: { kind: 'markdown', fileName: 'x.md', pageCount: null, sha256: '' },
      sections,
      paragraphs: texts.map(([sectionId, text], order) => ({
        id: `p${order}`,
        sectionId,
        order,
        text,
        pageStart: null,
        kind: 'body',
        textHash: 'x',
      })),
    };
    const expected = measurePaperV2Detail(
      buildPaperModel({ paper, metadata: null, now: new Date(at) }),
    ).values;
    const measure = await measureDraft({ format: 'markdown', text: MARKDOWN });
    let compared = 0;
    for (const item of measure.features) {
      if (item.status === 'measured') {
        expect([item.id, item.value]).toEqual([item.id, expected[item.id]]);
        compared++;
      } else if (item.reason === 'no_data') expect([item.id, expected[item.id]]).toEqual([item.id, null]);
    }
    expect(compared).toBeGreaterThan(20);
  });
});
