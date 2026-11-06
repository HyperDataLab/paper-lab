import type { GenerationInput, GenerationOutput } from '../prompts/generation';
import { citation, quantity, meaningChecks } from '../revision/meaningChecks';

type Status = 'pass' | 'warn' | 'fail' | 'info';
const check = (id: string, status: Status, detail: string) => ({ id, status, detail });
const matches = (text: string, pattern: RegExp) => Array.from(text.matchAll(pattern), (m) => m[0]);
const stripCitations = (text: string) => text.replace(citation, ' ');
const includes = (haystack: string, needle: string) =>
  haystack.toLocaleLowerCase().includes(needle.toLocaleLowerCase());
const terms = (text: string) =>
  (text.toLowerCase().match(/[a-z]{4,}/gu) ?? []).filter(
    (word) => !['that', 'with', 'from', 'this', 'were', 'have', 'these', 'their'].includes(word),
  );

export function checkProvenance(input: GenerationInput, output: GenerationOutput) {
  const sources = [input.mainClaim, ...input.evidence.map((item) => item.text)];
  const sourceText = sources.join(' ');
  const citationText = input.evidence.map((item) => item.citation ?? '').join(' ');
  const numbers = sources.flatMap((text) => matches(stripCitations(text), quantity));
  const ids = new Set(input.evidence.map((item) => item.id));
  const used = new Set(output.sentences.flatMap((sentence) => sentence.evidenceIds));
  const unusedEvidence = input.evidence.filter((item) => !used.has(item.id)).map((item) => item.id);
  const sentenceChecks = (text: string, evidenceIds: string[]) => {
    const inventedNumbers = matches(stripCitations(text), quantity).filter(
      (number) => !numbers.includes(number),
    );
    const inventedCitations = matches(text, citation).filter(
      (value) => !input.evidence.some((item) => item.citation === value),
    );
    const invalidIds = evidenceIds.filter((id) => !ids.has(id));
    const empirical =
      /\b(?:observed|measured|found|increased|decreased|showed|reported|study|experiment|data|results?)\b/iu.test(
        text,
      ) || matches(stripCitations(text), quantity).length > 0;
    // Capitalized names within a sentence are reviewable provenance signals, not entity recognition.
    const entities = matches(text, /(?<![.!?]\s)\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/gu).filter(
      (entity) => !includes(sourceText + ' ' + citationText, entity),
    );
    return [
      check('numbers_from_inputs', inventedNumbers.length ? 'fail' : 'pass', inventedNumbers.join(', ')),
      check(
        'citations_from_inputs',
        inventedCitations.length ? 'fail' : 'pass',
        inventedCitations.join(', '),
      ),
      check(
        'evidence_ids_valid',
        invalidIds.length || (empirical && !evidenceIds.some((id) => ids.has(id))) ? 'warn' : 'pass',
        invalidIds.join(', '),
      ),
      check('named_entities_from_inputs', entities.length ? 'warn' : 'pass', entities.join(', ')),
    ];
  };
  const sentences = output.sentences.map((sentence, sentenceIndex) => ({
    sentenceIndex,
    checks: sentenceChecks(sentence.text, sentence.evidenceIds),
  }));
  const paragraphChecks = sentenceChecks(
    output.paragraph,
    output.sentences.flatMap((sentence) => sentence.evidenceIds),
  );
  const claimTerms = terms(input.mainClaim);
  const claimPresent = output.sentences.some(
    (sentence) =>
      sentence.usesClaim &&
      claimTerms.length > 0 &&
      claimTerms.some((term) => terms(sentence.text).includes(term)),
  );
  const meaning = meaningChecks(sourceText, output.paragraph, input.preserveTerms);
  const strength = meaning.find((item) => item.id === 'hedging_preserved');
  const negation = meaning.find((item) => item.id === 'negation_preserved');
  const preserved = meaning.find((item) => item.id === 'preserve_terms');
  return {
    sentences,
    unusedEvidence,
    overall: [
      ...paragraphChecks.map((item) => {
        const statuses = sentences.flatMap((sentence) =>
          sentence.checks.filter((entry) => entry.id === item.id).map((entry) => entry.status),
        );
        return {
          ...item,
          status: statuses.includes('fail')
            ? ('fail' as const)
            : statuses.includes('warn') && item.status === 'pass'
              ? ('warn' as const)
              : item.status,
        };
      }),
      check('claim_present', claimPresent ? 'pass' : 'warn', ''),
      check('unused_evidence', 'info', unusedEvidence.join(', ')),
      check('claim_strength', strength?.status ?? 'pass', strength?.detail ?? ''),
      check('negation_preserved', negation?.status ?? 'pass', negation?.detail ?? ''),
      check('preserve_terms', preserved?.status ?? 'pass', preserved?.detail ?? ''),
    ],
  };
}
