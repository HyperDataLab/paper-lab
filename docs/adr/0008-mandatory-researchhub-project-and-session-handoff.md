# ADR-0008: Require a ResearchHub project and hand off the SSO session

Status: Accepted

Date: 2026-11-19

Supersedes: The local-first entry and direct-login-only parts of [ADR-0007](0007-researchhub-project-workspaces.md).

## Context

PaperLab is now a project tool inside ResearchHub. Allowing feature pages to open against a default local
workspace makes it possible to create or view records outside the shared project and then mix those records into a
project later. Requiring a separate sign-in after a user has already entered ResearchHub also breaks the tool
handoff.

## Decision

- Every PaperLab feature is gated until the URL contains a valid ResearchHub `projectId`, HyperDataLab SSO has
  authenticated the user, and the PaperLab Worker has confirmed the user's access to that project.
- ResearchHub opens PaperLab in a new tab with the project ID and a short-lived random state value. It transfers
  the current SSO access token through an exact-origin, source-checked `postMessage` handshake. The token is never
  placed in the URL; PaperLab confirms it through SSO `/oauth/userinfo` and then stores the session in
  `sessionStorage`.
- PaperLab accepts handoff messages only from exact origins in `VITE_RESEARCH_HUB_ORIGINS`, with matching project
  and state. The opener is detached after the handshake. The Worker still checks project ownership before reading
  or writing the R2 workspace.
- A direct visit without a project is gated and directs the user to ResearchHub. A direct visit with a project but
  without a valid session uses the existing OIDC Authorization Code + PKCE login flow.
- Existing local IndexedDB records are not exposed as a standalone PaperLab workspace. Project-scoped data remains
  synchronized through the PaperLab Worker and R2 as described in ADR-0007.

## Consequences

- PaperLab Hosting needs `VITE_RESEARCH_HUB_URL` and the exact comma-separated origins in
  `VITE_RESEARCH_HUB_ORIGINS`; deployed ResearchHub and local development origins must be listed.
- ResearchHub tool settings must point PaperLab at the deployed app URL. Local ResearchHub development must point
  to the local PaperLab origin and that origin must also be allowed in PaperLab's handoff configuration.
- Browser popup blocking can prevent launch. The project page reports this and asks the user to allow the ResearchHub
  popup.
- The handoff trusts the configured ResearchHub origin and the PaperLab origin configured in ResearchHub. Project
  authorization remains server-checked and is not inferred from the project ID or from the handoff message.

## Alternatives considered

- Put the access token in a URL: rejected because URLs can be copied, logged, stored in browser history, or sent as
  referrers.
- Continue local-first mode when no project is selected: rejected because records could be created outside a
  ResearchHub project.
- Require a second interactive OIDC login: rejected because ResearchHub already has an authenticated SSO session.
