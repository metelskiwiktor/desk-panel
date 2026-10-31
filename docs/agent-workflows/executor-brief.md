# Executor brief template

A Cezar executor run reads one brief file. Copy this template, fill every section, save it outside Git when it holds
task-specific detail, and pass it to `node scripts/executor-run.mjs --brief ABS_PATH` or `just executor-run <path>`.
The `implement` step of `.ai/cezar/workflows/desk-panel-task.yaml` receives the task text in the same shape.

The brief is what the executor works from; the workflow prompt adds the fixed repository rules. A brief that leaves a
section as `none` is a decision, not an omission: write `none` explicitly.

## Goal

One paragraph: what the user gets, stated as observable behaviour. Name the area document from `AGENTS.md` ("Where
knowledge lives") that describes the area you touch, and the user request or tile it comes from.

## Baseline

- Branch/worktree and the pinned base: `scripts/executor-prepare.mjs` records it in `.ai/executor-base.json`; the brief
  names the base commit only when it matters.
- What exists today and what the run must not change about it.
- For UI work: scenario file, page, `--open` target, device/scale, and the "before" problem state.

## Allowed files

The exact paths the run may create or change, grouped by area, e.g.:

- `src/<module>.tsx`, `src/<module>.test.tsx`
- `server/<module>.ts`, `server/<module>.test.ts`
- `scenarios/<scenario>.json`, `docs/<area>.md` (the area document the change updates)

Anything outside this list is out of scope. A run that needs another file stops and says so instead of widening.

## Forbidden areas

Unless the brief explicitly requests them, the run must not touch:

- Wektor's memory and instructions: `PANEL_GUIDES`, `CHAT_SKILLS` (`src/chat-contract.ts`), `COCKPIT_TOOLS`
  (`src/cockpit-contract.ts`), the preamble (`server/hermes-chat.ts`);
- the Cezar checkout (`C:/Users/Viktor/AndroidStudioProjects/cezar`), Cezar's workflow file or its worktrees;
- service/deploy configuration, `servy/`, kiosk scripts, `just update`;
- credentials, tokens, `panel.env`, DPAPI files, `~/.desk-panel` stores, real provider calls during tests;
- provider/model selection, the service port, or any other checkout's files.

If the task names one of these, say so in the brief and quote the exact capability; then it is in scope for that run only.

## Read-first

Read before editing, in this order:

- the area document linked from `AGENTS.md` and every rule in `AGENTS.md` the change must keep;
- the production modules the change touches (whole files, not slices) and the modules that consume their exports;
- the complete affected test files and their fixtures/scenarios (`src/test-fixtures.ts`, `scenarios/*.json`) so the new
  behaviour is tested against the same API the UI reads;
- for the chat: `docs/czat.md`, `docs/hermes.md`, `docs/wektor-ui.md` as the agent-skills map says.

## Acceptance checks

State the checks that prove the goal, not the implementation:

- targeted tests (name the test files), typecheck, and the full `just check` the orchestrator runs after the run;
- UI: before/after screenshots that show the change and are legible (`scripts/scenario.ts --shot --open ...`);
- race, migration or idempotence behaviour: name the failing test first (red) and the passing test after the fix (green);
  a retried action or repeated refresh must not duplicate data, a stored shape must stay readable after the change;
- contract and documentation: the schema and the scenario fixture agree, and the area document changes in the same diff.

## Stop on

List what must stop the run instead of a broad refactor:

- a dependency, module, credential, provider or area the brief did not name;
- a failing test whose cause is outside the allowed files;
- a contract change that would need a migration the brief does not describe;
- any request to commit, push, open a PR or dispatch Cezar.

## Summary file

The run writes `.ai/executor-summary.md` (ignored, never committed; only tracked `.ai/cezar/workflows/**` is in Git) with:

- changed paths and why each changed;
- the area document, production modules, tests, fixtures and scenarios read first;
- the exact test commands and their results;
- acceptance checks and whether each passed, including the red→green proof for race/migration/idempotence;
- remaining risks/follow-ups and what the run stopped on;
- confirmation that the run made no commit, push, PR or dispatch.

It also writes `.ai/commit-message.txt`: one conventional English subject line (e.g. `fix(chat): keep the title
readable`), no attribution and no body. Cezar's deterministic commit node validates it and falls back to
`chore(task): apply desk-panel task changes` when it is missing or not conventional.

## Permissions

`scripts/executor-run.mjs` is autonomy, not a filesystem sandbox: the run can read and write this user's files, run
commands and reach the network, with `question` and `task` denied and every other tool allowed explicitly. Both the main
and small model in `OPENCODE_CONFIG_CONTENT` are pinned to the one executor DeepSeek model, so no OpenRouter model other
than that one may be called. It is told not to commit, push, dispatch or print secrets; Cezar's own checkpoints may commit
the worktree during the run, but only the final commit is gated on `just check` and review (see
[desk-panel-task.md](desk-panel-task.md)).
