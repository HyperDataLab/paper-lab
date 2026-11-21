# PaperLab

Evaluate and revise one English scientific paragraph at the paragraph and sentence level, based on
Joshua Schimel, _Writing Science_ (2012), Ch. 11–16. Part of HyperDataLab's paper-understanding toolset.

- Spec: [docs/PRD.md](docs/PRD.md) · Roadmap: [docs/ROADMAP.md](docs/ROADMAP.md) · Decisions: [docs/adr](docs/adr)
- Engineering rules: [AGENTS.md](AGENTS.md) · UI rules: [DESIGN.md](DESIGN.md) · [CONTRIBUTING.md](CONTRIBUTING.md)

Runs in the browser on Firebase Hosting, with lab data in the central lab store (Cloudflare D1 + R2, ADR-0007) behind a lab account, and the owner's 9router for the LLM.

> Scores and thresholds are product heuristics that need empirical calibration; they are not claims made by the book.
