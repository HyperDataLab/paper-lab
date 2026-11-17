import { describe, expect, it } from 'vitest';
import type { Section } from '../schemas/paper';
import { bareHeading, combinedRoles, headingCue, headingRole } from './sectionRoles';
import { segmentPaper } from './segmentPaper';

// Synthetic headings only.
const CASES: [string, Section['role'] | null][] = [
  ['1. Introduction', 'introduction'],
  ['I. INTRODUCTION', 'introduction'],
  ['2 Related work', 'related_work'],
  ['2. Related Works', 'related_work'],
  ['II. RELATED WORK', 'related_work'],
  ['Literature review', 'related_work'],
  ['Review of the literature', 'related_work'],
  ['Background', 'related_work'],
  ['Theoretical background', 'related_work'],
  ['2.1 Preliminaries', 'related_work'],
  ['State of the art', 'related_work'],
  ['3. Methodology', 'methods'],
  ['III. METHODOLOGY', 'methods'],
  ['3 Proposed method', 'methods'],
  ['3. Proposed Methodology', 'methods'],
  ['The proposed approach', 'methods'],
  ['3. The Proposed Framework', 'methods'],
  ['The proposed model for fault diagnosis', 'methods'],
  ['Research methodology', 'methods'],
  ['Problem formulation', 'methods'],
  ['3.1 Problem definition', 'methods'],
  ['4.1 Experimental setup', 'methods'],
  ['Experimental settings', 'methods'],
  ['4.1. Datasets', 'methods'],
  ['Implementation details', 'methods'],
  ['Evaluation metrics', 'methods'],
  ['4 Experiments', 'results'],
  ['IV. EXPERIMENTS', 'results'],
  ['4. Experimental results', 'results'],
  ['EXPERIMENTAL RESULTS', 'results'],
  ['Experimental evaluation', 'results'],
  ['Evaluation', 'results'],
  ['5. Performance evaluation', 'results'],
  ['Case study', 'results'],
  ['5. Case Study', 'results'],
  ['Ablation study', 'results'],
  ['Results', 'results'],
  ['5. Results and discussion', 'results'],
  ['V. RESULTS AND DISCUSSION', 'results'],
  ['Results & Discussion', 'results'],
  ['6 Discussion', 'discussion'],
  ['Limitations', 'discussion'],
  ['Limitations and future work', 'discussion'],
  ['Threats to validity', 'discussion'],
  ['7. Conclusions and future work', 'conclusion'],
  ['VI. CONCLUSION', 'conclusion'],
  ['Conclusion', 'conclusion'],
  ['Concluding remarks', 'conclusion'],
  ['Future work', 'conclusion'],
  ['References', 'references'],
  ['Acknowledgements', 'other'],
  ['Declaration of competing interest', 'other'],
  ['CRediT authorship contribution statement', 'other'],
  ['Data availability', 'other'],
  // Unknown: the segmenter falls back to the parent's role, or other.
  ['Feature extraction', null],
  ['Graph construction', null],
  ['Evaluation of the network shows clear gains for every dataset we tried today', null],
];

describe('P1 section-role headings', () => {
  it.each(CASES)('%s → %s', (text, role) => {
    expect(headingRole(text)).toBe(role);
  });

  it('strips Arabic, Roman and letter numbering only', () => {
    expect(bareHeading('4.1. Datasets')).toBe('Datasets');
    expect(bareHeading('IV. EXPERIMENTS')).toBe('EXPERIMENTS');
    expect(bareHeading('A. Baselines')).toBe('Baselines');
    expect(bareHeading('Experiments')).toBe('Experiments');
  });

  it('recognises combined headings', () => {
    expect(combinedRoles('5. Results and discussion')).toEqual(['results', 'discussion']);
    expect(combinedRoles('RESULTS AND DISCUSSIONS')).toEqual(['results', 'discussion']);
    expect(combinedRoles('Discussion and results')).toEqual(['results', 'discussion']);
    expect(combinedRoles('Discussion and conclusions')).toEqual(['discussion', 'conclusion']);
    expect(combinedRoles('Results')).toBeUndefined();
    expect(combinedRoles('Conclusions and future work')).toBeUndefined();
  });
});

describe('P1 section roles through the segmenter', () => {
  it('maps engineering headings, inherits unknown subsections and flags combined R&D', async () => {
    const { sections } = await segmentPaper(
      [
        'Abstract',
        'Synthetic abstract text.',
        '1. Introduction',
        'Synthetic introduction text.',
        '2. Related work',
        'Synthetic background text.',
        '3. Proposed method',
        'Synthetic method text.',
        '3.1. Feature extraction',
        'Synthetic sub text.',
        '3.1.1. Graph construction',
        'Synthetic sub-sub text.',
        '4. Experiments',
        'Synthetic experiment text.',
        '4.1. Experimental setup',
        'Synthetic setup text.',
        '4.2. Comparison with baselines',
        'Synthetic comparison text.',
        '5. Results and discussion',
        'Synthetic findings text.',
        '6. Conclusions and future work',
        'Synthetic closing text.',
      ].join('\n'),
    );
    expect(sections.map((s) => [s.heading, s.role, s.combined])).toEqual([
      ['Abstract', 'abstract', undefined],
      ['Introduction', 'introduction', undefined],
      ['Related work', 'related_work', undefined],
      ['Proposed method', 'methods', undefined],
      ['Feature extraction', 'methods', undefined],
      ['Graph construction', 'methods', undefined],
      ['Experiments', 'results', undefined],
      ['Experimental setup', 'methods', undefined],
      ['Comparison with baselines', 'results', undefined],
      ['Results and discussion', 'results', ['results', 'discussion']],
      ['Conclusions and future work', 'conclusion', undefined],
    ]);
    expect(sections.filter((s) => 'combined' in s)).toHaveLength(1);
  });

  it('reads all-caps Roman PDF headings, unnumbered title-case and markdown numbered subheadings', async () => {
    const pdf = await segmentPaper(
      [
        { text: 'I. INTRODUCTION', height: 12, source: 'pdf' as const },
        { text: 'Synthetic introduction body text for the paper.', height: 10, source: 'pdf' as const },
        { text: 'IV. EXPERIMENTAL RESULTS', height: 12, source: 'pdf' as const, breakBefore: true },
        { text: 'Synthetic results body text for the paper.', height: 10, source: 'pdf' as const },
      ].map((line) => ({ ...line, pageStart: 1 })),
    );
    expect(pdf.sections.map((s) => [s.heading, s.role])).toEqual([
      ['INTRODUCTION', 'introduction'],
      ['EXPERIMENTAL RESULTS', 'results'],
    ]);
    const plain = await segmentPaper(
      [
        'Introduction',
        'Synthetic text.',
        'Performance Evaluation',
        'Synthetic text.',
        '## 4.1 Datasets',
        'Synthetic text.',
      ].join('\n'),
    );
    expect(plain.sections.map((s) => [s.heading, s.role])).toEqual([
      ['Introduction', 'introduction'],
      ['Performance Evaluation', 'results'],
      ['4.1 Datasets', 'methods'],
    ]);
  });

  it('keeps a body line that starts with a new keyword as body text', async () => {
    const { sections, paragraphs } = await segmentPaper(
      ['Introduction', 'Evaluation of the network shows clear gains on all synthetic sets.'].join('\n'),
    );
    expect(sections.map((s) => s.heading)).toEqual(['Introduction']);
    expect(paragraphs).toHaveLength(1);
  });

  it('does not promote wrapped body lines, bare generic labels or lettered lines to sections', async () => {
    const lines = [
      'Experiments on the three benchmark datasets show that the',
      'proposed model improves on every synthetic baseline we used',
      'Analysis of the results in Table 3 for each',
      'Data',
      'Comparison',
      'A. Datasets',
      'B. Network design',
    ];
    const text = await segmentPaper(['Introduction', ...lines].join('\n'));
    expect(text.sections.map((s) => s.heading)).toEqual(['Introduction']);
    const pdf = await segmentPaper([
      { text: 'Introduction', height: 10, source: 'pdf' as const, pageStart: 1 },
      // A full body line first, so the existing two-line heading join does not apply.
      {
        text: 'Synthetic opening text of the introduction ends here.',
        height: 10,
        source: 'pdf' as const,
        pageStart: 1,
      },
      ...lines.map((line) => ({ text: line, height: 10, source: 'pdf' as const, pageStart: 1 })),
    ]);
    expect(pdf.sections.map((s) => s.heading)).toEqual(['Introduction']);
    for (const line of lines) expect(headingCue(line), line).toBe(false);
    expect(headingCue('IV. EXPERIMENTS')).toBe(true);
    expect(headingCue('Performance evaluation')).toBe(true);
  });

  it('keeps a known other heading under a parent instead of inheriting', async () => {
    const { sections } = await segmentPaper(
      ['1. Conclusion', 'Synthetic text.', '1.1. Funding', 'Synthetic text.'].join('\n'),
    );
    expect(sections.map((s) => [s.heading, s.role])).toEqual([
      ['Conclusion', 'conclusion'],
      ['Funding', 'other'],
    ]);
  });
});
