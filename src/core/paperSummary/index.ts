import type { PaperInsightsRecord, SnapshotField } from '../schemas';
import type { ClaimType } from '../argument/claimTypes';
import type { EvidenceLevel } from '../argument/evidenceLevels';

/**
 * What the paper's author is saying, gathered from analyses that already ran: the gap and contribution
 * they state, the core facts of the study, their main claims with what each rests on, and the limits they
 * admit. Every item is a verified quote with its place; nothing here is generated at read time.
 */
export interface SummaryQuote {
  id: string;
  paragraphId: string;
  start: number;
  end: number;
  excerpt: string;
}
export interface SummaryClaim {
  id: string;
  claimType: ClaimType | null;
  evidenceLevel: EvidenceLevel | null;
  evidenceBasis: string | null;
  claim: SummaryQuote;
  data: SummaryQuote[];
  /** The author's own qualifier and the rebuttals they raise. */
  limits: SummaryQuote[];
  /** The stated warrant, or the one the model inferred; an inferred warrant is never the author's words. */
  warrant: { text: string; inferred: boolean } | null;
}
export interface PaperSummary {
  /** False for a part whose analysis has not run, so the screen can offer to run it instead of showing nothing. */
  has: { rhetoric: boolean; snapshot: boolean; arguments: boolean };
  gap: SummaryQuote[];
  contribution: SummaryQuote[];
  facts: { id: string; field: SnapshotField; value: string; source: SummaryQuote | null }[];
  claims: SummaryClaim[];
  limits: SummaryQuote[];
}

type Span = { paragraphId: string; start: number; end: number; excerpt: string };
const quote = (id: string, span: Span): SummaryQuote => ({
  id,
  paragraphId: span.paragraphId,
  start: span.start,
  end: span.end,
  excerpt: span.excerpt,
});
const LIMIT_CATEGORIES = new Set([
  'threat_internal',
  'threat_external',
  'threat_construct',
  'threat_conclusion',
  'limitation',
]);

export function summarizePaper(insights: PaperInsightsRecord | undefined): PaperSummary {
  const rhetoric = insights?.rhetoricRuns.at(-1);
  const snapshot = insights?.snapshotRuns.at(-1);
  const argument = insights?.argumentRuns.at(-1);
  // What a person dismissed is left out; a later "reopen" brings it back.
  const dismissed = (runId: string | undefined, itemId: string) =>
    insights?.decisions.findLast((item) => item.run_id === runId && item.item_id === itemId)?.decision ===
    'dismiss';
  const kept = (rhetoric?.items ?? []).filter((item) => !dismissed(rhetoric?.id, item.id));
  const pick = (test: (category: string) => boolean) =>
    kept.filter((item) => test(item.category)).map((item) => quote(item.id, item));
  return {
    has: { rhetoric: Boolean(rhetoric), snapshot: Boolean(snapshot), arguments: Boolean(argument) },
    gap: pick((category) => category === 'niche'),
    contribution: pick((category) => category === 'occupy'),
    facts: (snapshot?.values ?? [])
      .filter((value) => value.status === 'reported' && value.value && !dismissed(snapshot?.id, value.id))
      .map((value) => ({
        id: value.id,
        field: value.field,
        value: value.value ?? '',
        source: value.source ? quote(value.id, value.source) : null,
      })),
    claims: (argument?.arguments ?? [])
      .filter((item) => item.importance === 'main' && !dismissed(argument?.id, item.id))
      .map((item) => ({
        id: item.id,
        claimType: item.claimType,
        evidenceLevel: item.evidenceLevel ?? null,
        evidenceBasis: item.evidenceBasis ?? null,
        claim: quote(item.id, item.claim),
        data: item.data.map((span, index) => quote(`${item.id}:data:${index}`, span)),
        limits: [
          ...(item.qualifier ? [quote(`${item.id}:qualifier`, item.qualifier)] : []),
          ...item.rebuttals.map((span, index) => quote(`${item.id}:rebuttal:${index}`, span)),
        ],
        warrant: item.statedWarrant
          ? { text: item.statedWarrant.excerpt, inferred: false }
          : item.inferredWarrant
            ? { text: item.inferredWarrant, inferred: true }
            : null,
      })),
    limits: pick((category) => LIMIT_CATEGORIES.has(category)),
  };
}
