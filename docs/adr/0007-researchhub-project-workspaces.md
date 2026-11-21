# ADR-0007: ResearchHub project workspaces and SSO

Status: Accepted

Date: 2026-11-19

## Context

PaperLab is being integrated as a tool opened from a ResearchHub project. `projectId` is passed by ResearchHub,
but an identifier in a URL is not proof of access. PaperLab also needs to keep shared papers and corpora available
across sessions and machines without adding a general-purpose database or sending an SSO token through a URL.
Standalone paragraph-writing tools are moving to Writing Lab; paper-level analysis remains part of PaperLab.

## Decision

- PaperLab is an OIDC public client. It uses Authorization Code with PKCE against HyperDataLab SSO, keeps the
  access token in `sessionStorage`, and preserves the validated return path and `projectId` in the PKCE state.
- The PaperLab Worker validates each SSO access token through `/oauth/userinfo`. For a workspace request, it also
  checks the project against ResearchHub's authenticated `GET /api/projects` response. The first implementation
  permits projects returned to their owner; ResearchHub does not yet expose collaborator membership.
- Each ResearchHub project has a separate Dexie namespace in the browser and one JSON workspace object in R2.
  Papers, extraction projects, corpora and paper-level analysis are included. Standalone paragraph writing
  analyses, revisions, generations and calibration labels are excluded.
- The workspace uses ETags. Creation requires `If-None-Match: *`; updates require `If-Match`. A stale update is
  rejected with 412 and the client reloads the current project workspace before continuing.
- Existing local data is copied once into the first linked project on a browser when no server workspace exists.
  Without a ResearchHub `projectId`, the app remains local-first and uses the default IndexedDB namespace.
- Firebase remains the static Hosting platform. Firebase Auth, Firestore and Cloud Functions are not used for
  this integration.

## Consequences

- The PaperLab Worker needs `RESEARCH_HUB_API_URL` set to the deployed ResearchHub Files API. The SPA needs a
  registered OIDC client ID, callback URLs, and allowed CORS origins in the SSO provider.
- R2 is used as an object store for a bounded JSON snapshot, not as a queryable database. Workspace payloads are
  capped at 25 MiB; concurrent changes are rejected instead of silently overwriting one another.
- Collaborator access needs a ResearchHub API that reports project membership. It must not be inferred from a
  `projectId` or from organization-wide SSO membership.
- Existing global PDF and topic services retain their own R2 objects. Paper metadata and project records are
  scoped by this workspace; the PDF blobs remain addressed by SHA-256 in the existing shared PDF bucket.

## Alternatives considered

- **Pass ResearchHub's token in a URL:** rejected because URLs leak through history, logs and referrers.
- **Firebase Auth / Firestore:** rejected for this integration because ResearchHub already has the SSO identity
  and the product owner requested shared project data without adding a second identity system.
- **A general database:** deferred. A versioned R2 snapshot fits the current project-sized data and avoids a
  database migration; query-heavy or collaborative editing may justify a later ADR.
