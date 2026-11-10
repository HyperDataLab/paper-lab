import { describe, expect, it } from 'vitest';
import type { Analysis, MeasurementsRecord, Paper, PaperChecksRecord, StanceRecord } from '../schemas';
import { fixtureProfile, fixtureRun } from '../measurement/testFixture';
import { PROTOCOL_FIELDS } from '../schemas/measurement';
import { buildPaperProfile, type DimensionId } from './index';

type FieldStatus = 'REPORTED' | 'NOT_REPORTED' | 'NOT_APPLICABLE';

const at = '2026-01-01T00:00:00.000Z';
const paperId = '00000000-0000-4000-8000-000000000001';
const runId = '00000000-0000-4000-8000-000000000002';
const paper: Paper = {
  schemaVersion: 1,
  id: paperId,
  title: 'T',
  createdAt: at,
  updatedAt: at,
  source: { kind: 'pdf', fileName: 'a.pdf', pageCount: 3, sha256: 'x' },
  sections: [
    { id: 'i', heading: 'Intro', role: 'introduction', level: 1, pageStart: 1 },
    { id: 'm', heading: 'Methods', role: 'methods', level: 1, pageStart: 2 },
  ],
  paragraphs: [
    { id: 'p1', sectionId: 'i', order: 0, text: 'One two.', kind: 'body', textHash: 'a', pageStart: 1 },
    { id: 'p2', sectionId: 'm', order: 1, text: 'Three.', kind: 'body', textHash: 'b', pageStart: 2 },
    { id: 'r1', sectionId: 'm', order: 2, text: 'Ref.', kind: 'reference', textHash: 'c', pageStart: 3 },
  ],
};
const field = (status: FieldStatus) => ({ value: null, status, evidence_ids: [], needs_review: false });
function measurementProfile() {
  const base = fixtureProfile();
  const [claim, metric, experiment, finding] = [
    base.claims[0],
    base.metrics[0],
    base.experiments[0],
    base.findings[0],
  ];
  if (!claim || !metric || !experiment || !finding) throw new Error('fixture is incomplete');
  return {
    ...base,
    status: 'partial' as const,
    coverage: { analysed: ['i'], failed: [], not_selected: ['m'] },
    claims: [
      { ...claim, id: 'c1', linked_result_ids: ['x'] },
      { ...claim, id: 'c2', linked_result_ids: [] },
    ],
    metrics: [
      { ...metric, id: 'm1', definition: field('REPORTED') },
      { ...metric, id: 'm2', definition: field('NOT_REPORTED') },
    ],
    experiments: [
      {
        ...experiment,
        protocol: Object.fromEntries(
          PROTOCOL_FIELDS.map((key, index) => [
            key,
            field(index === 0 ? 'REPORTED' : index === 1 ? 'NOT_REPORTED' : 'NOT_APPLICABLE'),
          ]),
        ) as unknown as typeof experiment.protocol,
      },
    ],
    findings: [
      { ...finding, id: 'f1', severity: 'low' as const, explanation: 'low one' },
      { ...finding, id: 'f2', severity: 'high' as const, explanation: 'high one' },
    ],
  };
}
const measurement: MeasurementsRecord = {
  schemaVersion: 1,
  paperId,
  updatedAt: at,
  decisions: [],
  pending: null,
  runs: [{ ...fixtureRun(runId), profile: measurementProfile() }],
};
const checks = {
  schemaVersion: 1,
  paperId,
  decisions: [{ findingId: 'gone', status: 'dismissed_by_human', note: '', at }],
  report: {
    version: 'checks-1',
    generatedAt: at,
    droppedLocations: 0,
    checks: [
      { id: 'citations_references', findings: [{ id: 'keep' }, { id: 'gone' }] },
      { id: 'numbers_consistency', findings: [] },
    ],
  },
} as unknown as PaperChecksRecord;
const analysis = (paragraphId: string, text: string, extra: Partial<Analysis>) =>
  ({
    id: `a-${paragraphId}`,
    updatedAt: at,
    origin: { kind: 'paper', paperId, paragraphId },
    text: {
      sourceText: text,
      tokens: text.split(' ').map((word) => ({ kind: 'word', text: word })),
    },
    issues: [],
    paragraph: null,
    sentenceAnnotations: [],
    ...extra,
  }) as unknown as Analysis;
const stance = {
  schemaVersion: 1,
  paperId,
  updatedAt: at,
  decisions: [],
  pending: null,
  runs: [
    {
      id: runId,
      words: { i: 1000 },
      annotations: [{ id: 'x', category: 'hedges', sectionId: 'i' }],
      discarded: {},
    },
  ],
} as unknown as StanceRecord;
const find = (dimensions: ReturnType<typeof buildPaperProfile>, id: DimensionId) => {
  const dimension = dimensions.find((item) => item.id === id);
  if (!dimension) throw new Error('missing dimension');
  return {
    ...dimension,
    value: (indicator: string) => dimension.indicators.find((item) => item.id === indicator)?.value,
  };
};

describe('D0 paper profile', () => {
  it('summarises arguments once analysed and flags claims without premises', () => {
    const span = { paragraphId: 'p1', sectionId: 'i', page: 1, start: 0, end: 1, excerpt: 'x' };
    const argument = (id: string, data: (typeof span)[], start = 0) => ({
      id,
      importance: 'main',
      claim: { ...span, start, end: start + 1 },
      data,
      statedWarrant: null,
      inferredWarrant: null,
      backing: [],
      qualifier: null,
      rebuttals: [],
    });
    const run = (failed: string[]) => ({
      id: runId,
      createdAt: at,
      model: 'm',
      promptVersion: 'p',
      callsUsed: 1,
      sectionIds: ['i'],
      failedSectionIds: failed,
      arguments: [argument('a', [{ ...span, start: 9, end: 10 }]), argument('b', [], 20)],
      discarded: { claim_not_found: 0, element_not_found: 0, duplicate: 0 },
    });
    const insights = (failed: string[]) =>
      ({
        schemaVersion: 1,
        paperId,
        updatedAt: at,
        rhetoricRuns: [],
        rhetoricPending: null,
        argumentRuns: [run(failed)],
        argumentPending: null,
        decisions: [],
      }) as unknown as Parameters<typeof buildPaperProfile>[0]['insights'];
    const ready = find(buildPaperProfile({ paper, analyses: [], insights: insights([]) }), 'argument');
    expect(ready.state).toBe('ready');
    expect(ready.value('main_claims')).toBe('2');
    expect(ready.value('with_data')).toBe('1/2');
    expect(ready.attention).toContain('1 luận điểm');
    expect(
      find(buildPaperProfile({ paper, analyses: [], insights: insights(['i']) }), 'argument').state,
    ).toBe('partial');
  });
  it('shows validity, availability, moves and abstract support once analysed', () => {
    const span = { sectionId: 'i', page: 1, start: 0, end: 1, excerpt: 'x', rationale: 'r' };
    const item = (id: string, category: string) => ({ ...span, id, paragraphId: 'p1', category });
    const insights = {
      schemaVersion: 1,
      paperId,
      updatedAt: at,
      rhetoricPending: null,
      argumentRuns: [],
      argumentPending: null,
      decisions: [],
      rhetoricRuns: [
        {
          id: runId,
          createdAt: at,
          model: 'm',
          promptVersion: 'p',
          callsUsed: 1,
          sectionIds: [],
          failedSectionIds: [],
          discarded: { not_found: 0, duplicate: 0 },
          items: [item('a', 'threat_external'), item('b', 'data_availability'), item('c', 'niche')],
          abstractChecked: true,
          abstractClaims: [
            { id: 'x', claim: span, support: span, rationale: 'r' },
            { id: 'y', claim: span, support: null, rationale: 'r' },
          ],
        },
      ],
    } as unknown as Parameters<typeof buildPaperProfile>[0]['insights'];
    const profile = buildPaperProfile({ paper, analyses: [], insights });
    expect(find(profile, 'science').value('validity_threats')).toBe('1/4');
    expect(find(profile, 'science').value('availability')).toBe('Có nêu / Chưa thấy');
    expect(find(profile, 'discourse').value('cars_moves')).toBe('1/3');
    expect(find(profile, 'discourse').value('abstract_supported')).toBe('1/2');
    const empty = buildPaperProfile({ paper, analyses: [] });
    expect(find(empty, 'science').value('validity_threats')).toBeNull();
    expect(find(empty, 'discourse').value('abstract_supported')).toBeNull();
  });
  it('puts a retraction first and treats a clean lookup as zero', () => {
    const base = {
      schemaVersion: 1 as const,
      paperId,
      checkedAt: at,
      paperDoi: null,
      checked: 2,
      found: 1,
      retractionChecked: true,
      metadata: null,
    };
    const retracted = find(
      buildPaperProfile({
        paper,
        analyses: [],
        checks,
        scholarly: { ...base, retracted: [{ doi: '10.1/x', title: 'Bad', year: 2020, isPaper: false }] },
      }),
      'context',
    );
    expect(retracted.state).toBe('ready');
    expect(retracted.value('retracted')).toBe('1');
    expect(retracted.attention).toContain('Bad');
    expect(retracted.coverage).toBe('Đã tra 1/2 DOI trên OpenAlex');
    const self = find(
      buildPaperProfile({
        paper,
        analyses: [],
        scholarly: { ...base, retracted: [{ doi: '10.1/x', title: null, year: null, isPaper: true }] },
      }),
      'context',
    );
    expect(self.state).toBe('partial');
    expect(self.attention).toContain('Bài này');
    expect(self.attention).toContain('10.1/x');
    const clean = find(
      buildPaperProfile({ paper, analyses: [], scholarly: { ...base, retracted: [] } }),
      'context',
    );
    expect(clean.value('retracted')).toBe('0');
    expect(clean.attention).toBeNull();
    const metadataOnly = find(
      buildPaperProfile({
        paper,
        analyses: [],
        scholarly: { ...base, retracted: [], retractionChecked: false },
      }),
      'context',
    );
    expect(metadataOnly.value('retracted')).toBeNull();
    expect(metadataOnly.state).toBe('empty');
  });
  it('reports nothing it has not measured', () => {
    const profile = buildPaperProfile({ paper, analyses: [] });
    expect(profile.map((item) => item.letter)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(find(profile, 'science').state).toBe('empty');
    expect(find(profile, 'science').value('claims_linked')).toBeNull();
    expect(find(profile, 'argument').state).toBe('empty');
    expect(find(profile, 'argument').value('main_claims')).toBeNull();
    expect(find(profile, 'writing').value('passive_rate')).toBeNull();
    expect(find(profile, 'context').value('citations_open')).toBeNull();
  });
  it('computes science indicators and surfaces the most severe warning', () => {
    const science = find(buildPaperProfile({ paper, analyses: [], measurement, checks }), 'science');
    expect(science.state).toBe('partial');
    expect(science.coverage).toBe('Đã đọc 1/2 mục');
    expect(science.value('claims_linked')).toBe('1/2');
    expect(science.value('protocol_reported')).toBe('50 %');
    expect(science.value('metrics_defined')).toBe('1/2');
    expect(science.value('numbers_open')).toBe('0');
    expect(science.attention).toBe('high one');
  });
  it('leaves out what a person rejected', () => {
    const reviewed = {
      ...measurement,
      decisions: [
        {
          run_id: runId,
          item_id: 'c2',
          field: null,
          decision: 'reject',
          reviewer: 'local',
          timestamp: at,
          previous_value: null,
          new_value: null,
          note: null,
        },
      ],
    } as MeasurementsRecord;
    expect(
      find(buildPaperProfile({ paper, analyses: [], measurement: reviewed }), 'science').value(
        'claims_linked',
      ),
    ).toBe('1/1');
  });
  it('counts only open findings for citations and explains them', () => {
    const context = find(buildPaperProfile({ paper, analyses: [], checks }), 'context');
    expect(context.value('citations_open')).toBe('1');
    expect(context.value('references')).toBe('1');
    expect(context.value('retracted')).toBeNull();
    expect(context.value('source_format')).toBe('PDF');
    expect(context.attention).toContain('1 phát hiện');
  });
  it('computes discourse and writing only from analysed paragraphs', () => {
    const annotation = (voice: string | null, distance: number | null) => ({
      voice,
      subjectVerbDistanceTokens: distance,
    });
    const issue = (category: string, status = 'candidate', severity = 'minor') => ({
      category,
      status,
      severity,
    });
    const analyses = [
      analysis('p1', 'One two.', {
        paragraph: { type: 'LD' },
        sentenceAnnotations: [annotation('passive', 2), annotation('active', 4), annotation(null, null)],
        issues: [
          issue('flow'),
          issue('word'),
          issue('word', 'dismissed_by_human'),
          issue('structure', 'candidate', 'info'),
        ],
      } as unknown as Partial<Analysis>),
    ];
    const profile = buildPaperProfile({ paper, analyses, stance });
    const discourse = find(profile, 'discourse');
    expect(discourse.state).toBe('partial');
    expect(discourse.value('imrad_roles')).toBe('2/4');
    expect(discourse.value('structure_issues')).toBe('1');
    const writing = find(profile, 'writing');
    expect(writing.state).toBe('partial');
    expect(writing.coverage).toBe('Đã phân tích câu 1/2 đoạn');
    expect(writing.value('passive_rate')).toBe('50 %');
    expect(writing.value('subject_verb')).toBe('3');
    expect(writing.value('issue_density')).toBe('500');
    expect(writing.value('hedge_booster')).toBe('1 / 0');
  });
  it('is ready only when the whole paper has been covered', () => {
    const done = (id: string, text: string) =>
      analysis(id, text, {
        paragraph: { type: 'LD' },
        sentenceAnnotations: [{ voice: 'active', subjectVerbDistanceTokens: 1 }],
      } as unknown as Partial<Analysis>);
    const analyses = [done('p1', 'One two.'), done('p2', 'Three.')];
    const profile = buildPaperProfile({ paper, analyses, stance });
    expect(find(profile, 'discourse').state).toBe('ready');
    expect(find(profile, 'writing').state).toBe('ready');
  });
});
