import { describe, expect, it } from 'vitest';
import { bodySentences } from '../corpusProfile/measure';
import { FEATURE_REGISTRY, SECTION_MAP, SIGNATURE_SECTIONS } from '../corpusProfile/registry';
import { examplePaperModel } from '../paperModel/contract';
import { analyzeText } from '../text';
import { sentenceSyntaxFromParse } from './align';
import type { ParsedSentence } from './schema';
import { SECTION_SYNTAX_FEATURE_IDS, measureSectionSyntax, sectionSyntaxFeatures } from './sectionMeasures';

type Row = [text: string, start: number, pos: string, tag: string, dep: string, head: number];
function parsed(key: string, rows: Row[], voice: ParsedSentence['voice'] = 'active'): ParsedSentence {
  return {
    key,
    tokens: rows.map(([text, start, pos, tag, dep, head], i) => ({
      i,
      text,
      start,
      end: start + [...text].length,
      lemma: text.toLowerCase(),
      pos,
      tag,
      dep,
      head,
      morph: '',
    })),
    root: rows.findIndex((row) => row[4] === 'ROOT'),
    voice,
    tense: 'past',
    modal: null,
  };
}

describe('P6 spaCy parse → SentenceSyntax', () => {
  it('re-aligns spaCy tokens to S2 tokens and keeps the subject out of a question verb group', async () => {
    const text = await analyzeText('Results improved. Were the samples analysed?');
    const [first, second] = text.sentences;
    if (!first || !second) throw new Error('two sentences expected');
    const index = (word: string) => text.tokens.find((t) => t.text === word)?.index as number;
    const a = sentenceSyntaxFromParse(
      parsed('s1', [
        ['Results', 0, 'NOUN', 'NNS', 'nsubj', 1],
        ['improved', 8, 'VERB', 'VBD', 'ROOT', 1],
        ['.', 16, 'PUNCT', '.', 'punct', 1],
      ]),
      first,
      text,
    );
    expect(a).toMatchObject({
      sentenceId: 's1',
      subject: { start: index('Results'), end: index('Results') + 1 },
      mainVerb: { start: index('improved'), end: index('improved') + 1 },
      mainVerbHead: index('improved'),
      voice: 'active',
      clauseCount: 1,
      maxClauseDepth: 0,
      topic: null,
      unresolved: [],
    });
    const b = sentenceSyntaxFromParse(
      parsed(
        's2',
        [
          ['Were', 0, 'AUX', 'VBD', 'auxpass', 3],
          ['the', 5, 'DET', 'DT', 'det', 2],
          ['samples', 9, 'NOUN', 'NNS', 'nsubjpass', 3],
          ['analysed', 17, 'VERB', 'VBN', 'ROOT', 3],
          ['?', 25, 'PUNCT', '.', 'punct', 3],
        ],
        'passive',
      ),
      second,
      text,
    );
    expect(b.subject).toEqual({ start: index('the'), end: index('samples') + 1 });
    expect(b.subjectHead).toBe(index('samples'));
    expect(b.mainVerb).toEqual({ start: index('analysed'), end: index('analysed') + 1 });
    expect(b.voice).toBe('passive');
  });

  it('counts finite clauses and their nesting; a missing parse is unresolved', async () => {
    const text = await analyzeText('We found that rates rose.');
    const sentence = text.sentences[0];
    if (!sentence) throw new Error('sentence expected');
    const result = sentenceSyntaxFromParse(
      parsed('s1', [
        ['We', 0, 'PRON', 'PRP', 'nsubj', 1],
        ['found', 3, 'VERB', 'VBD', 'ROOT', 1],
        ['that', 9, 'SCONJ', 'IN', 'mark', 4],
        ['rates', 14, 'NOUN', 'NNS', 'nsubj', 4],
        ['rose', 20, 'VERB', 'VBD', 'ccomp', 1],
        ['.', 24, 'PUNCT', '.', 'punct', 1],
      ]),
      sentence,
      text,
    );
    expect([result.clauseCount, result.maxClauseDepth]).toEqual([2, 1]);
    expect(sentenceSyntaxFromParse(undefined, sentence, text).unresolved).toEqual(['no parse']);
  });
});

describe('P6 per-section passive share and tense split', () => {
  it('reserves feature ids; once the registry has any of them, it has exactly these', () => {
    expect(SECTION_SYNTAX_FEATURE_IDS).toHaveLength(SIGNATURE_SECTIONS.length * 4);
    expect(SECTION_SYNTAX_FEATURE_IDS).toContain('section.METHODS.passive');
    expect(SECTION_SYNTAX_FEATURE_IDS).toContain('section.RESULTS.tense.past');
    const registered = FEATURE_REGISTRY.features
      .map((feature) => feature.id)
      .filter((id) => /^section\.[A-Z_]+\.(passive|tense\.[a-z]+)$/u.test(id));
    if (registered.length) expect(registered.sort()).toEqual([...SECTION_SYNTAX_FEATURE_IDS].sort());
  });

  it('computes shares over parsed body sentences, leaving out verbless and modal ones', () => {
    const model = examplePaperModel();
    const roles = new Map(model.document.sections.map((s) => [s.id, SECTION_MAP[s.role]]));
    const section = 'ABSTRACT';
    const template = bodySentences(model).find((sentence) => roles.get(sentence.sectionId) === section);
    if (!template) throw new Error('example needs an abstract sentence');
    // Four abstract sentences in all, one per case below.
    for (const n of [1, 2, 3, 4]) model.sentences.push({ ...template, key: `${'f'.repeat(15)}${n}#1` });
    const own = bodySentences(model).filter((sentence) => roles.get(sentence.sectionId) === section);
    expect(own.length).toBeGreaterThanOrEqual(4);
    const values: Pick<ParsedSentence, 'voice' | 'tense'>[] = [
      { voice: 'passive', tense: 'past' },
      { voice: 'active', tense: 'present' },
      { voice: null, tense: 'none' },
      { voice: 'passive', tense: 'none' },
    ];
    const parsedMap = new Map(
      own.slice(0, values.length).map((s, i) => [s.key, values[i] as (typeof values)[0]]),
    );
    const measures = measureSectionSyntax(model, parsedMap);
    expect(measures[section]).toEqual({
      sentences: own.length,
      parsed: 4,
      voiced: 3,
      tensed: 2,
      passiveShare: 2 / 3,
      tenseShares: { past: 0.5, present: 0.5, future: 0 },
    });
    const features = sectionSyntaxFeatures(measures);
    expect(Object.keys(features).sort()).toEqual([...SECTION_SYNTAX_FEATURE_IDS].sort());
    expect(features[`section.${section}.passive`]).toBe(measures[section].passiveShare);
    const other = SIGNATURE_SECTIONS.find((s) => s !== section) as (typeof SIGNATURE_SECTIONS)[number];
    expect(measures[other]).toMatchObject({ parsed: 0, passiveShare: null, tenseShares: null });
    expect(features[`section.${other}.tense.past`]).toBeNull();
  });
});
