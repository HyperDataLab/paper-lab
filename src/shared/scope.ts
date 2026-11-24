/**
 * Data scope of the worker requests (ADR 0008).
 *
 * The Firebase build (web.app) works in lab scope: the lab's global store, with no ResearchHub project. Its
 * `useHubProjectId()` is `LAB_SCOPE`, so pages that need "a scope" work unchanged, and every worker client sends
 * neither `X-Project-Id` nor `?projectId=` for it. The SSO build (paperlab.hyperdatalab.org) sends the selected
 * ResearchHub project id, which gives project scope.
 */
export const LAB_SCOPE = 'lab';

/** True for the lab scope (the sentinel, or no project at all). */
export const isLabScope = (projectId: string | null | undefined) => !projectId || projectId === LAB_SCOPE;

/** The `X-Project-Id` header for a project scope; nothing for the lab scope. */
export function projectHeader(projectId: string | null | undefined): Record<string, string> {
  return isLabScope(projectId) ? {} : { 'X-Project-Id': projectId as string };
}
