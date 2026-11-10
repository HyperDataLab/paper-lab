export type StaleReason = 'scope' | 'prompt' | 'model';
export interface RunFacts {
  sectionIds?: readonly string[];
  promptVersions: Readonly<Record<string, string>>;
  model: string;
}
/**
 * Why a finished result no longer matches what a run would produce now, or null when it still does.
 * Scope is a set; omit it for analyses without a reader-selected scope.
 */
export function runFreshness(stored: RunFacts, current: RunFacts): StaleReason[] | null {
  const reasons: StaleReason[] = [];
  // A result that read more than the reader now asks for still answers the question; one that did not
  // read a section the reader now wants does not.
  const read = new Set(stored.sectionIds ?? []);
  if (current.sectionIds && current.sectionIds.some((id) => !read.has(id))) reasons.push('scope');
  if (Object.entries(current.promptVersions).some(([key, version]) => stored.promptVersions[key] !== version))
    reasons.push('prompt');
  if (stored.model !== current.model) reasons.push('model');
  return reasons.length ? reasons : null;
}
