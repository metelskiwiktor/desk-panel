# Desk Panel Task Workflow

You are the executor. Follow the sequence in your workflow prompt exactly.

Models (`.ai/cezar/workflows/desk-panel-task.yaml`): `implement`, `fix` and `address` run on `codex` (`gpt-6.1-terra`, the
user's Codex subscription; `fix` and `address` continue the `implement` session), `review` on `agy` (`claude-opus-5-5-low`). A
step's own runner and model win over the run's, so the dispatch card lists these pinned steps with their own runner and
model choice for that one task (Cezar's `stepOverrides`, spec `2026-10-28-step-overrides` in the cezar repo; `fix` and
`address` follow `implement`, so its session stays on one runner); the card's general choice reaches the other steps. Gemini 3.8 Flash judged worst in the dispatcher benchmarks of 28.10.2026 (docs/hermes.md, "Model").

## Efficiency & Tool Rules
- **Absolute worktree paths**: Always pass full absolute paths inside your current worktree to `read_file`, `view_file`, `edit_file`, and `write_file`.
- **Full-file reads**: Omit `StartLine`/`EndLine` on `read_file` unless a file exceeds 500 lines.
- **Multi-line edits**: Files in the worktree are normalized to LF (`\n`) in `prepare`. Batch contiguous changes into a single `edit_file` call per block instead of editing line-by-line.
- **Targeted tests during implementation**: Run only the touched test file(s) and `npm run typecheck` during Phase 2 (`npx vitest run <test-file> && npm run typecheck`); the automated `verify` step runs the full test suite and build after you finish.

## Phase 1 — Prepare Scenario Data & Capture Baseline Screenshot (UI tasks ONLY)
If Type is `UI` (and Scenario is not `none`):
1. First check `scenarios/<scenario>.json`: if the existing scenario item does not clearly expose the problem/case from the task (e.g. a short 1-sentence string when the task is about truncated long emails), update `scenarios/<scenario>.json` first using fields valid on `main` so the old UI clearly shows the "before" problem state.
2. For any new or modified workspace tile (`smart-actions`, `bank`, `todo`, `system`, `mail`, `cezar`, or `<kind>`), pass `--open tile:<kind>` so `.ai/scenario.ts` showcases the tile at `2x2` on `after.png` without modifying `autoTiles` in `src/Workspace.tsx`.
3. Capture baseline screenshot BEFORE editing any code in `src/` or `server/`, using `.ai/scenario.ts` (so relative imports load this worktree's `server/` and `src/`):
```powershell
Set-Location "<worktree-abs-path>"
npx tsx .ai/scenario.ts <scenario> --shot --pages <page> --device medialove-14 --scale primary --open <open-target> --file .ai/screenshots/before.png
```
**Multiple views/pages/breakpoints**: When changes span across multiple views, pages, or breakpoints, capture a baseline before screenshot for EACH affected view/page/breakpoint using `--file .ai/screenshots/before-<view>.png` (e.g. `before-pulpit.png`, `before-zadania.png`, `before-mobile.png`). For single-view tasks, default `before.png` remains standard.

## Phase 2 — Implement & Targeted Check
- Implement the required changes in `src/`, `server/`, `scenarios/`, or `docs/`.
- Do NOT add optional workspace tiles to `autoTiles(...)` in `src/Workspace.tsx` (that breaks `src/Workspace.test.tsx` and `src/pulpits.test.tsx`).
- In `1x1` tiles (`~195px` wide on `medialove-14`), use `flex-wrap: wrap` so item titles have their own full-width line instead of getting crushed into `...` between badges and action buttons.
- Add/update tests and run `npx vitest run <new-and-affected.test.ts>; npm run typecheck`.

## Phase 3 — After Screenshot & Visual Inspection (UI tasks ONLY)
1. If Type is `UI`, run the matching `.ai/scenario.ts` command(s) outputting to `.ai/screenshots/after.png` (or `.ai/screenshots/after-<view>.png` for each affected view/page/breakpoint when changes span across multiple views).
2. Call `read_file` on each captured screenshot pair in `.ai/screenshots/` (e.g. `before.png` + `after.png`, or `before-<view>.png` + `after-<view>.png`) and verify all three:
   - **Prominence**: the target modal or tile (`--open tile:<kind>`) is prominently visible.
   - **Contrast**: before and after screenshots clearly show the before/after difference.
   - **Legibility**: titles, labels, and values inside the changed UI are genuinely readable (not crushed into `...` ellipsis or cut off).

## Phase 4 — Commit
- Stage only code/test/doc changes (never `.ai/` or `output/`), commit on the task branch, verify `git status --porcelain` is empty, and end your final message with `CEZ:DONE`.

## Phase 5 — Automated Verify, Pre-PR Review & PR Creation (handled by Cezar)
1. **`verify`**: Runs `npm test`, `npm run build`, checks `git status --porcelain`, and saves `.ai/diff.patch` (loops back to `fix` up to 2 times on failure).
2. **`review`**: A fresh `agy` (`claude-opus-5-5-low`, another model family than the code's author) reviewer session inspects `.ai/diff.patch` and changed files without re-running the test suite, and emits `CEZ:VERDICT approve` or `CEZ:VERDICT changes` (for real `P0`/`P1`/`P2` issues).
3. **`address` (if `changes`)**: Re-opens the `implement` session (`max: 1` round) to fix the reported `P0`/`P1`/`P2` issues, re-capture `after.png` if UI changed, and re-run `verify`.
4. **`pr` + `screenshots-comment` + `review-comment`**: Opens the PR ready for review, attaches all before/after screenshots in `.ai/screenshots/` (`scripts/pr-screenshots.mjs`), and posts the pre-PR review summary on the PR.
