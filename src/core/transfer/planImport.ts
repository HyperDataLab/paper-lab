import { z } from 'zod';
import {
  AnalysisSchema,
  ExportPackageSchema,
  type Analysis,
  type AuditEvent,
  type Revision,
} from '../schemas';
import { validateAnalysisSpans } from '../schemas/validateAnalysis';
export type ImportPlan = ReturnType<typeof planImport>;
export function planImport(
  rawJson: unknown,
  existing: Map<string, { updatedAt: string; sourceHash: string }>,
  auditIds: Set<string>,
  computedHashes: Map<string, string>,
  revisionHashes = new Map<string, string>(),
  existingRevisionIds = new Set<string>(),
) {
  existing = new Map(existing);
  const parsed = ExportPackageSchema.extend({ analyses: z.array(z.unknown()) }).safeParse(rawJson);
  if (!parsed.success)
    return {
      ok: false as const,
      error: parsed.error.issues
        .slice(0, 5)
        .map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
        .join('; '),
    };
  const toInsert: Analysis[] = [],
    toUpdate: Analysis[] = [],
    skipped: { id: string; reason: string }[] = [],
    suppressed: { path: string; reason: string }[] = [];
  const auditEligible = new Set<string>();
  const counts = new Map<string, number>();
  for (const raw of parsed.data.analyses) {
    if (typeof raw === 'object' && raw !== null && 'id' in raw && typeof raw.id === 'string')
      counts.set(raw.id, (counts.get(raw.id) ?? 0) + 1);
  }
  const analyses = parsed.data.analyses.map((raw, index) => {
    const result = AnalysisSchema.safeParse(raw);
    if (result.success) return { item: result.data, index };
    const id =
      typeof raw === 'object' && raw !== null && 'id' in raw && typeof raw.id === 'string'
        ? raw.id
        : '(unknown)';
    skipped.push({
      id,
      reason: `invalid analysis: ${result.error.issues
        .slice(0, 5)
        .map((issue) => issue.path.join('.') || 'root')
        .join(', ')}`,
    });
    return null;
  });
  analyses.forEach((entry) => {
    if (!entry) return;
    const { item, index } = entry;
    if ((counts.get(item.id) ?? 0) > 1) {
      skipped.push({ id: item.id, reason: 'duplicate analysis id' });
      return;
    }
    if (computedHashes.get(item.id) !== item.text.sourceHash) {
      skipped.push({ id: item.id, reason: 'source hash mismatch' });
      return;
    }
    try {
      const checked = validateAnalysisSpans(item);
      suppressed.push(
        ...checked.suppressed.map((entry) => ({ ...entry, path: `analyses.${index}.${entry.path}` })),
      );
      const previous = existing.get(item.id);
      if (!previous) {
        toInsert.push(checked.valid);
        auditEligible.add(item.id);
        existing.set(item.id, { updatedAt: item.updatedAt, sourceHash: item.text.sourceHash });
      } else if (previous.sourceHash !== item.text.sourceHash)
        skipped.push({ id: item.id, reason: 'source text differs' });
      else if (Date.parse(item.updatedAt) > Date.parse(previous.updatedAt)) {
        toUpdate.push(checked.valid);
        auditEligible.add(item.id);
        existing.set(item.id, { updatedAt: item.updatedAt, sourceHash: item.text.sourceHash });
      } else {
        skipped.push({ id: item.id, reason: 'not newer' });
        auditEligible.add(item.id);
      }
    } catch (error) {
      skipped.push({
        id: item.id,
        reason: `invalid analysis: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  });
  const revisionsToInsert: Revision[] = [];
  const seenRevisions = new Set(existingRevisionIds);
  for (const revision of parsed.data.revisions) {
    if (seenRevisions.has(revision.id)) continue;
    if (
      !auditEligible.has(revision.sourceAnalysisId) ||
      existing.get(revision.sourceAnalysisId)?.sourceHash !== revision.sourceHash ||
      revisionHashes.get(revision.id) !== revision.revisedHash
    ) {
      skipped.push({ id: revision.id, reason: 'invalid revision source or hash' });
      continue;
    }
    seenRevisions.add(revision.id);
    revisionsToInsert.push(revision);
  }
  const seen = new Set(auditIds);
  let auditSkipped = 0;
  const auditEvents: AuditEvent[] = parsed.data.auditEvents.filter((event) => {
    if (seen.has(event.id) || !auditEligible.has(event.analysisId)) {
      auditSkipped++;
      return false;
    }
    seen.add(event.id);
    return true;
  });
  return {
    ok: true as const,
    toInsert,
    toUpdate,
    revisionsToInsert,
    skipped,
    suppressed,
    auditEvents,
    auditSkipped,
  };
}
