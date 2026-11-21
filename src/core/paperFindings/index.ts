import type {
  Analysis,
  CheckId,
  MeasurementsRecord,
  Paper,
  PaperChecksRecord,
  PaperInsightsRecord,
  PaperOverviewRecord,
  PaperReviewsRecord,
  StanceRecord,
} from '../schemas';

/**
 * One reading of everything the app has found in a paper. The analyses store their results in their own
 * shapes, with their own severity scales and decision words; this module reads them into one shape at read
 * time and changes nothing that is stored.
 */
export type Criterion = 'claim' | 'evidence' | 'writing' | 'context';
export type FindingSeverity = 'high' | 'medium' | 'low';
export type FindingStatus = 'open' | 'confirmed' | 'dismissed';
export type FindingSource = 'checks' | 'review' | 'writing' | 'transition' | 'measurement';
export interface FindingLocation {
  paragraphId: string;
  start: number;
  end: number;
}
export interface PaperFinding {
  id: string;
  source: FindingSource;
  runId?: string;
  criterion: Criterion;
  /** The point in one line. For sentence-level writing issues the reader's label comes from `code`. */
  title: string;
  /** An internal type code when the title must be looked up by the screen, else null. */
  code: string | null;
  reason: string | null;
  locations: FindingLocation[];
  /** The section of the first location; null for a finding about the paper as a whole. */
  sectionId: string | null;
  severity: FindingSeverity;
  /** A model's candidate, or the output of a fixed rule. Neither is a verdict until a person decides. */
  origin: 'ai' | 'rule';
  status: FindingStatus;
  /** The view whose block holds the full detail and the review controls. */
  view: string;
}
/** A passage worth marking on the paper: a finding's location, or something an analysis described. */
export interface PaperMark extends FindingLocation {
  id: string;
  criterion: Criterion;
  label: string;
  /** Set when the mark is a finding; a descriptive mark has none. */
  findingId: string | null;
  view: string;
}
export interface FindingInputs {
  paper: Paper;
  checks?: PaperChecksRecord;
  reviews?: PaperReviewsRecord;
  analyses?: Analysis[];
  overview?: PaperOverviewRecord;
  measurements?: MeasurementsRecord;
  insights?: PaperInsightsRecord;
  stance?: StanceRecord;
}

export const CHECKS: Record<CheckId, { criterion: Criterion; view: string }> = {
  numbers_consistency: { criterion: 'evidence', view: 'science-checks' },
  unsupported_claims: { criterion: 'claim', view: 'science-checks' },
  figures_tables: { criterion: 'writing', view: 'discourse-checks' },
  acronyms: { criterion: 'writing', view: 'writing-checks' },
  claim_strength_drift: { criterion: 'claim', view: 'writing-checks' },
  citations_references: { criterion: 'context', view: 'context-checks' },
};
const REVIEW_CRITERION: Record<string, Criterion> = {
  soundness: 'claim',
  significance: 'claim',
  originality: 'claim',
  limitations_ethics: 'claim',
  reproducibility: 'evidence',
  clarity: 'writing',
  citations: 'context',
};
const TRANSITION_TITLES: Record<string, string> = {
  FLOW_BREAK_CANDIDATE: 'Đứt mạch giữa hai đoạn',
  UNEXPLAINED_TOPIC_SHIFT: 'Chuyển chủ đề chưa giải thích',
};
const MEASUREMENT_TITLES: Record<string, string> = {
  definition_ambiguity: 'Định nghĩa phép đo chưa rõ',
  unit_scale_mismatch: 'Đơn vị hoặc thang đo không khớp',
  protocol_incompleteness: 'Quy trình đánh giá chưa đủ chi tiết',
  aggregation_ambiguity: 'Cách tổng hợp kết quả chưa rõ',
  comparability_risk: 'Khó so sánh giữa các kết quả',
  claim_evidence_gap: 'Claim vượt quá kết quả đo',
};
const HUMAN: Record<string, FindingStatus> = {
  confirmed_by_human: 'confirmed',
  dismissed_by_human: 'dismissed',
};

/** Every issue found in the paper, in the paper's own order; findings about the whole paper come last. */
export function collectFindings(input: FindingInputs): PaperFinding[] {
  const { paper } = input;
  const sectionOf = new Map(paper.paragraphs.map((item) => [item.id, item.sectionId]));
  const found: PaperFinding[] = [];
  const add = (item: Omit<PaperFinding, 'sectionId'>) =>
    found.push({ ...item, sectionId: sectionOf.get(item.locations[0]?.paragraphId ?? '') ?? null });

  for (const check of input.checks?.report.checks ?? []) {
    const place = CHECKS[check.id];
    for (const finding of check.findings) {
      const decision = input.checks?.decisions.findLast((item) => item.findingId === finding.id);
      add({
        id: `checks:${finding.id}`,
        source: 'checks',
        ...place,
        title: finding.message,
        code: finding.checkId,
        reason: finding.evidence.join(' · ') || null,
        locations: finding.locations,
        severity: finding.severity === 'moderate' ? 'medium' : 'low',
        origin: 'rule',
        status: decision ? (HUMAN[decision.status] ?? 'open') : 'open',
      });
    }
  }

  // The reader writes their own notes before seeing the AI's review; until then its points stay out.
  const review = input.reviews?.humanNotes?.revealedAt ? input.reviews.runs.at(-1) : undefined;
  for (const point of review?.merged ?? []) {
    const wording = point.wordings.find((item) => item.kind !== 'strength');
    if (!wording) continue;
    const decision = input.reviews?.decisions.findLast((item) => item.pointId === point.id);
    add({
      id: `review:${point.id}`,
      source: 'review',
      criterion: REVIEW_CRITERION[wording.dimension] ?? 'claim',
      view: 'review',
      title: wording.point,
      code: null,
      reason: wording.rationale,
      locations: [
        { paragraphId: point.anchor.paragraphId, start: point.anchor.start, end: point.anchor.end },
      ],
      severity: point.severity === 'major' ? 'high' : point.severity === 'moderate' ? 'medium' : 'low',
      origin: 'ai',
      status: decision ? (HUMAN[decision.status] ?? 'open') : 'open',
    });
  }

  for (const analysis of input.analyses ?? []) {
    if (analysis.origin?.kind !== 'paper') continue;
    const paragraphId = analysis.origin.paragraphId;
    for (const issue of analysis.issues) {
      add({
        id: `writing:${analysis.id}:${issue.id}`,
        source: 'writing',
        criterion: 'writing',
        view: 'language',
        title: issue.type,
        code: issue.type,
        reason: issue.why,
        locations: issue.spans.map((span) => ({ paragraphId, start: span.start, end: span.end })),
        severity:
          issue.severity === 'critical' || issue.severity === 'major'
            ? 'high'
            : issue.severity === 'moderate'
              ? 'medium'
              : 'low',
        origin: issue.category === 'flow' || issue.category === 'organization' ? 'ai' : 'rule',
        status: HUMAN[issue.status] ?? 'open',
      });
    }
  }

  for (const finding of input.overview?.transitions?.findings ?? []) {
    add({
      id: `transition:${finding.id}`,
      source: 'transition',
      criterion: 'writing',
      view: 'organization',
      title: TRANSITION_TITLES[finding.type] ?? finding.type,
      code: null,
      reason: finding.why,
      locations: [finding.from, finding.to].map((end) => ({
        paragraphId: end.paragraphId,
        start: end.span.start,
        end: end.span.end,
      })),
      severity: finding.severity === 'moderate' ? 'medium' : 'low',
      origin: 'ai',
      status: HUMAN[finding.status] ?? 'open',
    });
  }

  const measurement = input.measurements?.runs.at(-1);
  if (measurement) {
    const evidence = new Map(measurement.profile.evidence.map((item) => [item.id, item]));
    for (const finding of measurement.profile.findings) {
      const decision = input.measurements?.decisions.findLast(
        (item) => item.run_id === measurement.id && item.item_id === finding.id && item.field === null,
      );
      add({
        id: `measurement:${finding.id}`,
        source: 'measurement',
        runId: measurement.id,
        criterion: finding.type === 'claim_evidence_gap' ? 'claim' : 'evidence',
        view: 'measure',
        title: MEASUREMENT_TITLES[finding.type] ?? finding.type,
        code: null,
        reason: finding.explanation,
        // A table cell has no text span; such evidence is named in the measurement block instead.
        locations: finding.evidence_ids.flatMap((id) => {
          const item = evidence.get(id);
          return item?.span && sectionOf.has(item.blockId)
            ? [{ paragraphId: item.blockId, start: item.span.start, end: item.span.end }]
            : [];
        }),
        severity: finding.severity,
        origin: 'ai',
        status:
          decision?.decision === 'accept'
            ? 'confirmed'
            : decision?.decision === 'reject'
              ? 'dismissed'
              : 'open',
      });
    }
  }

  const order = new Map(paper.paragraphs.map((item, index) => [item.id, index]));
  const position = (item: PaperFinding) =>
    order.get(item.locations[0]?.paragraphId ?? '') ?? Number.MAX_SAFE_INTEGER;
  return found.sort(
    (a, b) => position(a) - position(b) || (a.locations[0]?.start ?? 0) - (b.locations[0]?.start ?? 0),
  );
}

/**
 * Everything to mark on the paper's text: each finding's passages, plus what the descriptive analyses
 * located (claims and their data, stance markers). Items a person dismissed are left out.
 */
export function collectMarks(
  input: FindingInputs,
  findings: PaperFinding[] = collectFindings(input),
): PaperMark[] {
  const known = new Set(input.paper.paragraphs.map((item) => item.id));
  const marks: PaperMark[] = [];
  const add = (mark: PaperMark) => {
    if (known.has(mark.paragraphId) && mark.end > mark.start) marks.push(mark);
  };
  for (const finding of findings) {
    if (finding.status === 'dismissed') continue;
    finding.locations.forEach((location, index) =>
      add({
        ...location,
        id: `${finding.id}#${index}`,
        criterion: finding.criterion,
        label: finding.title,
        findingId: finding.id,
        view: finding.view,
      }),
    );
  }
  const insights = input.insights;
  const dismissed = (runId: string, itemId: string) =>
    insights?.decisions.findLast((item) => item.run_id === runId && item.item_id === itemId)?.decision ===
    'dismiss';
  const argumentRun = insights?.argumentRuns.at(-1);
  for (const argument of argumentRun?.arguments ?? []) {
    if (dismissed(argumentRun?.id ?? '', argument.id)) continue;
    add({
      ...span(argument.claim),
      id: `claim:${argument.id}`,
      criterion: 'claim',
      label: argument.importance === 'main' ? 'Claim chính' : 'Claim phụ',
      findingId: null,
      view: 'toulmin',
    });
    argument.data.forEach((datum, index) =>
      add({
        ...span(datum),
        id: `data:${argument.id}:${index}`,
        criterion: 'evidence',
        label: 'Grounds cho một claim',
        findingId: null,
        view: 'toulmin',
      }),
    );
  }
  const stanceRun = input.stance?.runs.at(-1);
  for (const annotation of stanceRun?.annotations ?? []) {
    const decision = input.stance?.decisions.findLast(
      (item) => item.run_id === stanceRun?.id && item.annotation_id === annotation.id,
    );
    if (decision?.decision === 'dismiss') continue;
    add({
      paragraphId: annotation.paragraphId,
      start: annotation.start,
      end: annotation.end,
      id: `stance:${annotation.id}`,
      criterion: 'writing',
      label: `Giọng văn: ${annotation.marker}`,
      findingId: null,
      view: 'stance',
    });
  }
  return marks;
}
const span = (value: { paragraphId: string; start: number; end: number }): FindingLocation => ({
  paragraphId: value.paragraphId,
  start: value.start,
  end: value.end,
});

export interface TextSegment {
  text: string;
  /** The marks covering this stretch, findings first. Empty for unmarked text. */
  marks: PaperMark[];
}
/** Cuts a paragraph into stretches by the marks that cover them. Offsets are code points, as stored. */
export function segmentText(text: string, marks: PaperMark[]): TextSegment[] {
  const points = Array.from(text);
  const inside = marks.filter((mark) => mark.start < points.length);
  if (inside.length === 0) return [{ text, marks: [] }];
  const cuts = [
    ...new Set([
      0,
      points.length,
      ...inside.flatMap((mark) => [mark.start, Math.min(mark.end, points.length)]),
    ]),
  ].sort((a, b) => a - b);
  const segments: TextSegment[] = [];
  for (let index = 0; index < cuts.length - 1; index += 1) {
    const start = cuts[index] ?? 0;
    const end = cuts[index + 1] ?? start;
    if (end <= start) continue;
    segments.push({
      text: points.slice(start, end).join(''),
      marks: inside
        .filter((mark) => mark.start <= start && mark.end >= end)
        .sort((a, b) => Number(b.findingId !== null) - Number(a.findingId !== null)),
    });
  }
  return segments;
}

export interface FindingCount {
  sectionId: string | null;
  criterion: Criterion;
  count: number;
}
/** How many findings each section has under each criterion: the cells of the section-by-criterion table. */
export function countBySection(findings: PaperFinding[]): FindingCount[] {
  const counts = new Map<string, FindingCount>();
  for (const finding of findings) {
    const key = `${finding.sectionId ?? ''}|${finding.criterion}`;
    const cell = counts.get(key) ?? { sectionId: finding.sectionId, criterion: finding.criterion, count: 0 };
    cell.count += 1;
    counts.set(key, cell);
  }
  return [...counts.values()];
}
