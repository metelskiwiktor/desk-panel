# Lokalny pilot ewaluacji wykonawcy Cezara

`scripts/cezar-eval.mjs` odtwarza lokalnie dozwolone kroki workflow `.ai/cezar/workflows/desk-panel-task.yaml` dla zamrożonego przypadku H2. Nie uruchamia procesu Cezara. Właściwy workflow Cezara wykonuje autosave po turze oraz ma obowiązkowe węzły commit i PR, których nie można wyłączyć; lokalny adapter kończy się po review i ewentualnej rundzie poprawek.

## Polecenia

```powershell
just cezar-eval freeze --source C:/t/hcal --suite C:/Users/Viktor/.role-evals/cezar/TABL-2-H2-v4
just cezar-eval validate --suite C:/Users/Viktor/.role-evals/cezar/TABL-2-H2-v4
just cezar-eval run --dry-run --suite C:/Users/Viktor/.role-evals/cezar/TABL-2-H2-v4
just cezar-eval run --suite C:/Users/Viktor/.role-evals/cezar/TABL-2-H2-v4 --trials deepseek-r1,codex-r1,deepseek-r2,codex-r2
just cezar-eval report --suite C:/Users/Viktor/.role-evals/cezar/TABL-2-H2-v4
```

`freeze` creates a new version directory and refuses to overwrite one. It creates missing suite parents, rejects overlap with the fixture tree or repository, and stores the H2 brief, source manifest, hidden acceptance file, workflow, support scripts, runner and adapter snapshots with SHA-256 hashes. `validate` checks every frozen file and confirms the current executable/tooling still matches the snapshot. It then validates baseline/reference in isolated shallow repositories; reference objects are absent from the baseline checkout.

`run --dry-run` validates baseline/reference and reports the four planned runs without a model call. `run` starts only the requested `--trials` serially: DeepSeek from the workflow via OpenCode and Codex `gpt-6.1-sol` at high reasoning, each twice. The reviewer stays Agy `gemini-3.8-flash-high`. Saved completed attempts are reused. Existing partial attempts are preserved and skipped; there are no automatic retries, so a deliberate rerun uses a new suite version. A failed attempt does not block later selected trials. `report` recomputes from saved JSON and raw process logs, including interrupted progress and partial metrics.

Do not run the real `run` command until the user requests the four trials. Test commands and `just check` are deterministic and do not call a model.

## Isolation and workflow

Each trial starts in a temporary shallow Git repository outside the suite directory. It contains exactly one commit, the H2 base; the opposite reference commit is checked to be absent from its object database. The evaluated CLI receives only the H2 brief and the workflow prompt rendered from the frozen YAML. Codex receives the complete prompt over stdin; Agy receives its documented `stream-json` user envelope over stdin; OpenCode reads the prompt from a private artifact file, keeping Windows command lines short. Codex's final response file and Agy/OpenCode JSONL response and usage are preserved.

The support scripts and executor brief template required by this historical checkout are snapshotted and excluded from its diff. Review runs in a separate temporary copy without `.git`, commit history, reference objects, installed dependencies, or the hidden acceptance file. After the model returns, the harness compares a before/after file snapshot and rejects any reviewer mutation; it then deletes that copy. Only after all implementer and reviewer activity ends does the harness stage the hidden test in the evaluated checkout, record its JSON and raw output outside that checkout, remove only the staged test, confirm the product diff is unchanged, and delete the temporary repository. Acceptance results never feed back into a model prompt.

The adapter reads implement/fix/address/review prompts, runner/model, retry limits, node timeouts and graph transitions from the frozen workflow. Nodes without an explicit timeout use a 30-minute wall and 4-minute idle limit. Verify and review retries follow their workflow limits; exhausted loops fail closed. DeepSeek keeps the workflow's default reasoning. Only implement/fix/address changes to Codex, using `gpt-6.1-sol` with high reasoning. Reviewer `allowedTools` must remain exactly `Read`, `Glob`, and `Grep`; Agy runs in plan mode with sandbox restrictions. The separate review copy and mutation check protect the evaluated worktree, but both CLIs still run under the same Windows user and are not an operating-system security boundary.

The local runner filters child environments through an allow-list and never forwards `DESK_*`, API keys, tokens, passwords, suite paths, or other unapproved environment variables. CLI authentication remains in the CLI's own local store. The harness installs a Git reference-transaction guard inside the temporary repository and does not run workflow commit or PR nodes. It never dispatches Cezar, writes to Fila, changes a task, or touches a service. The checkout and context are kept separate from the suite; OpenCode still runs as the same Windows user, so this is not an operating-system security boundary against arbitrary shell commands.

## Evidence and interpretation

The suite and trial directories live outside Git at the requested `.role-evals/cezar` path. Each child action has an invocation record, raw stdout/stderr byte logs, hashes, exit status, duration and any machine-reported token/cost usage. Errors, timeouts and the current workflow phase are saved before the next trial starts. Missing usage, incomplete totals, unreported assertions and subscription cost are shown as `N/D` or explicitly partial; they are never counted as zero. Repeated-case agreement is `N/D` until both runs contain complete case results. Failure attribution cites the saved diff and logs and stays unresolved unless evidence determines the cause.

This pilot contains one task with four assertions and two repeats per implementer. It measures repeatability on these same assertions, not a general quality threshold or proof that a role is fully tuned. Baseline and reference results are part of the frozen validation evidence. Hidden acceptance results are never sent to an implementer or reviewer and are not used for fixes.
