import type { ExtractionCell, VerifyOutput } from '../schemas/extraction';
import { evidenceFrom, type SourceParagraph } from './index';

/** Cells whose value is unsupported by any quote get one targeted retry before verification. */
export const needsRetry = (cell: ExtractionCell) =>
  cell.status === 'NEEDS_REVIEW' &&
  (cell.flags.includes('UNSUPPORTED') || cell.flags.includes('NUMBER_NOT_IN_EVIDENCE'));

/** What the verifier can check: a model value with evidence that a person has not already decided. */
export const verifiable = (cell: ExtractionCell) =>
  cell.verification !== 'HUMAN' && cell.aiValue !== null && cell.evidence.length > 0;

/**
 * Applies an automated verification. Only SUPPORTED keeps a cell as extracted, and it is marked AUTOMATED, never
 * as a human review. A conflicting passage turns the cell into CONFLICT with both passages, and no value is chosen.
 */
export function applyVerification(
  cells: ExtractionCell[],
  output: VerifyOutput,
  source: SourceParagraph[],
  at: string,
): ExtractionCell[] {
  return cells.map((cell) => {
    if (!verifiable(cell)) return cell;
    const check = output.checks.find((item) => item.field_key === cell.fieldKey);
    if (!check) return { ...cell, flags: [...new Set([...cell.flags, 'VERIFIER_SKIPPED'])] };
    const conflicts = check.conflicts.flatMap((item) => {
      const found = evidenceFrom(item, source);
      return found &&
        !cell.evidence.some((own) => own.paragraphId === found.paragraphId && own.start === found.start)
        ? [{ ...found, stance: 'conflicts' as const }]
        : [];
    });
    const next: ExtractionCell = { ...cell, verdict: check.verdict, verifierNote: check.note };
    if (conflicts.length) {
      next.status = 'CONFLICT';
      next.value = null;
      next.evidence = [...cell.evidence, ...conflicts];
      next.flags = [...new Set([...cell.flags, 'CONFLICTING_PASSAGES'])];
    } else if (check.verdict === 'SUPPORTED') {
      next.verification = cell.status === 'EXTRACTED' ? 'AUTOMATED' : null;
    } else {
      next.status = 'NEEDS_REVIEW';
      next.value = check.verdict === 'CONTRADICTED' ? null : cell.value;
      next.flags = [...new Set([...cell.flags, `VERIFIER_${check.verdict}`])];
    }
    next.history = [
      ...cell.history,
      { at, action: 'verify', by: 'model', value: next.value, status: next.status },
    ];
    return next;
  });
}
