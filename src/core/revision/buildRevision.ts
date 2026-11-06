import { PROMPT_VERSIONS, type RevisionConstraints, type RevisionOutput } from '../prompts';
import { RevisionSchema, type Analysis, type Issue } from '../schemas';
import { sourceHash } from '../text/hash';
import { alignRevision, attachChanges } from './align';
import { meaningChecks } from './meaningChecks';

export async function buildRevision(
  source: Analysis,
  output: RevisionOutput,
  selected: Issue[],
  constraints: RevisionConstraints,
  metadata: { id: string; model: string; createdAt: string },
) {
  const aligned = attachChanges(
    source.text.sourceText,
    output.revisedText,
    alignRevision(source.text.sourceText, output.revisedText),
    output.changes,
  );
  const matched = new Set(aligned.hunks.flatMap((hunk) => hunk.changeIndexes));
  const applied = new Set(
    output.changes.flatMap((change, index) => (matched.has(index) ? change.issueIds : [])),
  );
  return RevisionSchema.parse({
    schemaVersion: 1,
    id: metadata.id,
    sourceAnalysisId: source.id,
    sourceHash: source.text.sourceHash,
    revisedText: output.revisedText,
    revisedHash: await sourceHash(output.revisedText),
    hunks: aligned.hunks,
    changes: output.changes,
    unmatchedChanges: aligned.unmatchedChanges,
    needsEvidence: output.needsEvidence,
    checks: meaningChecks(source.text.sourceText, output.revisedText, constraints.preserveTerms),
    appliedIssueIds: selected.filter((issue) => applied.has(issue.id)).map((issue) => issue.id),
    promptVersion: PROMPT_VERSIONS.revision,
    model: metadata.model,
    createdAt: metadata.createdAt,
  });
}
