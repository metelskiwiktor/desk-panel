---
name: wektor-capabilities
description: Use when the user wants Wektor (the in-panel Hermes chat agent) to be able to do or show something new, or wants his answers about the bank improved - building the tool/card/skill lines, running test conversations against him, judging his answers with the user.
---

# Giving Wektor an ability

The user asks for an action that is hard in the panel UI (e.g. "merge these bank categories"). **We deliver, Wektor executes.** The user does not do it by hand and does not want a one-off script on his data. Wektor is Hermes Agent (DeepSeek Flash via OpenRouter) in the panel's chat; he reaches the panel only through MCP tools (`server/panel-mcp.ts`).

## The loop

1. **Discuss behaviour first.** How should Wektor talk, when does he act, what must he never do. Write it down as general rules, not as the answer to the case at hand.
2. **Deliver in code** (below), with tests. Commit and push to main (user's standing rule), `just update` to deploy.
3. **Restart Hermes** after any change to a tool or its schema: `just hermes RESTART`. Hermes caches the tool list from its start (a new tool is invisible until then). Standing permission, given 2026-10-29, only for this workflow. A change to the skill text or a tool's *answer* needs only the deploy.
4. **Run test conversations yourself**: `node scripts/wektor-test.mjs <case> --runs 1` (cases: `scripts/wektor-cases/*.json`; `expect` fails a run, `soft` is only reported). The chats are kept, titled `[test] <case> #n`; never delete them.
5. **Show the user Wektor's answers verbatim and judge together.** Do NOT loop run -> fix -> rerun on your own. One run per case, present, discuss, then change. Check his factual claims against the data (`curl http://127.0.0.1:5174/api/agent/bank?...`): his specific claims were true so far, but verify.
6. Improve the skill/tool from what the user says, then back to 3.

## What to deliver for a new ability

- **Contract** in `src/`: a zod schema with few fields, each from a short list or a short text; defaults and everything else are the panel's choice. Model-facing names that the model guesses wrong cost a failed call (he wrote `view`, not `widok`): prefer the name he reaches for.
- **Server logic** pure and tested (`server/bank-show.ts`, `server/bank-plan.ts`). A write is ONE atomic store action (`mergeInto` in `server/bank-labels.ts`; `apply` rolls memory back when it throws).
- **MCP tool** in `server/panel-mcp.ts`; description from `COCKPIT_TOOLS` in `src/cockpit-contract.ts` (`purpose`, `when`, `effect`, `card`) - the preamble lists them too. The tool answer is a short summary, never the rows ("data by reference": the card fetches rows itself, from `GET /api/bank/show` / `/api/bank/plan`). Reject bad calls with a sentence that names what exists (he recovers from it).
- **Card** in `src/cockpit/`: `cards.tsx` (data card `ShowCard`), `consent-card.tsx` (`ConsentShell` + `MergeBody`; a new shape of change = a new body in the same shell). Register in `Thread.tsx` (`makeAssistantToolUI`), map the tool name in `live.ts` (`CARDS`, `cockpitMessage`, `respond`), constants in `types.ts`. Add the key to `CARD_SHOWN`.
- **Consent for writes**: the tool only proposes. The card shows a before/after the panel works out; nothing changes until the user clicks. `POST /api/chats/:id/bank-plan` (Origin-checked) takes only `{toolCallId, decision}`; the plan is read from the conversation's own tool call, re-checked against current data, applied once (idempotent, kept in `cockpit.json`). The answer keeps the preview, so a decided card still shows what it was.
- **Card ids** come from content, not from Hermes: `stableBankCardId` (message + hash of the plan, `server/hermes-chat.ts`). Hermes gives no usable call id (two cards in one answer stayed `pending:` and a click was refused with 409). Test with the ids the chat really makes, never `m1:x`.
- **Docs**: `AGENTS.md`, `docs/bank.md`. Update the skill lines (`BANK_GUIDE` in `src/chat-contract.ts`; it is both the `@Bank` skill and part of Hermes's preamble, so it works without picking the skill).

## The skill text (`BANK_GUIDE`) - rules we hold

- General rules only. No name, amount, category or answer of a test case, no click instructions ("Ustawienia -> Scal"). A line that hands Wektor the test's answer makes the test worthless.
- Examples are welcome but from **other** domains than the cases (fictional data), and the cases stay held out. Keep two or three cases in different topics.
- Policy (e.g. "when to merge") is the user's, in his words, added when a real preference appears. Wektor may propose a skill update when he hears one ("Warto dopisać do skilla Bank: ...").
- The consent card is **not proactive**: on a request for advice he first suggests the change in words and asks whether to show the card; the card comes after the user agrees, or at once when the user explicitly asks for a concrete change. Not every bank conversation means the user wants a change.
- What the user judged good: verdict first with a reason from the numbers, <= 6 sentences without lists, says since when marks exist and how much is unmarked, "trudno ocenic" instead of a forecast when the sample is small, names of services allowed but no table of rows, proposes only steps his tools can do, no `execute_code`, ends with one concrete next step, never says he changed something.

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
