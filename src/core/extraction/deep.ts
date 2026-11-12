import { normalTitle } from '../text/normalizeTitle';
import { normalizeDoi } from '../library/doi';
import { abstractFromIndex } from '../scholarlyContext';
import type {
  Candidate,
  DeepResearch,
  PlanOutput,
  ScreeningOutput,
  ScreeningStatus,
  SearchPlan,
  GroundedCitation,
  Synthesis,
  SynthesisClaim,
  SynthesisOutput,
} from '../schemas/deepResearch';
import type { ExtractionCell, ExtractionProject, ProjectPaper } from '../schemas/extraction';

export const emptyDeep = (): DeepResearch => ({ plan: null, rounds: [], candidates: [], syntheses: [] });
export const SCREENING_BATCH = 10;
const SYNTHESIS_CHARS = 40000;

export function planFromOutput(output: PlanOutput): SearchPlan {
  const clean = (items: string[]) => [...new Set(items.map((item) => item.trim()).filter(Boolean))];
  return {
    concepts: clean(output.concepts),
    queries: clean(output.queries).slice(0, 8),
    inclusion: clean(output.inclusion),
    exclusion: clean(output.exclusion),
    fromYear: output.fromYear,
    toYear: output.toYear,
    perQuery: 15,
    approvedAt: null,
  };
}

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);

/** One OpenAlex work as a screening candidate. A work without a title is skipped. */
export function candidateFromWork(raw: unknown, foundBy: string): Candidate | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const work = raw as Record<string, unknown>;
  const title = text(work.display_name) ?? text(work.title);
  if (!title) return null;
  const doi = typeof work.doi === 'string' ? normalizeDoi(work.doi) : null;
  const openalexId = typeof work.id === 'string' ? (work.id.split('/').pop() ?? null) : null;
  const location = (work.primary_location ?? {}) as Record<string, unknown>;
  const authorships = Array.isArray(work.authorships) ? work.authorships : [];
  return {
    key: doi ?? openalexId ?? normalTitle(title),
    openalexId,
    doi,
    title,
    year: typeof work.publication_year === 'number' ? work.publication_year : null,
    authors: authorships.flatMap((entry: Record<string, unknown>) => {
      const name = text((entry.author as Record<string, unknown> | undefined)?.display_name);
      return name ? [name] : [];
    }),
    venue: text(((location.source ?? {}) as Record<string, unknown>).display_name),
    abstract: abstractFromIndex(work.abstract_inverted_index),
    citedBy: typeof work.cited_by_count === 'number' ? work.cited_by_count : null,
    foundBy: [foundBy],
    status: 'candidate',
    suggestion: null,
    reason: null,
    decidedAt: null,
  };
}

/** The same work found twice is kept once: by DOI, otherwise by title and year. Decisions already made stay. */
export function mergeCandidates(existing: Candidate[], incoming: Candidate[]) {
  const result = [...existing];
  let added = 0;
  for (const next of incoming) {
    const index = result.findIndex(
      (old) =>
        (next.doi !== null && old.doi === next.doi) ||
        (normalTitle(old.title) === normalTitle(next.title) && old.year === next.year),
    );
    const old = result[index];
    if (old) result[index] = { ...old, foundBy: [...new Set([...old.foundBy, ...next.foundBy])] };
    else {
      result.push(next);
      added++;
    }
  }
  return { candidates: result, added };
}

/** Suggestions land only on candidates nobody has decided yet; unknown keys are ignored. */
export function applySuggestions(candidates: Candidate[], output: ScreeningOutput) {
  return candidates.map((candidate) => {
    const suggestion = output.decisions.find((item) => item.key === candidate.key);
    return suggestion && candidate.status === 'candidate'
      ? { ...candidate, suggestion: { decision: suggestion.decision, reason: suggestion.reason } }
      : candidate;
  });
}

export function decideCandidate(
  candidates: Candidate[],
  key: string,
  status: ScreeningStatus,
  at: string,
  reason?: string,
) {
  return candidates.map((candidate) =>
    candidate.key === key
      ? {
          ...candidate,
          status,
          reason: reason ?? candidate.suggestion?.reason ?? null,
          decidedAt: status === 'candidate' ? null : at,
        }
      : candidate,
  );
}

const fingerprint = (value: string) => {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 16777619) >>> 0;
  return hash.toString(36);
};

/** Included candidates enter the matrix, read from their abstract where OpenAlex has one. */
export function papersFromCandidates(candidates: Candidate[]): ProjectPaper[] {
  return candidates
    .filter((candidate) => candidate.status === 'included')
    .map((candidate) => ({
      key: `search:${candidate.key}`,
      source: { kind: 'search' as const, candidateKey: candidate.key },
      title: candidate.title,
      authors: candidate.authors,
      year: candidate.year,
      venue: candidate.venue,
      doi: candidate.doi,
      access: candidate.abstract ? ('ABSTRACT_ONLY' as const) : ('METADATA_ONLY' as const),
      abstract: candidate.abstract,
      revision: candidate.abstract ? fingerprint(candidate.abstract) : 'metadata',
      screening: 'included' as const,
    }));
}

/**
 * What synthesis may read: the matrix values only. Each paper gets a short label (P1, P2, …) and each value
 * its own (P1.1, P1.2, …), which the model copies back reliably. Withheld values and conflicts stay out.
 */
function synthesisRows(project: ExtractionProject) {
  const fields = project.fields.filter((field) => !field.hidden);
  const rows: { label: string; key: string; text: string; values: Map<string, ExtractionCell> }[] = [];
  let size = 0;
  for (const paper of project.papers.filter((item) => item.screening === 'included')) {
    const label = `P${rows.length + 1}`;
    const values = new Map<string, ExtractionCell>();
    const lines: string[] = [];
    for (const field of fields) {
      const cell = project.cells.find((item) => item.paperKey === paper.key && item.fieldKey === field.key);
      if (!cell?.value || cell.status === 'CONFLICT') continue;
      const ref = `${label}.${values.size + 1}`;
      values.set(ref.toLowerCase(), cell);
      lines.push(`  [${ref}] ${field.label}: ${cell.value}`);
    }
    if (!lines.length) continue;
    const text = `[${label}] ${paper.title}${paper.year ? ` (${paper.year})` : ''} · source: ${paper.access}\n${lines.join('\n')}`;
    if (size + text.length > SYNTHESIS_CHARS) break;
    rows.push({ label, key: paper.key, text, values });
    size += text.length;
  }
  return rows;
}
export const synthesisInput = (project: ExtractionProject) => synthesisRows(project).map((row) => row.text);

function citationOf(cell: ExtractionCell, project: ExtractionProject): GroundedCitation {
  return {
    paperKey: cell.paperKey,
    fieldKey: cell.fieldKey,
    fieldLabel: project.fields.find((field) => field.key === cell.fieldKey)?.label ?? cell.fieldKey,
    value: cell.value ?? '',
    fullText: cell.sourceAccess === 'FULL_TEXT',
    humanVerified: cell.verification === 'HUMAN',
    quotes: cell.evidence
      .filter((item) => item.stance === 'supports')
      .map(({ paragraphId, section, page, start, end, quote }) => ({
        paragraphId,
        section,
        page,
        start,
        end,
        quote,
      })),
  };
}

/**
 * Citation grounding. A reference to a value (P1.2) becomes a citation carrying the passages code found in
 * the paper for that value; a reference to a whole paper (P1) or by key names the paper only. References
 * to anything the model was not shown are dropped. A claim other than a gap with no paper left is marked
 * unsupported.
 */
export function verifySynthesis(output: SynthesisOutput, project: ExtractionProject) {
  const shown = synthesisRows(project);
  const byLabel = new Map(shown.map((row) => [row.label.toLowerCase(), row.key]));
  const keys = new Set(shown.map((row) => row.key));
  const cells = new Map(shown.flatMap((row) => [...row.values]));
  let dropped = 0;
  const claims = output.claims.map((claim) => {
    const papers: string[] = [];
    const citations: GroundedCitation[] = [];
    for (const raw of claim.paperKeys) {
      const ref = raw.trim().replace(/^\[|\]$/g, '');
      const cell = cells.get(ref.toLowerCase());
      const key = cell?.paperKey ?? byLabel.get(ref.toLowerCase()) ?? (keys.has(ref) ? ref : undefined);
      if (!key) {
        dropped++;
        continue;
      }
      papers.push(key);
      if (cell && !citations.some((item) => item.paperKey === key && item.fieldKey === cell.fieldKey))
        citations.push(citationOf(cell, project));
    }
    const paperKeys = [...new Set(papers)];
    // A gap is about what the matrix lacks, so it needs no source.
    return { ...claim, paperKeys, citations, supported: paperKeys.length > 0 || claim.kind === 'gap' };
  });
  return { claims, dropped };
}

/** Grounded means at least one citation shows a passage found in its paper. */
export const isGrounded = (claim: SynthesisClaim) => claim.citations.some((item) => item.quotes.length > 0);

/** Every quote a synthesis used from one paper, each with the claims that rest on it. */
export function paperEvidence(synthesis: Synthesis, paperKey: string) {
  const items: { citation: GroundedCitation; claims: string[] }[] = [];
  for (const claim of synthesis.claims)
    for (const citation of claim.citations) {
      if (citation.paperKey !== paperKey) continue;
      const found = items.find((item) => item.citation.fieldKey === citation.fieldKey);
      if (found) found.claims.push(claim.text);
      else items.push({ citation, claims: [claim.text] });
    }
  return items;
}

const KIND_TITLES = {
  theme: 'Chủ đề chung',
  agreement: 'Điểm thống nhất',
  disagreement: 'Điểm khác biệt',
  gap: 'Khoảng trống ứng viên',
} as const;

export function synthesisMarkdown(project: ExtractionProject, synthesis: Synthesis) {
  const titleOf = (key: string) => project.papers.find((paper) => paper.key === key);
  const numbers = new Map(synthesis.paperKeys.map((key, index) => [key, index + 1]));
  const cite = (keys: string[]) => keys.map((key) => `[${numbers.get(key) ?? '?'}]`).join('');
  const lines = [
    `# ${project.title}`,
    project.researchQuestion ? `Câu hỏi nghiên cứu: ${project.researchQuestion}` : '',
    `Tổng hợp lúc ${synthesis.createdAt} · ${synthesis.model} · ${synthesis.promptVersion}`,
    'Tổng hợp chỉ dựa trên giá trị trong ma trận. Khoảng trống là giả thuyết, không phải kết luận rằng chưa có nghiên cứu nào.',
  ];
  for (const kind of Object.keys(KIND_TITLES) as (keyof typeof KIND_TITLES)[]) {
    const claims = synthesis.claims.filter((claim) => claim.kind === kind);
    if (!claims.length) continue;
    lines.push('', `## ${KIND_TITLES[kind]}`);
    for (const claim of claims)
      lines.push(
        `- ${claim.text} ${claim.supported ? cite(claim.paperKeys) : '(chưa có nguồn trong ma trận)'}${claim.caveat ? ` — Lưu ý: ${claim.caveat}` : ''}`,
      );
  }
  lines.push('', '## Tài liệu');
  for (const key of synthesis.paperKeys) {
    const paper = titleOf(key);
    if (!paper) continue;
    lines.push(
      `${numbers.get(key)}. ${paper.title}${paper.year ? ` (${paper.year})` : ''}${paper.doi ? `. https://doi.org/${paper.doi}` : ''}`,
    );
    for (const { citation } of paperEvidence(synthesis, key))
      for (const quote of citation.quotes)
        lines.push(
          `   - ${citation.fieldLabel}: “${quote.quote}”${quote.page ? ` (tr. ${quote.page})` : ''}${citation.fullText ? '' : ' (tóm tắt)'}`,
        );
  }
  return lines.filter((line, index) => line !== '' || index > 0).join('\n');
}
