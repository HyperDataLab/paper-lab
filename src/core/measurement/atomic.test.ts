import { expect, it } from 'vitest';
import { buildExtractionPrompt } from '../prompts/measurement';
import { PROMPT_VERSIONS } from '../prompts';
import {
  ExtractionOutputSchema,
  MeasurementCheckpointSchema,
  MeasurementProfileSchema,
  PROTOCOL_FIELDS,
  type ExtractionOutput,
  type MeasurementDecision,
  type ModelField,
  type QuoteRef,
} from '../schemas/measurement';
import { buildProfile } from './build';
import { atomicCsv, measurementMarkdown } from './export';
import { reviewedProfile } from './review';
import { DEFINITION, fixturePaper, fixtureProfile } from './testFixture';
import { buildMeasurementTree, flattenMeasurementTree } from './tree';
import { atomicNumbers } from './verify';

const q = (
  blockId: string,
  quote: string,
  row: number | null = null,
  column: number | null = null,
): QuoteRef => ({
  blockId,
  quote,
  row,
  column,
});
const atom = (
  key: string,
  text: string,
  quote = q('m1', DEFINITION),
  role: 'method' | 'finding' = 'method',
) => ({
  key,
  text,
  role,
  quote,
});
const empty: ExtractionOutput = {
  atomic_sentences: [],
  constructs: [],
  metrics: [],
  experiments: [],
  results: [],
  claims: [],
  taxonomy: [],
  review_method: null,
};
const blocks = fixturePaper.paragraphs;
const build = (...outputs: ExtractionOutput[]) =>
  buildProfile({
    paper: fixturePaper,
    selectedSectionIds: ['met', 'res'],
    classification: { paper_type: 'EMPIRICAL', rationale: '', quotes: [] },
    units: outputs.map((output, index) => ({
      unit: { id: `u${index}`, sectionIds: ['met', 'res'], blocks },
      output,
    })),
    model: 'm',
    promptVersion: 'v',
    generatedAt: '2026-01-02T00:00:00.000Z',
  });
const none: ModelField = { value: null, status: 'NOT_REPORTED', quotes: [] };
const words = (n: number) => Array.from({ length: n }, () => 'word').join(' ');

it('AS-01 discards a sentence over 25 words and keeps one of exactly 25', () => {
  const profile = build({ ...empty, atomic_sentences: [atom('a', words(26)), atom('b', words(25))] });
  expect(profile.atomic_sentences.map((item) => item.word_count)).toEqual([25]);
  expect(profile.discarded.atomic_too_long).toBe(1);
  expect(build({ ...empty, atomic_sentences: [atom('a', '   ')] }).discarded.atomic_too_long).toBe(1);
});

it('AS-02 discards a sentence whose quote is not in the paper', () => {
  const profile = build({
    ...empty,
    atomic_sentences: [
      atom('a', 'Accuracy measures correct predictions.', q('m1', 'not in this paragraph at all')),
    ],
  });
  expect(profile.atomic_sentences).toEqual([]);
  expect(profile.discarded.atomic_quote_not_found).toBe(1);
});

it('AS-03 reads quantities but not names or citation markers', () => {
  expect(atomicNumbers('GPT-4 and F1 reached 0.9 in 12 runs [12], [3, 4].')).toEqual(['0.9', '12']);
  expect(atomicNumbers('Loss fell by -1.5 from 2,000.')).toEqual(['-1.5', '2,000']);
});

it('AS-03 discards a number absent from the source, and accepts one in the table row', () => {
  const cell = q('t1', '0.123 ± 0.004', 1, 1);
  const profile = build({
    ...empty,
    atomic_sentences: [
      atom('bad', 'Baseline accuracy was 0.12 on the test set.', cell, 'finding'),
      atom('good', 'Baseline accuracy was 0.123 with uncertainty 0.004 on the test set.', cell, 'finding'),
      atom('other', 'Accuracy uses 50 predictions from the test set.'),
    ],
  });
  expect(profile.atomic_sentences.map((item) => item.text)).toEqual([
    'Baseline accuracy was 0.123 with uncertainty 0.004 on the test set.',
  ]);
  expect(profile.discarded.atomic_number_not_in_source).toBe(2);
  expect(profile.atomic_sentences[0]).toMatchObject({ page: 3, section_id: 'res', role: 'finding' });
});

it('AS-04 collapses identical sentences', () => {
  const profile = build({
    ...empty,
    atomic_sentences: [
      atom('a', 'Accuracy is the share correct.'),
      atom('b', 'accuracy  is the share correct.'),
    ],
    claims: [{ key: 'c', text: 'x', quote: q('r1', 'robust under client dropout'), atom_keys: ['a', 'b'] }],
  });
  expect(profile.atomic_sentences).toHaveLength(1);
  expect(profile.claims[0]?.atomic_ids).toEqual(['as-0001']);
});

it('AS-05 scopes keys to their part and drops discarded or unknown keys', () => {
  const claim = (atom_keys: string[]) => ({
    key: 'c',
    text: 'x',
    quote: q('r1', 'robust under client dropout'),
    atom_keys,
  });
  const profile = build(
    { ...empty, atomic_sentences: [atom('a', 'Accuracy is the share correct.')] },
    { ...empty, atomic_sentences: [atom('long', words(30))], claims: [claim(['a', 'long', 'ghost'])] },
  );
  expect(profile.claims[0]?.atomic_ids).toBeUndefined();
});

it('AS-05 links atoms to metrics, results and merged fields', () => {
  const field: ModelField = {
    value: DEFINITION,
    status: 'REPORTED',
    quotes: [q('m1', DEFINITION)],
    atom_keys: ['a'],
  };
  const metric = {
    key: 'm',
    reported_name: 'Accuracy',
    aliases: [],
    construct_keys: [],
    experiment_keys: [],
    definition: field,
    formula: none,
    unit: none,
    direction: none,
    range: { ...none, atom_keys: ['a'] },
    method: { input_data: none, procedure: none, data_source: none, aggregation: none },
  };
  const part = (text: string): ExtractionOutput => ({
    ...empty,
    atomic_sentences: [atom('a', text)],
    metrics: [metric],
    results: [
      {
        key: 'r',
        experiment_key: null,
        metric_key: 'm',
        system_or_baseline: 'Baseline',
        value: '0.123',
        unit: null,
        uncertainty: null,
        condition: null,
        quote: q('t1', '0.123 ± 0.004', 1, 1),
        atom_keys: ['a'],
      },
    ],
  });
  const profile = build(part('Accuracy is the share correct.'), part('Accuracy counts correct predictions.'));
  expect(profile.metrics[0]?.definition.atomic_ids).toEqual(['as-0001', 'as-0002']);
  expect(profile.metrics[0]?.range.atomic_ids).toBeUndefined();
  expect(profile.results[0]?.atomic_ids).toEqual(['as-0001']);
});

it('AS-06 keeps a field reported when its atomic sentence is discarded', () => {
  const profile = build({
    ...empty,
    atomic_sentences: [atom('a', words(40))],
    experiments: [
      {
        key: 'e',
        name: 'Main',
        protocol: {
          ...(Object.fromEntries(
            PROTOCOL_FIELDS.map((key) => [key, none]),
          ) as ExtractionOutput['experiments'][number]['protocol']),
          data: { value: 'Test set', status: 'REPORTED', quotes: [q('m1', DEFINITION)], atom_keys: ['a'] },
        },
      },
    ],
  });
  expect(profile.experiments[0]?.protocol.data).toMatchObject({ status: 'REPORTED', value: 'Test set' });
});

const RUN = '00000000-0000-4000-8000-0000000000aa';
const decide = (decision: MeasurementDecision['decision'], item_id: string): MeasurementDecision => ({
  run_id: RUN,
  item_id,
  field: null,
  decision,
  reviewer: 'local',
  timestamp: '2026-01-03T00:00:00.000Z',
  previous_value: null,
  new_value: null,
  note: null,
});
const withAtom = () => {
  const profile = fixtureProfile();
  profile.atomic_sentences = [
    {
      id: 'as-0001',
      text: 'Accuracy is the share correct.',
      role: 'method',
      word_count: 5,
      evidence_id: profile.evidence[0]?.id ?? '',
      page: 3,
      section_id: 'met',
      needs_review: true,
      human_checked: false,
    },
  ];
  profile.claims[0]!.atomic_ids = ['as-0001'];
  profile.metrics[0]!.definition.atomic_ids = ['as-0001'];
  return profile;
};

it('AS-07 records a human check and leaves the AI original untouched', () => {
  const original = withAtom();
  const snapshot = structuredClone(original);
  const reviewed = reviewedProfile(original, [decide('accept', 'as-0001')], RUN);
  expect(reviewed.atomic_sentences[0]).toMatchObject({ human_checked: true, needs_review: false });
  expect(original).toEqual(snapshot);
});

it('AS-07 removes a rejected sentence and every link to it', () => {
  const reviewed = reviewedProfile(withAtom(), [decide('reject', 'as-0001')], RUN);
  expect(reviewed.atomic_sentences).toEqual([]);
  expect(reviewed.claims[0]?.atomic_ids).toEqual([]);
  expect(reviewed.metrics[0]?.definition.atomic_ids).toEqual([]);
  expect(atomicCsv(reviewed).split('\r\n')).toHaveLength(1);
});

it('AS-07 drops atom links when a human edit is no longer supported by the source', () => {
  const edit: MeasurementDecision = {
    ...decide('edit', 'mu-1'),
    field: 'definition',
    new_value: 'Một định nghĩa khác',
  };
  const reviewed = reviewedProfile(withAtom(), [edit], RUN);
  expect(reviewed.metrics[0]?.definition).toMatchObject({ status: 'HUMAN_EDITED', atomic_ids: [] });
});

it('AS-08 still parses profiles and checkpoints from before atomic sentences', () => {
  const old = JSON.parse(JSON.stringify(fixtureProfile())) as Record<string, unknown>;
  delete old.atomic_sentences;
  const discarded = old.discarded as Record<string, unknown>;
  delete discarded.atomic_too_long;
  const parsed = MeasurementProfileSchema.parse(old);
  expect(parsed.atomic_sentences).toEqual([]);
  expect(parsed.discarded.atomic_too_long).toBe(0);
  const { atomic_sentences: _unused, ...oldOutput } = empty;
  void _unused;
  expect(ExtractionOutputSchema.safeParse(oldOutput).success).toBe(true);
  expect(
    MeasurementCheckpointSchema.safeParse({
      classification: null,
      units: { u: oldOutput },
      link: null,
      findings: null,
      model: null,
    }).success,
  ).toBe(true);
});

it('AS-09 groups sentences by role in the tree with unique ids', () => {
  const profile = withAtom();
  const flat = flattenMeasurementTree(buildMeasurementTree(profile));
  expect(flat.find((node) => node.id === 'atomics')?.count).toBe(1);
  expect(flat.find((node) => node.id === 'atomics/method')?.label).toBe('Phương pháp');
  expect(flat.find((node) => node.id === 'atomics/method/a:as-0001')?.flagged).toBe(true);
  expect(new Set(flat.map((node) => node.id)).size).toBe(flat.length);
  expect(flattenMeasurementTree(buildMeasurementTree(fixtureProfile())).some((n) => n.id === 'atomics')).toBe(
    false,
  );
});

it('AS-11 states the limits in the prompt and bumps the version', () => {
  const { system } = buildExtractionPrompt(
    fixturePaper,
    { id: 'u', sectionIds: ['met'], blocks: blocks.slice(0, 1) },
    'EMPIRICAL',
  );
  expect(system).toContain('at most 25 words');
  expect(system).toContain('atom_keys');
  expect(PROMPT_VERSIONS.measurementExtract).toBe('measure-extract-2');
});

it('AS-12 exports sentences to CSV and Markdown', () => {
  const profile = withAtom();
  const csv = atomicCsv(profile).split('\r\n');
  expect(csv[0]).toContain('human_checked');
  expect(csv[1]).toContain('Accuracy is the share correct.');
  expect(csv[1]).toContain('no,yes');
  const text = measurementMarkdown(profile);
  expect(text).toContain('## Câu nguyên tử');
  expect(text).toContain('### Phương pháp');
  expect(text).toContain('chưa đối chiếu, cần xem lại');
  const done = measurementMarkdown(reviewedProfile(profile, [decide('accept', 'as-0001')], RUN));
  expect(done).toContain('tr. 3, đã đối chiếu');
  expect(measurementMarkdown(fixtureProfile())).not.toContain('Câu nguyên tử');
});
