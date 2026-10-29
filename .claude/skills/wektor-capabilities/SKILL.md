---
name: wektor-capabilities
description: Use when the user wants Wektor (the in-panel Hermes chat agent) to be able to do or show something new, or wants his answers about the bank improved - building the tool/card/skill lines, running test conversations against him, judging his answers with the user.
---

# Giving Wektor an ability

The user asks for an action that is hard in the panel UI (e.g. "merge these bank categories"). **We deliver, Wektor executes.** The user does not do it by hand and does not want a one-off script on his data. Wektor is Hermes Agent (DeepSeek Flash via OpenRouter) in the panel's chat; he reaches the panel only through MCP tools (`server/panel-mcp.ts`).

## Phases of a new ability

1. **Zdolnosc** (capability): we build the tool, card, guide entry, with tests. Wektor can do it; nobody knows yet what a good answer looks like.
2. **Pierwszy kontakt** (first contact): run the first cases, read his answers with the user, expect nothing yet. The user cannot say beforehand what the answer should be; he can say what he likes and dislikes once he sees it. Collect observations (what he did, what was good, what was off). This is error analysis in the usual sense: look at real outputs first.
3. **Kalibracja odpowiedzi** (response calibration): from the observations, decide with the user what a good answer is - the content, tone, length, what is shown on a card, when a card is offered or shown - and write it down as general rules (`BANK_GUIDE`, tool answers, card design). Then sharpen it over several runs and several cases. The user's expectations move as he reads more answers (this is a known effect, "criteria drift": people define what they want by reviewing outputs, and the criteria change with the prompt and the outputs; [Shankar et al.](https://arxiv.org/pdf/2404.12272)). Do not freeze expectations at phase 1.
4. **Utrwalenie** (stabilisation): turn what has become stable into `expect` checks, keep what is still judgement as `soft`, run `--runs 3-5` to see variance, add a case for every real conversation that went wrong. Re-run after any change to a tool, the preamble or a guide.

Moving between phases: `soft` = a criterion still forming; `expect` = a rule that has settled. A criterion that keeps surprising us stays `soft`. The user decides what a good answer is; I propose wording and show evidence (answers, counts over runs).

## The loop

1. **Discuss behaviour first.** How should Wektor talk, when does he act, what must he never do. Write it down as general rules, not as the answer to the case at hand.
2. **Deliver in code** (below), with tests. Commit and push to main (user's standing rule), `just update` to deploy.
3. **Restart Hermes** after any change to a tool or its schema: `just hermes RESTART`. Hermes caches the tool list from its start (a new tool is invisible until then). Standing permission, given 2026-10-29, only for this workflow. A change to the skill text or a tool's *answer* needs only the deploy.
4. **Run test conversations yourself** with the harness (see "The evaluation harness" below): `node scripts/wektor-test.mjs <case> --runs 1`. The chats are kept, titled `[test] <case> #n`; never delete them.
5. **Show the user Wektor's answers verbatim and judge together.** Do NOT loop run -> fix -> rerun on your own. One run per case, present, discuss, then change. Check his factual claims against the data (`curl http://127.0.0.1:5174/api/agent/bank?...`): his specific claims were true so far, but verify.
6. Improve the skill/tool from what the user says, then back to 3.

## What to deliver for a new ability

- **Contract** in `src/`: a zod schema with few fields, each from a short list or a short text; defaults and everything else are the panel's choice. Model-facing names that the model guesses wrong cost a failed call (he wrote `view`, not `widok`): prefer the name he reaches for.
- **Server logic** pure and tested (`server/bank-show.ts`, `server/bank-plan.ts`). A write is ONE atomic store action (`mergeInto` in `server/bank-labels.ts`; `apply` rolls memory back when it throws).
- **MCP tool** in `server/panel-mcp.ts`; description from `COCKPIT_TOOLS` in `src/cockpit-contract.ts` (`purpose`, `when`, `effect`, `card`) - the preamble lists them too. The tool answer is a short summary, never the rows ("data by reference": the card fetches rows itself, from `GET /api/bank/show` / `/api/bank/plan`). Reject bad calls with a sentence that names what exists (he recovers from it).
- **Card** in `src/cockpit/`: `cards.tsx` (data card `ShowCard`), `consent-card.tsx` (`ConsentShell` + `MergeBody`; a new shape of change = a new body in the same shell). Register in `Thread.tsx` (`makeAssistantToolUI`), map the tool name in `live.ts` (`CARDS`, `cockpitMessage`, `respond`), constants in `types.ts`. Add the key to `CARD_SHOWN`.
- **Consent for writes**: the tool only proposes. The card shows a before/after the panel works out; nothing changes until the user clicks. `POST /api/chats/:id/bank-plan` (Origin-checked) takes only `{toolCallId, decision}`; the plan is read from the conversation's own tool call, re-checked against current data, applied once (idempotent, kept in `cockpit.json`). The answer keeps the preview, so a decided card still shows what it was.
- **Card ids** come from content, not from Hermes: `stableBankCardId` (message + hash of the plan, `server/hermes-chat.ts`). Hermes gives no usable call id (two cards in one answer stayed `pending:` and a click was refused with 409). Test with the ids the chat really makes, never `m1:x`.
- **Docs**: `AGENTS.md`, `docs/bank.md`. Update the guide lines (`BANK_GUIDE` in `src/chat-contract.ts`). A guide is registered in `PANEL_GUIDES` (area, `when`, lines): Wektor reads it with `panel_guide` when a conversation reaches the area, and the same lines are the `@Bank` skill. The preamble only has one line per guide (`guideRules()`). A new area (calendar, to-dos) = a new entry, not more preamble.

## The skill text (`BANK_GUIDE`) - rules we hold

- General rules only. No name, amount, category or answer of a test case, no click instructions ("Ustawienia -> Scal"). A line that hands Wektor the test's answer makes the test worthless.
- Examples are welcome but from **other** domains than the cases (fictional data), and the cases stay held out. Keep two or three cases in different topics.
- Policy (e.g. "when to merge") is the user's, in his words, added when a real preference appears. Wektor may propose a skill update when he hears one ("Warto dopisać do skilla Bank: ...").
- The consent card is **not proactive**: on a request for advice he first suggests the change in words and asks whether to show the card; the card comes after the user agrees, or at once when the user explicitly asks for a concrete change. Not every bank conversation means the user wants a change.
- What the user judged good: verdict first with a reason from the numbers, <= 6 sentences without lists, says since when marks exist and how much is unmarked, "trudno ocenic" instead of a forecast when the sample is small, names of services allowed but no table of rows, proposes only steps his tools can do, no `execute_code`, ends with one concrete next step, never says he changed something.

## Wektor's agent harness (what "harness" means here)

An **agent harness** is everything around the model except its reasoning: the loop, tools and their execution, context and memory, permissions and guardrails, state, observability (agent = model + harness; see [Thoughtworks](https://www.thoughtworks.com/en-us/insights/blog/machine-learning-and-ai/ai-agent-harness), [Google Cloud](https://cloud.google.com/discover/agent-harness)). **Harness engineering** is improving that layer: every failure of the agent is treated as a system problem to fix permanently (a tool, a field, a rule, a test), not as a prompt to retry. The **evaluation harness** (below, `scripts/wektor-test.mjs`) is a different thing: it measures the agent, it does not shape him. Both matter; do not mix the words up with the user.

| Part of the harness | In our system |
| --- | --- |
| Model | DeepSeek V4.1 Flash via OpenRouter |
| Loop, tool calls, context, history | Hermes Agent (service `Desk-Panel-Hermes`) |
| Instructions | short preamble (`hermesPreamble()`: identity, evidence rules, tool table, one line per guide) + area guides read on demand (`panel_guide`, `PANEL_GUIDES`), `@` skills |
| Tools (actions) | MCP tools of the panel (`server/panel-mcp.ts`), narrow, enumerated fields |
| Human in the loop | cards: data card, consent card (the tool only proposes) |
| Guardrails | no write tools for the agent; plan read from the conversation, re-checked, applied atomically on the user's click |
| State / memory | `cockpit.json` (decisions and previews), Hermes sessions |
| Observability | `~/.desk-panel/chat-logs`, the card's own preview |
| Evaluation | `scripts/wektor-test.mjs` and the cases, judged with the user |

Failures we fixed in the harness, not in a prompt: the tool's field name he kept guessing (`view`), a limit he read from the wrong tool (42 days), sums he could not see (coverage line in the card summary), a card he could not show (unmarked spending), names of what a category holds (he guessed from the category name), card ids from the stream, a decided card that lost its content. Next time start from the same question: **what in the system made him do that?**

## The evaluation harness (`scripts/wektor-test.mjs`)

`node scripts/wektor-test.mjs <case> [--runs N] [--delete] [--base http://127.0.0.1:5174]`

- **What it does**: for each run it opens a new Hermes chat through the panel's own API (`POST /api/chats` with `engine: hermes`, an `Origin` header like the page's), sends the case's turns one by one (`POST .../messages`), polls until the agent's answer is no longer streaming (300 s limit), then reads the tools he called and his text. It talks to the **live service on port 5174, real Hermes, real data**; it needs the service and Hermes running.
- **What he sees is a natural conversation**: the harness sends plain text, never picks `@Bank`, so it tests what a user really gets (skill text arrives through the preamble).
- **Output**: per run, the tool chain (`panel_bank -> panel_show`, `!` marks an error), model-call/token/seconds line (the counters are unreliable), failed `expect` checks (`x`), `soft` results (`+`/`-`), the proposals of `panel_bank_propose` (printed as `karta zgody: {...}`), and **his answer in full**. A JSON report goes to `output/wektor/<case>-<timestamp>.json` (git-ignored): all tools with inputs and outputs, useful to check what a tool really answered.
- **Chats stay** in the panel, renamed `[test] <case> #<run> <time>`, so the user can read them and see the cards. `--delete` removes them (only when the user asks). The harness never clicks a card.
- **Exit code** 0 when every run passed its `expect` checks, 1 otherwise, 2 on bad usage.

### Writing a case (`scripts/wektor-cases/<name>.json`)

```
{ "description": "...", "turns": [
  { "say": "what the user types",
    "expect": { "calls": ["panel_bank"], "notCalls": ["panel_todo_action", "panel_bank_propose"],
                "text": ["regex"], "textNot": ["zmieni\u0142em"], "maxTools": 8, "maxSeconds": 90 },
    "soft": [ { "name": "what we watch", "text": "regex" } ] } ] }
```

- Tool names are matched without the `mcp__desk_panel__` prefix. Regexes are case-insensitive, matched on his whole text, written as JSON (double backslashes).
- **`expect` is for rules that must hold** (a write tool must not be called; the card appears or does not; no "I changed it"). **`soft` is for judgement we are still forming** (mentions a related category, notes the data is short, does not list rows). A `soft` regex is crude: Polish inflection breaks it (`Gadzety` vs `Gadzetow`), so a `-` means "look", not "bad".
- **Every case that must not write needs the write/card tools in `notCalls`**; the advice case lists `panel_bank_propose` there (the card is not proactive).
- **Multi-turn cases** model the user's replies ("Tak", "Okej, daj"); the second turn's `expect` is checked on the second answer only.
- **New case = new topic.** Keep the cases held out from the examples in `BANK_GUIDE` (other categories, other wording); when a real conversation of the user's goes wrong, turn it into a case.
- Real categories matter: a case that names categories must use ones the user really has (check `panel_bank` / the agent view), or Wektor will ask instead of proposing.
- **Live data drifts.** The cases run on the user's real account: he keeps marking and may press "Wykonaj" in a kept test chat, so a case built on "Psycholog, Podolog, Gry are separate" stops meaning that (it happened: the merge was applied, and `porzadki-kategorie` then saw one category Zdrowie). Before judging a run, check the current state (`panel_bank` / the agent view) and say when a case's premise is gone. Do not read an answer as bad when the data changed under it.
- A `textNot` aimed at one phrase catches innocent uses of it ("nie da sie ich przypisac"); keep those checks narrow.

### Reading the result

- Variance is real (one model, temperature): a single run is a sample, not a verdict. Early runs of the same case disagreed on the advice itself. Use `--runs 3` when a rule is in doubt, and still show the user the answers, not just pass counts.
- Compare his claims with the data: `curl "http://127.0.0.1:5174/api/agent/bank?kategoria=...&from=...&to=..."` (read-only), and `~/.desk-panel/chat-logs/turns.jsonl` for the turn's tools and endings.
- A test chat that already has a card is **live**: do not press "Wykonaj" in it unless the user wants that change. To test the decision path without changing data, POST `reject` to `/api/chats/:id/bank-plan` with an `Origin` header (see Gotchas).

## Designing a card (we decide it with the user, visually)

- **Mock first, build after.** Before any card code, show 2-3 variants as mockups (the `visualize` widget: read_me with `mockup`, flat, no gradients, host colours) and let the user choose; then refine on his feedback, then implement. Our first merge card was reworked twice that way (flow bars -> effect zones -> rows with one arrow).
- **He should see the effect without reading.** Colours, icons, symbols and counts carry the meaning, text only labels: a green chip with a plus for what is created, a struck-through grey name with a red minus for what goes, a grey chip for what stays, one shared arrow, one tile for the result. A short legend explains the symbols once.
- **Always answer "what is created, changed, removed?"** The user asked it about every change (is a category made, is a tag removed, does a tag stay): the card must show new things, removed things and kept things (including labels/tags), and say what does not change (amounts, dates, other sides; nothing goes to the bank).
- **Order of rows**: count, name, what it already has | arrow | what it becomes. More than ~6 rows scroll inside, the result tile stays on top.
- **States**: loading preview, problems (the preview says why it cannot go ahead; no "Wykonaj"), open, decided. A decided card keeps showing what was proposed (rejected: dimmed; applied: as it was), from the preview kept with the answer.
- **One card = one change.** Two changes in one request are two cards (tested: Wektor sends two `panel_bank_propose`, each answered on its own). A card with several groups and one "Wykonaj" is possible but bigger; build it only when the user wants one click for all.
- **Reuse**: shell (`ConsentShell`) vs body (`MergeBody`). Other shapes (move items between states, delete) get their own body, chosen by the tool, never described by the model (a small model generating UI is costly and error-prone; he passes parameters, the panel draws).
- **Look at the real card** in the browser pane before calling it done (zoom in): the first real render showed a red strike-through colouring the names and a total wrapping onto two lines, which no unit test would catch. Style tokens are the `tw:ck-*` Tailwind classes; category colours/icons come from `COLOR_VALUES`/`ICONS` in `src/bank-look.tsx`.

## Hermes (the agent runtime) - what we learned

- Docs: `docs/hermes.md` (config, model, service), `docs/czat.md`, `docs/diagnostyka-czatu-wektora.md`. Service `Desk-Panel-Hermes` (Servy): `just hermes STATUS|RESTART|CHECK`; config `~/.hermes/config.yaml`, key in `~/.hermes/.env` and `%LOCALAPPDATA%\hermes\.env`; panel tools are registered once by `just hermes-setup` (MCP server `desk-panel`, token `~/.desk-panel/mcp-token`). Never start or register it without the user (standing exception: the restart in this workflow). It runs DeepSeek V4.1 Flash through OpenRouter.
- **Tool list is cached from Hermes's start**: a new tool or a changed schema is invisible until `just hermes RESTART` (the first run after adding `panel_show` answered "no such tool in this session"). Changes to a tool's *answer text* or to the panel's code need only `just update`.
- **Schemas are enforced by Hermes before the call** (`additionalProperties: false`): a wrong field name returns a validation error and he retries. He first loads schemas with `tool_describe`, so a tool's description and field names are what he sees.
- **The preamble** (`hermesPreamble()` in `server/hermes-chat.ts`: who he is, evidence rules, the cockpit tool table, one line per area guide) goes only in the first message of a session. A change to it affects new chats, not running ones. It is kept short on purpose: a long preamble dilutes the rules for a small model and grows with every area. Area rules are read when needed with `panel_guide`; Flash calls it first most of the time but not always (1 miss in the first 4 runs), so if it matters more, put a one-line reminder at the top of the area's main tool answer (e.g. `panel_bank`).
- **Tool call ids are unreliable**: the stream often gives only the tool's name (`pending:` ids in our store), the history gives `call_...`. That is why a card's identity is made from its content (`stableBankCardId`), and why the Cezar dispatch card has its own binding rules (`fillFromHistory`; it refuses to guess among several same-named cards).
- Hermes has its own tools (shell, files, `execute_code`, `tool_search`); `execute_code` is blocked for approval, and he sometimes tries it to add numbers: the tool summaries should already carry the sums, and the skill says not to compute.
- A Hermes turn ends after 40 model calls; the usage counters in our logs (`0 wywolan modelu`) are not reliable for cost. `skills.creation_nudge_interval: 0` is set so Hermes does not write skills on his own; the skills live in `src/chat-contract.ts`.
- A turn costs 100-230k input tokens (mostly his own system prompt and tool schemas) and 5-90 s; fine on this model, but keep tool answers short.
- History: Hermes keeps the sessions; the panel keeps only the mapping (`~/.desk-panel/hermes-chats`). After a restart the conversation is rebuilt from Hermes's history, so anything the panel adds to a part live (ids, outputs) must be derivable again from the history.

## Diagnosing a Wektor conversation

When a conversation looks wrong (a card misbehaves, an answer is odd, a turn hangs, a tool is "unknown"), **read `docs/diagnostyka-czatu-wektora.md` first and follow its procedure**: read-only, evidence over his claims, observations separate from conclusions, never click a card as part of a diagnosis. It lists where each fact lives (`hermes-chats`, `GET /api/chats/<id>`, `chat-logs/turns.jsonl` and `<id>.jsonl`, Hermes history and logs, `cockpit.json`, the harness reports in `output/wektor`). Quick pointers from our own work: grey card buttons or a 409 on "Wykonaj" = the card has no stable id (`pending:` or `call_…`); a "no such tool" after a deploy = Hermes was not restarted; a chat that ignores a new rule = it started before the preamble changed. After a diagnosis that taught something new, **update that document** (add it under "Na co patrzeć" or as a short example), as we did on 2026-10-29.

## Where we stand (2026-10-29), to continue in a new chat

- Built and deployed: `panel_show` (data card incl. unmarked spending), `panel_bank_propose` (consent card for merging spending categories; atomic `mergeInto`; preview kept after the answer), `panel_guide` (area guides on demand; bank only), bank guide `BANK_GUIDE`, harness and 6 cases, the card shell/body split.
- Phase for the bank: **kalibracja odpowiedzi** (we are tuning his answers with the user, not yet freezing expectations).
- Open ideas: `panel_calendar_search` (the calendar source reads only today + 42 days ahead, so he cannot check past visits); a consent card with several groups and one "Wykonaj"; guides for other areas (calendar, to-dos) as new `PANEL_GUIDES` entries; the user's own merge policy, to be added in his words when it appears; whether the data card is shown by Wektor or only offered (left as it is: sometimes shown, sometimes offered).
- Working agreements: push straight to main, no co-author trailer; restart Hermes after tool changes (standing permission); never delete the kept test chats; never click "Wykonaj" in them; the user's real account changes under the cases.

## Gotchas

- Windows: long heredocs in the shell break on quotes. Write a script file to the scratchpad with the Write tool and run it; avoid `\s` in non-raw Python strings (use the Edit tool for TS regexes).
- Files may be CRLF; edit with a helper that keeps the file's line endings.
- Icon keys are `BANK_ICONS` (`heart`, not `heartPulse`). `ICONS[key]` can be undefined: guard.
- Calendar source reads only today + 42 days ahead (`CALENDAR_DAYS`); it cannot see past visits. A `panel_calendar_search` (past range, by keyword) is the open idea.
- The built-in browser pane: chat button via `find` + `ref` click only with the viewport set to 1280x800; reset with `preset: desktop` afterwards. Never click "Wykonaj" in a real chat.
- **Cards in kept test chats are live**: "Wykonaj" there changes the user's real data. Say so when reporting. To test the answer path without changing data, POST `reject` (as the page would, with an `Origin` header).
- Logs for diagnosis: `~/.desk-panel/chat-logs` (see its README); `turns.jsonl` first.

## Cases so far (`scripts/wektor-cases/`)

`porzadki-kategorie` (advice, must not show the card), `scal-po-zgodzie` (card after "Okej, daj"), `scal-wprost` (explicit request: card at once), `scal-dwa` (two merges: two cards), `subskrypcje`, `jedzenie-sklep` (other topics, with a "Tak" turn).
