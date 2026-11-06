# Brief UI-DS — Bring the whole UI onto the design system

Developer: Codex. Acceptance: Claude. Branch: `fix/ui-design-system` (already checked out).

Rules: work only in this repo; no commit/push; **no new dependencies**; write files with the patch tool as UTF-8
without BOM + LF (never PowerShell `Set-Content`/`Out-File`/`>`); keep Vietnamese diacritics; never read or print
`.env.development.local`. Behaviour must not change: every existing test keeps passing (update selectors only
where markup changes, never weaken assertions).

Read first: `DESIGN.md` (all), `AGENTS.md`, `src/app/theme.css`, `src/shared/ui/*`, every `*.module.css`, the
pages in `src/modules/*` and `src/app/*`.

## Audit findings (Claude, 2026-11-06)

Measured in the browser (Settings, History, Transfer, Evaluate; light and dark) and in the code:

1. **No design tokens beyond colours.** Spacing, radius, type sizes, control heights and shadows are raw values,
   many off the 4 px scale (`gap: 10px`, `padding: 3px 7px`, `7px 9px`, `18px`, `2px 5px`), font sizes mix px and
   rem (`0.8rem`, `0.85rem`, `13px`, `14px`, `11px`, `10px`).
2. **No component variants.** `Button` has one style, so modules hand-roll a filled primary (`.primary` in
   `review.module.css`), text buttons, filter chips and a segmented control. On Evaluate alone the browser shows
   9 different control heights (23, 24, 25, 33, 34, 35, 37, 38, 51 px) and 3 radii (0, 6, 999).
3. **Raw native controls in modules**, against DESIGN §4 ("no one-off styled buttons in modules"): `<button>` in
   `evaluate/Page.tsx`, `ReviewWorkspace.tsx`, `app/App.tsx`, `CommandPalette.tsx`, `Sidebar.tsx`; an unstyled
   native `<select>` (radius 0, grey border `#767676`) for severity; a native checkbox for "Ẩn độ tin cậy thấp";
   unstyled `<input>` / `<textarea>` in Settings, Transfer and Evaluate; the theme `<select>` in the top bar.
4. **Buttons default to `type="submit"`** (no `type` set anywhere), a bug risk inside forms (Settings).
5. **Heading hierarchy**: page `h1` 25 px vs panel `h2` "Gợi ý" 24 px; no type scale.
6. **Shadows on non-overlays** (expanded suggestion card) although DESIGN §4 says shadows only on overlays.
7. **Hard-coded colours** outside the theme: scrims `#0008`, shadows `#0004`/`#0003` (`shell.module.css`,
   `ui.module.css`); no semantic tokens for danger / success / warning / scrim.
8. **Status shown with text glyphs** (`○`, `✓`) instead of `lucide-react` icons + `Badge`.
9. **DESIGN §4 components missing**: `Toast` (save / copy feedback), form fields; `Tooltip` only opens to the
   right.
10. **Dead code**: `src/modules/evaluate/CandidateList.tsx` is no longer used.

## 1. Tokens — `src/app/theme.css` (light, `prefers-color-scheme: dark`, `[data-theme='dark']`)

- Spacing (4 px scale): `--space-1: 4px` … `--space-2: 8px`, `--space-3: 12px`, `--space-4: 16px`,
  `--space-5: 20px`, `--space-6: 24px`, `--space-8: 32px`, `--space-10: 40px`.
- Radius: `--radius-sm: 4px`, `--radius: 6px` (controls), `--radius-lg: 10px` (cards), `--radius-pill: 999px`.
- Type: `--font-ui` (Inter), `--font-reading` (Source Serif 4), `--font-mono` (JetBrains Mono);
  `--text-xs: 12px` (minimum anywhere), `--text-sm: 13px`, `--text-base: 15px`, `--text-md: 16px`,
  `--text-lg: 18px`, `--text-xl: 20px`, `--text-2xl: 24px`; reading text stays 17 px / 1.7
  (`--text-reading`). Global: `h1` = 2xl/700, `h2` = xl/600, `h3` = md/600, body = base/1.5.
- Controls: `--control-h: 36px`, `--control-h-sm: 28px`.
- Semantic colours with dark variants: `--danger`, `--success`, `--warning`, `--scrim`
  (e.g. `color-mix(in srgb, #000 50%, transparent)`), `--shadow-overlay`. Keep the existing palette and
  `--hl-*` tokens; `--soft` stays (document it).
- After this slice, **no hex/rgb colour outside `theme.css`** and every padding / margin / gap / radius /
  font-size in CSS modules uses a token (or `0`, `1px`, `2px`, `3px` for borders/underlines, `%`, `ch`, `fr`).

## 2. Shared components — `src/shared/ui/`

- `Button`: `variant: 'primary' | 'secondary' | 'ghost' | 'danger'` (default secondary), `size: 'md' | 'sm'`
  (`--control-h` / `--control-h-sm`), **default `type="button"`**, visible focus ring, disabled style,
  optional leading icon.
- `IconButton`: required `label` → `aria-label` + `Tooltip`; sizes md/sm.
- `TextField` (label, optional hint, error with `aria-describedby`/`aria-invalid`, `multiline` → textarea),
  `Select` (styled native select with label), `Checkbox`, `SegmentedControl` (`role="radiogroup"` /
  `radio`, `aria-checked`, arrow keys), `Chip` (toggle with `aria-pressed`, optional count).
- `Badge`: `tone: 'neutral' | 'accent' | 'success' | 'warning' | 'danger'`, optional icon.
- `Toast` (`role="status"`, auto-dismiss, one provider in `App`), used for "Đã lưu", "Đã sao chép gợi ý",
  import/export results.
- `Tooltip`: `placement: 'top' | 'right'` (default top), also on keyboard focus.
- `Card`: `padding: 'md' | 'lg'`.
- Small unit tests per component (roles, aria, default `type="button"`, keyboard for SegmentedControl).

## 3. Migrate every page

- Replace all raw `<button>`, `<select>`, `<input>`, `<textarea>` in `src/modules/**` and `src/app/**` with the
  shared components (file input in Transfer may stay native but visually hidden behind a `Button`).
- Enforce it: ESLint `no-restricted-syntax` for JSX elements `button|select|input|textarea` in
  `src/modules/**` and `src/app/**` (message: "Dùng component trong src/shared/ui"). `src/shared/ui/**` is
  exempt.
- Evaluate: toolbar buttons (`Phân tích câu (AI)` primary only when it is the next step, others secondary);
  review panel uses `Tabs`, `Chip` for categories, `SegmentedControl` for `Tất cả | Đã xác nhận | Ứng viên`,
  `Checkbox` for low confidence, `Select` size sm for severity, `Button` primary sm "Xác nhận", ghost sm "Bỏ
  qua", `IconButton` "Sao chép gợi ý" (+ Toast). Status via `Badge` + lucide icon (`CircleDot` candidate,
  `Sparkles` AI problematic, `CheckCircle2` confirmed, `XCircle` dismissed, `MinusCircle` AI acceptable).
  Expanded card: no shadow; border + 3 px category accent + `--soft` background.
- Settings / History / Transfer / top bar / command palette / sidebar: same components; consistent card
  padding, section spacing `--space-6`, field spacing `--space-4`.
- Delete `CandidateList.tsx` (and anything only it used).

## 4. Guard test

Add `src/app/designTokens.test.ts` that reads every `src/**/*.module.css` (Node `fs`) and fails on: hex/rgb/hsl
colours; font-size not a token; padding / margin / gap / border-radius values in px other than `0`, `1px`,
`2px`, `3px` (unless via `var(--…)`). Name it `design system: CSS modules use tokens`.

## 5. Docs

Update `DESIGN.md` §4 with the token table, the component list with variants, the lint rule and the guard test.

## 6. Definition of done

`npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run test:cov`, `npm run build` pass. Report:
files changed, test counts, command results, anything not done.
