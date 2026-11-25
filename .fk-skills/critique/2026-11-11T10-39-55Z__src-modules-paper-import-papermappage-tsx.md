---
target: PaperLab paper workspace UI
total_score: 27
p0_count: 0
p1_count: 0
timestamp: 2026-11-11T10-39-55Z
slug: src-modules-paper-import-papermappage-tsx
---

# PaperLab UI review

**Target:** `src/modules/paper-import/PaperMapPage.tsx` and shared paper workspace UI. Review is source-based; the supplied screenshot anchors the target state.

## Design health score (baseline before this pass)

| #         | Heuristic                           |     Score | Key issue                                                                            |
| --------- | ----------------------------------- | --------: | ------------------------------------------------------------------------------------ |
| 1         | Visibility of system status         |         3 | Run status and counts are present, though filters compete with the result status.    |
| 2         | Match between system and real world |         3 | Research terms are domain-appropriate; some technical labels remain dense.           |
| 3         | User control and freedom            |         3 | Filters, navigation and decisions are available; the control stack is visually busy. |
| 4         | Consistency and standards           |         2 | Tabs wrap, filter groups and actions use inconsistent density.                       |
| 5         | Error prevention                    |         3 | Human review and uncertainty labels are clear.                                       |
| 6         | Recognition rather than recall      |         3 | Counts and labels aid discovery; secondary grouping controls were too prominent.     |
| 7         | Flexibility and efficiency          |         3 | Section runs, filters and batch actions support researchers.                         |
| 8         | Aesthetic and minimalist design     |         2 | The Issues pane exposes too many controls before findings.                           |
| 9         | Error recovery                      |         3 | Findings can be reviewed, dismissed and revisited.                                   |
| 10        | Help and documentation              |         2 | Explanatory copy exists, but the dense control area makes it easy to overlook.       |
| **Total** |                                     | **27/40** | **Acceptable; near the top of the band.**                                            |

## Anti-patterns verdict

The interface does not read as AI-generated. Its restrained palette, paper-specific language and evidence-linked workflow fit the research task. The main problem was control density and inconsistent spacing, not decoration.

The deterministic scan reported 8 `side-tab` warnings across 7 files: `evaluate/review.module.css:94`, `evaluate/syntax.module.css:56`, `extraction/extraction.module.css:533`, `paper-import/argument.module.css:115`, `paper-import/page.module.css:831` and `:1025`, `paper-import/profile.module.css:67`, and `shared/ui/ui.module.css:587`. These are real side borders, but they mark criteria with matching icons and labels and do not cause the reported control crowding; they were retained in this spacing-focused pass.

No browser overlay was available. CUA reported that its browser access host was unavailable, and its Edge attempt stopped because the current URL could not be verified. The visual review therefore uses the supplied screenshot and source inspection.

## Overall impression

PaperLab has a clear task-oriented foundation and strong evidence traceability. The right-hand analysis pane was the main opportunity: group secondary filters, increase separation between actions, and make result headers easier to scan.

## What's working

- The paper is split into reading and analysis surfaces, which preserves source context while reviewing findings.
- Findings carry criterion, status and source information; decisions remain with the researcher.
- The shared token and component system gives a consistent basis for spacing fixes across modules.

## Priority issues

1. **[P2] Filter stack overwhelms the Issues pane.** Criterion and status chips, grouping, section selection and the section-by-criterion matrix appeared together before results. This delays the content the researcher came to inspect. Grouping and section selection now sit behind “Tuỳ chọn lọc và nhóm”; chip spacing is wider. Suggested command: `$fk space`.
2. **[P2] Narrow paper navigation wrapped into several rows.** Five paper/analysis tabs plus separate space links consumed vertical space and made the active destination harder to scan. The tab strip now scrolls horizontally and the space links have their own separated row. Suggested command: `$fk responsive`.
3. **[P2] Automated-check cards lacked a stable header.** Status and calibration badges sat beside the title without a clear grouping, especially difficult with long labels. The card now uses a wrapping title/status header and separates calibration metadata. Suggested command: `$fk space`.
4. **[P2] A display checkbox competed with the run action.** “Ẩn mục chưa đáng tin” and “Chạy kiểm tra” shared one action row despite serving different purposes. The checkbox now sits in a separate filter row. Suggested command: `$fk space`.

## Persona red flags

- **Alex, power user:** the pre-fix Issues controls required scanning multiple adjacent groups before reaching findings. Secondary controls are now disclosed, while common criteria/status filters remain visible.
- **Sam, keyboard and screen-reader user:** no specific keyboard blocker was confirmed in source; `details/summary` and labeled filter groups remain semantic controls. Live keyboard and 200% zoom behavior could not be checked because the browser surface was unavailable.

## Minor observations

- Shared action and filter gaps increased from 8px to 12px; this affects action groups across the app.
- The horizontal tab strip is intentionally scrollable on narrower layouts; browser-level touch behavior still needs a live check.
- No source-only spacing concern was found with the Firebase/auth header in the screenshot.

## Questions to consider

- Should criteria filters remain visible by default for frequent reviewers, or should they join the advanced disclosure on narrow screens?
- Would a compact, single filter summary help researchers return to the same filter state across papers?
