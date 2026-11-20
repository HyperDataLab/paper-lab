# PaperLab

PaperLab manages research papers, extraction projects and corpora inside a ResearchHub project. It keeps
paper-level analysis and style review with each paper; standalone paragraph writing tools are being separated
into Writing Lab. The UI is Vietnamese and the paper content is usually English.

- Spec: [docs/PRD.md](docs/PRD.md) · Roadmap: [docs/ROADMAP.md](docs/ROADMAP.md) · Decisions: [docs/adr](docs/adr)
- Engineering rules: [AGENTS.md](AGENTS.md) · UI rules: [DESIGN.md](DESIGN.md) · [CONTRIBUTING.md](CONTRIBUTING.md)

Firebase Hosting serves the SPA. Every feature requires a ResearchHub `projectId`, an authenticated HyperDataLab
SSO session, and server-verified access to that project. ResearchHub hands its existing session to PaperLab through
a short-lived, exact-origin `postMessage` handshake; the token is never put in the URL. PaperLab synchronizes the
project's data as an ETag-guarded JSON workspace in R2. See [ADR-0007](docs/adr/0007-researchhub-project-workspaces.md)
and [ADR-0008](docs/adr/0008-mandatory-researchhub-project-and-session-handoff.md).

Local setup: copy `.env.example` to `.env.development.local`, register the local callback with HyperDataLab SSO,
set the resulting public client ID, and list the exact ResearchHub origins allowed to hand off the SSO session.
The Worker also needs `RESEARCH_HUB_API_URL` pointing at the deployed
ResearchHub files API; see [Worker setup](worker/README.md#researchhub-project-workspaces). Never put a client
secret or API key in a `VITE_` variable.

> Scores and thresholds are product heuristics that need empirical calibration; they are not claims made by the book.
