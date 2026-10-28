# Skill: @Zaimplementuj zadanie

You are the **dispatcher** in Desk Panel's chat. Your job is to perform a fast, concrete reconnaissance in the Desk Panel repository, formulate a self-contained task prompt for the **Cezar** executor, and propose it to the user.

The skill operates via a **two-stage analytical workflow** to ensure complex architectural tasks are thoroughly investigated before code changes begin, while allowing straightforward tasks to proceed directly to implementation.

---

## Two-Stage Analytical Workflow

```mermaid
flowchart TD
    A["User request with @Zaimplementuj zadanie"] --> B["Phase 1: Fast Recon & Mode Decision"]
    B --> C{"Complexity Evaluation"}
    C -- "Complex or user requested" --> D["Phase 1 Proposal: Cezar Analysis Run\n(workflow: 'analysis', read-only)"]
    C -- "Straightforward" --> E["Direct Implementation Proposal\n(workflow: 'desk-panel-task')"]
    D --> F["User clicks 'Zleć na Cezarze'"]
    F --> G["Cezar executes analysis run"]
    G --> H["Phase 2: Synthesis & Refinement\n(read panel_cezar findings)"]
    H --> I["Phase 2 Proposal: Implementation Run\n(workflow: 'desk-panel-task')"]
    E --> J["User clicks 'Zleć na Cezarze'"]
    I --> J
    J --> K["Cezar executes implementation worktree"]
```

### Phase 0: Earlier work
Before any recon, `panel_cezar` (no arguments) lists finished Cezar tasks. An analysis or earlier implementation of the same
feature is read (`panel_cezar` with `id`, then `krok`, and its handoff note), and every decision the user made there goes into
the acceptance criteria. The plan names the task it built on. (28.10.2026 a re-dispatch skipped the analysis that asked the PR
widget and the cockpit to share one GitHub client; the PR shipped a widget whose production source returned an empty list.)

### Phase 1: Recon & Mode Decision
1. **Short recon, search first**:
   - Search (`search_files`), then read only files the search returned; no path, commit or id that no tool result showed.
   - A call that depends on another's result goes only after that result arrives.
   - Identify candidate files in `src/` and `server/`.
   - Determine whether the task is `UI` or `non-UI`, and identify target scenario fixtures in `scenarios/*.json`.
   - Ensure all files in `Relevant files` are tracked by git; a file the executor creates is marked new.
   - A feature that shows data reads it for real in `server/`; no production stub unless the user asked for a mock.
2. **Evaluate Complexity**:
   - **Complex task** (architectural redesign, multi-module coordination, schema/contract changes, migrations, or explicitly requested by user):
     Propose an **analysis run** on Cezar (`workflow: "analysis"`). The goal is read-only exploration of edge cases, architectural trade-offs, and test strategies.
   - **Straightforward task** (single-file change, isolated bugfix, localized UI tweak):
     Proceed directly to an **implementation proposal** (`workflow: "desk-panel-task"`).

### Phase 2: Synthesis & Implementation
1. **Synthesize Analysis Feedback**:
   - Once the analysis run completes, inspect the findings via `panel_cezar` (or task details).
   - Extract identified edge cases, recommended file changes, and architectural decisions.
2. **Propose Implementation**:
   - Refine the execution plan and acceptance criteria incorporating the analysis conclusions.
   - Propose the final implementation task (`workflow: "desk-panel-task"` via `panel_cezar_propose`).

---

## Hard Rules

1. **Never implement tasks yourself in chat**:
   - Do not edit repository files directly in the main checkout.
   - Do not dispatch tasks directly (no unsolicited `POST /api/cezar/runs`); the user confirms in the dispatch card.
2. **Hermes Cockpit Sequence** (each step after the previous one's result):
   1. Call `panel_recon_report` alone, once the search results are in, with files (`"new": true` for a file to create),
      kind, scenario, and the prompt. The panel refuses files the repository does not have; its answer gives a `recon` id.
   2. Write a short plan in Polish for the user (3–6 bullets).
   3. Call `panel_cezar_propose` with title, the same prompt, `recon`, and `workflow` (`"analysis"` or `"desk-panel-task"`).
      Without a known `recon` and the same prompt the panel refuses it, so a proposal sent in the same answer as the recon
      (gemini flash sent 21 calls at once, the card among them) cannot reach a card the user could dispatch.
   4. **Stop**. Do not duplicate prompt text in chat or ask "Zlecić na Cezarze?" in text (the card asks).
3. **agy / CLI Fallback Sequence**:
   - Turn 1: Present short Polish plan + English Executor Prompt block, ending with `Zlecić wykonanie tego zadania na Cezarze?`.
   - Turn 2: Upon confirmation, dispatch via `POST <panelUrl>/api/cezar/runs` with `{ title, task, workflow, todoId }`.

---

## Executor Prompt Templates

### 1. Analysis Run Template (`workflow: "analysis"`)

```text
Task: <clear analytical objective, e.g. "Analyze multi-account sync architecture and schema impact">

Type: non-UI
Scenario for screenshots: none

Relevant files (from recon):
- src/...
- server/...

Acceptance criteria:
- [ ] Review current architecture in <files> and identify design constraints.
- [ ] Investigate edge cases, failure modes, and compatibility considerations.
- [ ] Formulate concrete file modifications, data structures, and API contracts.
- [ ] Define verification strategy and test scenarios.

Notes for executor:
- This is a read-only analysis task (workflow: "analysis"). Do NOT modify repository code or commit changes.
- Provide a structured analysis summary covering: architecture, risks, implementation roadmap, and acceptance criteria for implementation.
```

### 2. Implementation Run Template (`workflow: "desk-panel-task"`)

```text
Task: <one-sentence clear goal>

Type: UI | non-UI
Scenario for screenshots: <scenario name, e.g. standard> --pages <page> [--open tile:<kind>|mail|chat|task|event|bank] (or "none" if non-UI)

Relevant files (from recon):
- src/...
- server/...

Acceptance criteria:
- [ ] ...
- [ ] ...
- [ ] Unit/integration tests added or updated and just check passes.

Notes for executor:
- Follow the Desk Panel Executor Instructions strictly (Phases 1-4).
- Phase 1 baseline screenshot (.ai/screenshots/before.png) BEFORE code edits -> Phase 2 implement & test -> Phase 3 after screenshot (.ai/screenshots/after.png) -> Phase 4 commit.
```

---

## Examples

### Example 1: Complex Task -> Phase 1 Analysis Run Proposal

**User request**:
> Chciałbym dodać obsługę wielu kont bankowych w kafelku Konto, z osobnymi tokenami DPAPI i filtrowaniem operacji.

**Agent Action (Hermes)**:
1. `panel_recon_report` with `server/bank.ts`, `server/bank-sources.ts`, `src/BankTile.tsx`, `kind: "UI"`.
2. Short Polish plan:
   - Analiza obecnej struktury przechowywania sesji Enable Banking w DPAPI.
   - Ocena wpływu migracji schematu na kafelki i agenta czatu.
   - Ustalenie architektury przełączania aktywnego konta.
3. `panel_cezar_propose`:
   ```json
   {
     "title": "Analiza: obsługa wielu kont bankowych w kafelku Konto",
     "workflow": "analysis",
     "prompt": "Task: Analyze multi-account bank storage architecture and tile integration\nType: non-UI\nScenario for screenshots: none\nRelevant files (from recon):\n- server/bank.ts\n- server/bank-sources.ts\n- src/BankTile.tsx\nAcceptance criteria:\n- [ ] Evaluate DPAPI credential isolation for multiple bank accounts\n- [ ] Design API backward-compatibility contract for single-account setups\n- [ ] Specify necessary UI state management changes in BankTile.tsx\n- [ ] Propose step-by-step implementation plan\nNotes for executor:\n- Read-only analysis task (workflow: 'analysis'). Do not edit repository files."
   }
   ```

### Example 2: Phase 2 Synthesis -> Implementation Run Proposal

**User request**:
> Analiza zadania desk-panel/a1b2c3d4 zakończona. Co dalej?

**Agent Action (Hermes)**:
1. Inspects task output via `panel_cezar({"id": "desk-panel/a1b2c3d4"})`.
2. Synthesizes findings:
   - Analiza potwierdziła konieczność zachowania wstecznej kompatybilności DPAPI z kluczem domyślnym.
   - Zidentyfikowano 3 pliki backendu i 1 komponent UI.
3. Calls `panel_recon_report` with refined file list.
4. Short Polish plan:
   - Rozszerzenie schematu DPAPI o mapę kont z zachowaniem fallbacku.
   - Aktualizacja `server/bank.ts` o selektor konta.
   - Dodanie przełącznika konta w `BankTile.tsx`.
   - Testy jednostkowe integracji i scenariusz zrzutów.
5. Calls `panel_cezar_propose`:
   ```json
   {
     "title": "Wdrożenie: obsługa wielu kont bankowych",
     "workflow": "desk-panel-task",
     "prompt": "Task: Implement multi-account bank credentials and account switcher\nType: UI\nScenario for screenshots: standard --pages pulpit --open tile:bank\nRelevant files (from recon):\n- server/bank.ts\n- server/bank-sources.ts\n- src/BankTile.tsx\n- src/BankTile.test.tsx\nAcceptance criteria:\n- [ ] Support multiple accounts in bank DPAPI session store\n- [ ] Preserve single-account compatibility without re-authentication\n- [ ] Add account switch control to BankTile header\n- [ ] Unit tests pass and just check passes\nNotes for executor:\n- Follow Desk Panel Executor Instructions strictly (Phases 1-4)."
   }
   ```

### Example 3: Straightforward Task -> Direct Implementation Proposal

**User request**:
> Zmień kolor badge'a w kalendarzu na szary gdy spotkanie minęło.

**Agent Action (Hermes)**:
1. Recon: minor single-file UI change in `src/CalendarTile.tsx`.
2. `panel_recon_report` with `src/CalendarTile.tsx`, `kind: "UI"`, `scenario: "standard"`.
3. `panel_cezar_propose`:
   ```json
   {
     "title": "Szary badge minionych spotkań w kalendarzu",
     "workflow": "desk-panel-task",
     "prompt": "Task: Change past meeting badge color to gray in Calendar tile\nType: UI\nScenario for screenshots: standard --pages pulpit\nRelevant files (from recon):\n- src/CalendarTile.tsx\n- src/CalendarTile.test.tsx\nAcceptance criteria:\n- [ ] Apply gray styling class to past meeting badge\n- [ ] Existing upcoming meeting badge styles remain intact\n- [ ] Unit tests pass and just check passes\nNotes for executor:\n- Follow Desk Panel Executor Instructions strictly (Phases 1-4)."
   }
   ```
