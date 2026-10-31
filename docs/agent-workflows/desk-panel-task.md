# Desk Panel Task Workflow

You are the executor. Follow the sequence in your workflow prompt exactly. The reusable brief shape is
[executor-brief.md](executor-brief.md).

General Wektor frontend ownership and browser checks are in [wektor-ui.md](../wektor-ui.md). The procedure below is for
a Cezar executor; it does not prescribe commits, deployment or service restarts for an ordinary GUI task outside that workflow.

Models (`.ai/cezar/workflows/desk-panel-task.yaml`): `implement`, `fix` and `address` run on `opencode` (`openrouter/deepseek/deepseek-v4.1-flash-1017`,
Wektor's model, since 30.10.2026 to keep the Codex subscription free), `review` on `agy` (`gemini-3.8-flash-high`, another model family). OpenCode
cannot resume a session, so `fix` and `address` run as fresh sessions: each prompt embeds the original task and requires reading
`.ai/executor-summary.md` and `docs/agent-workflows/executor-brief.md` before editing. `session.continue: implement` stays as metadata so the dispatch
card keeps `fix` and `address` with `implement`'s pinned runner and model. The local CLI for the writing steps is
`scripts/executor-run.mjs` (`just executor-run <brief>`); it always uses that one DeepSeek model. A
step's own runner and model win over the run's, so the dispatch card lists these pinned steps with their own runner and
model choice for that one task (Cezar's `stepOverrides`, spec `2026-10-28-step-overrides` in the cezar repo; `fix` and
`address` stay with `implement` for the card); the card's general choice reaches the other steps. Gemini 3.8 Flash judged worst in the dispatcher benchmarks of 28.10.2026 (docs/hermes.md, "Model"); the pre-PR review nevertheless runs on the high variant since 31.10.2026 because its scope/race checklist, not raw coding, is the job.

## Prepare (`scripts/executor-prepare.mjs`, `just executor-prepare`)

- No reset, clean, normalization or `git rm --cached`: the agent's work belongs to the worktree.
- Own `node_modules` installed by `npm ci --prefer-offline --no-audit --no-fund` with npm's shared cache. A repeat run
  reuses the installation only when `node_modules/.desk-panel-dependencies` (scripts/dependencies.mjs) proves this
  lockfile and the expected binaries exist; otherwise it installs again (10-minute bound). On timeout the whole owned
  process tree (the Windows shell and the npm children below it) is terminated, so no install keeps running after prepare
  refused. A linked/junctioned `node_modules` is removed as a link and never traversed into; the target checkout is untouched.
- Pins the base commit in `.ai/executor-base.json`; `--reset-base` moves it deliberately (the workflow never passes it), so
  every diff and review below is against the state before the run, not `HEAD`.
- Creates `.ai/screenshots/`. The scenarios are run from the real `scripts/scenario.ts`; copying helpers into `.ai` is
  unnecessary (its `../src` imports would be wrong) and is not done.
- Ordinary commands keep `scripts/ensure-deps.mjs` (`just check`, `just screenshots`): outside the executor it may link the
  main checkout's `node_modules` when the lockfile matches. In an executor worktree prepare already installed an own copy,
  so ensure-deps finds it and does nothing; the review/verify steps never use a linked installation.

## Efficiency & Tool Rules

- **Absolute worktree paths**: Always pass full absolute paths inside your current worktree to `read_file`, `view_file`, `edit_file`, and `write_file`; never a path in the parent checkout.
- **Full-file reads**: Omit `StartLine`/`EndLine` on `read_file` unless a file exceeds 500 lines.
- **Multi-line edits**: Preserve each file's existing line endings. Batch contiguous changes into a single `edit_file` call per block instead of editing line-by-line.
- **Read first**: the area document from `AGENTS.md`, the production modules you will change, and the complete affected tests/fixtures/scenarios — before the first edit.
- **Targeted tests during implementation**: Run only the touched test file(s) and `npm run typecheck` during Phase 2 (`npx vitest run <test-file>; npm run typecheck`); the automated `verify` step runs `just check` after you finish.
- **Scope**: change only what the goal needs. Stop and report an unexpected dependency, module or credential instead of widening the change. Wektor memory/preamble, Cezar, credentials and provider selection are out of scope unless the task says otherwise (executor-brief.md).

## Phase 1 — Prepare Scenario Data & Capture Baseline Screenshot (UI tasks ONLY)
If Type is `UI` (and Scenario is not `none`):
1. First check `scenarios/<scenario>.json`: if the existing scenario item does not clearly expose the problem/case from the task (e.g. a short 1-sentence string when the task is about truncated long emails), update `scenarios/<scenario>.json` first using fields valid on `main` so the old UI clearly shows the "before" problem state.
2. For any new or modified workspace tile (`smart-actions`, `bank`, `todo`, `system`, `mail`, `cezar`, or `<kind>`), pass `--open tile:<kind>` so `scripts/scenario.ts` showcases the tile at `2x2` on `after.png` without modifying `autoTiles` in `src/Workspace.tsx`.
3. Capture baseline screenshot BEFORE editing any code in `src/` or `server/`, using this worktree's real scenario runner:
```powershell
Set-Location "<worktree-abs-path>"
npx tsx scripts/scenario.ts <scenario> --shot --pages <page> --device medialove-14 --scale primary --open <open-target> --file .ai/screenshots/before.png
```
**Multiple views/pages/breakpoints**: When changes span across multiple views, pages, or breakpoints, capture a baseline before screenshot for EACH affected view/page/breakpoint using `--file .ai/screenshots/before-<view>.png` (e.g. `before-pulpit.png`, `before-zadania.png`, `before-mobile.png`). For single-view tasks, default `before.png` remains standard.

## Phase 2 — Implement & Targeted Check
- Implement the required changes in `src/`, `server/`, `scenarios/`, or `docs/`; update the area document that the change alters.
- Do NOT add optional workspace tiles to `autoTiles(...)` in `src/Workspace.tsx` (that breaks `src/Workspace.test.tsx` and `src/pulpits.test.tsx`).
- In `1x1` tiles (`~195px` wide on `medialove-14`), use `flex-wrap: wrap` so item titles have their own full-width line instead of getting crushed into `...` between badges and action buttons.
- Add/update tests and run `npx vitest run <new-and-affected.test.ts>; npm run typecheck`. For race, migration or idempotence behaviour, prove red→green.
- Write `.ai/executor-summary.md` (changed paths, what was read first, commands/results, risks, no commit/push) and `.ai/commit-message.txt` (one conventional English subject, no attribution). Leave the changes uncommitted by you: Cezar autosaves at turn end, and verify diffs against the pinned base, so the work is reviewable either way.

## Phase 3 — After Screenshot & Visual Inspection (UI tasks ONLY)
1. If Type is `UI`, run the matching `scripts/scenario.ts` command(s) outputting to `.ai/screenshots/after.png` (or `.ai/screenshots/after-<view>.png` for each affected view/page/breakpoint when changes span across multiple views).
2. Call `read_file` on each captured screenshot pair in `.ai/screenshots/` (e.g. `before.png` + `after.png`, or `before-<view>.png` + `after-<view>.png`) and verify all three:
   - **Prominence**: the target modal or tile (`--open tile:<kind>`) is prominently visible.
   - **Contrast**: before and after screenshots clearly show the before/after difference.
   - **Legibility**: titles, labels, and values inside the changed UI are genuinely readable (not crushed into `...` ellipsis or cut off).

## Phase 4 — No commit by the executor
The executor never commits, pushes, opens a PR or dispatches Cezar. Its `CEZ:DONE` is the end of the implementation turn;
Cezar may checkpoint the worktree in a `cezar autosave (turn end)` commit before the next step. Such checkpoints are part
of Cezar's own work in progress and are not the publication: they do not wait for `just check`, and the final commit below
is the only one gated on it.

## Phase 5 — Automated Verify, Review, Deterministic Commit & PR (handled by Cezar)
1. **`prepare`**: `scripts/executor-prepare.mjs` (above). A failed prepare stops the run as failed; it never starts an implement turn.
2. **`verify`**: runs `just check` (tests, typecheck, knip, build) and then `node scripts/executor-commit.mjs --diff`, which saves the complete diff against `.ai/executor-base.json` (untracked files included; ignored artifacts such as `.ai/**` outputs and `output/` stay out, while tracked `.ai/cezar/workflows/**` is reviewed like any other file) to `.ai/diff.patch`. There is no empty-diff `|| true` fallback; a failure to capture fails the step. Loops back to `fix` up to 2 times.
3. **`review`**: a fresh `agy` `gemini-3.8-flash-high` reviewer session reads `.ai/diff.patch` and the changed files without re-running the suite, checks scope, races, migrations, idempotence, contract/fixture parity and (for UI) the screenshot pairs, and emits `CEZ:VERDICT approve` only when there is no `P0`/`P1`/`P2` issue. The node pins `allowedTools: [Read, Glob, Grep]`, which makes Cezar's `isReadOnlyTools()` switch AGY into read-only isolation with no `--dangerously-skip-permissions` and a workspace mutation guard; the prompt also restricts it to `read_file`, `list_dir`, `grep_search` and `find_by_name` and forbids native `run_command`/terminal/node/PowerShell/bash even for a read-only reproduction, tests, scratch repos or any file write anywhere. A denied tool, a missing verdict or an aborted review is an execution failure, never `approve` and never a code-change request. This is a guard, not an OS sandbox: it cannot undo an effect a provider reports after execution. One `address` round may follow (`max: 1`); an exhausted review ends the run as failed and publishes nothing.
4. **`commit`**: a deterministic check node (`node scripts/executor-commit.mjs`). It refuses if the worktree changed after verify/review, then commits exactly the reviewed paths with the conventional English subject from `.ai/commit-message.txt` and no attribution (fallback `chore(task): apply desk-panel task changes`). Cezar may already have checkpointed that diff in `cezar autosave` commits on an isolated, unpublished linked task branch; the node collapses only those onto the pinned base, and is a no-op when the exact reviewed tree is already one final conventional commit. It never rewrites `main`/`master`, a non-worktree checkout, a published head or unrelated commits: there it commits the reviewed paths on top and leaves existing history alone. It runs only after `just check` passed and the review approved.
5. **`pr` + `screenshots-comment` + `review-comment`**: opens the PR ready for review, attaches all before/after screenshots in `.ai/screenshots/` (`scripts/pr-screenshots.mjs`), and posts the pre-PR review summary on the PR.

Permission allow in `scripts/executor-run.mjs` is autonomy, not a sandbox: the writing steps can reach this user's files, network and credentials, with `question` and `task` denied. The review's `allowedTools` pin is a read-only guard, not an OS sandbox either. Cezar's check nodes (prepare, verify, commit) are the only steps that write git state.
