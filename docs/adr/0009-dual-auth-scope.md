# ADR-0009: Two sign-ins, two scopes (Firebase lab scope, SSO project scope)

Status: Accepted

Date: 2026-11-25

Supersedes: the "every feature needs a ResearchHub project" part of
[ADR-0008 (mandatory project)](0008-mandatory-researchhub-project-and-session-handoff.md), for the Firebase build
and for integrations only. The SSO build keeps that rule.

## Context

Merging Kira-Window's production line (2026-11-21) moved PaperLab to HyperDataLab SSO and scoped all data to a
ResearchHub project. The worker then rejected Firebase ID tokens and every request without `X-Project-Id`. That
broke the lab's own tools and integrations, which sign in with Firebase and have no ResearchHub project:

- the `hyperdatalab-paragraph-lab.web.app` app;
- Paper Fetch Hub `/lab/v1`;
- Writing Bank (`POST /v1/measure`);
- idea2hypothesis (KG, corpora and GROBID routes);
- lab-research-mcp;
- the 20 lab corpora and other records stored before projects, which have no project.

The owner decided on 2026-11-25 to "run both modes" (_chạy hai chế độ_). SSO and ResearchHub project scope stay,
and the Firebase lab mode comes back beside them.

## Decision

**Token kinds.** The PDF worker and the topics worker accept either kind of bearer token, and both kinds need a
verified `@hyperdatalab.org` email.

- **Firebase ID token.** A token with three dot-separated parts, an RS256 header and a
  `https://securetoken.google.com/` issuer is verified as a Firebase ID token.
  - The worker checks Google's signature, a Google sign-in, and that the issuer and audience are one of
    `ACCEPTED_PROJECT_IDS`: `hyperdatalab-paragraph-lab`, `hyperdatalab-writing-bank` and `hyperdatalab-idea2hypo`.
  - The key set is fetched with `cache: 'no-store'` (PR #255).
- **SSO access token.** Every other token is an SSO access token, checked with `GET {SSO_BASE_URL}/oauth/userinfo`.
  A successful check is cached for 5 minutes per isolate, keyed by the token's SHA-256. Failures are not cached.

The worker records the kind as `caller.kind: 'firebase' | 'sso'`.

**Scope.**

- **No project id** (no `X-Project-Id`, no `?projectId=`) is **lab scope**: the global lab store, as before
  projects.
  - Ids are unprefixed, and D1 `doc` rows have `hub_project_id IS NULL`.
  - KG rows are those whose id does not start with `@rh/`.
  - R2 keys sit under `paperlab/<area>/` (`published`, `plans`, `scg`, `fact-requests`).
  - PDFs are stored in R2 under `paperlab/pdfs/<sha>.pdf`.
  - Every `/v1` route works as before.
- **A project id** gives **project scope**, unchanged from production.
  - The worker checks ResearchHub ownership first.
  - Ids are `@rh/<projectId>/<id>`, rows carry `hub_project_id`, and R2 keys sit under
    `paperlab/projects/<projectId>/<area>/`.
  - PDFs go through the ResearchHub Files API.
- **Project scope needs an SSO token**, because ResearchHub checks ownership with it. A Firebase token with a
  project id gets `403 {"error":"project scope needs HyperDataLab SSO"}` before any ResearchHub call, on every
  route.
- **Project-only routes** still need a project and SSO: `/v1/researchhub/files*` and `/v1/workspaces/*`.

**Isolation.** Neither scope sees the other's rows.

- **D1 data.** Lab queries add `hub_project_id IS NULL`, and project queries add `hub_project_id = ?`. Lookups by
  id use the physical id.
- **Reserved prefix.** A logical id may not start with `@rh/`, so a lab caller cannot name a project row.
- **KG.** Every read, graph, trend, search, SQL and queue statement is scoped:
  - in lab scope, `id NOT LIKE '@rh/%'`;
  - in project scope, `id LIKE '@rh/<projectId>/%'`.
    Vectorize matches are filtered the same way. The cron drains the lab queue and then each project's queue.
- **Library DOIs.** Migration `0004_lab_scope_library_doi.sql` restores "one live library item per DOI" for lab
  rows. Project rows keep their own index from 0003.

**Scope API** (`worker/src/scope.ts`): the functions below take `projectId: string | null | undefined`, where
null or undefined means lab.

| Function                                                      | Use                                                      |
| ------------------------------------------------------------- | -------------------------------------------------------- |
| `physicalId` / `logicalId`                                    | Convert between logical and stored ids.                  |
| `scopeSql(projectId, column, param)` + `scopeBind(projectId)` | One-parameter SQL predicate and the value to bind to it. |
| `scopeSqlLiteral`                                             | The predicate with the scope written inline.             |
| `scopeLikes` / `scopedDb`                                     | Rewrite project-scope `col LIKE ?` text for lab scope.   |
| `inScope`                                                     | Check a stored id against the scope.                     |
| `r2Prefix(projectId, area)`                                   | R2 key prefix for an area.                               |

A new feature can reach lab scope through these helpers. For example, it can use `project_id IS NULL`-style
columns, or a `'lab'` sentinel on the client.

**Client.** The build picks its sign-in from the environment.

- `VITE_AUTH_MODE=firebase|sso` chooses it.
- Without `VITE_AUTH_MODE`, a build with `VITE_HYPERDATALAB_SSO_CLIENT_ID` uses SSO and any other build uses
  Firebase.

`AuthProvider` renders one of two implementations of the same `AuthValue`, which provides `getIdToken`,
`getAccessToken`, `user`, `signIn` and `signOut`, plus `mode`:

| Build                                | Sign-in                                                                                          | Scope                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| web.app                              | `FirebaseAuthProvider`: Google popup, lab domain, the PaperLab Firebase project's public config. | Lab scope. `useHubProjectId()` returns `LAB_SCOPE` (`'lab'`) and `?projectId=` links are ignored. |
| Vercel (`paperlab.hyperdatalab.org`) | `SsoAuthProvider`, unchanged.                                                                    | The ResearchHub project, as before.                                                               |

Every worker client builds its headers through `projectHeader()` and its URLs through `projectScopedUrl()`.
Neither sends anything for `LAB_SCOPE`.

## Consequences

- One worker deployment serves both builds and all integrations. Writing Bank, idea2hypothesis, Paper Fetch Hub
  and lab-research-mcp may keep sending Firebase tokens and use lab scope. They need SSO only to reach a project.
- Before the new worker serves lab writes, apply `worker/migrations-data/0004_lab_scope_library_doi.sql` to the
  `paperlab-data` D1.
- The web.app build needs `VITE_AUTH_MODE=firebase`, or no SSO client id in its env. Its Firebase config is
  bundled in `src/shared/auth/config.ts`; it is public, not a secret.
- Lab and project data never mix. Moving a lab record into a project is an explicit copy, not a change of scope.
- An SSO identity can be served from the cache for up to 5 minutes after the token is revoked.

## Alternatives considered

- **SSO only, with every integration moved to SSO.** Rejected for now. Writing Bank users, idea2hypothesis and
  the Hub sign in with Firebase, and the lab corpora have no project.
- **A `'lab'` project id on the wire.** Rejected. An absent project id is already the pre-project contract that
  the integrations send, and the worker keeps its strict UUID check so that a leaked sentinel fails loudly.
- **Fork the app into two codebases.** Rejected. One `AuthValue` interface with two providers keeps the change
  small.
