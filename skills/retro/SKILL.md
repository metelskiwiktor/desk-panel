---
name: retro
description: Use at the end of a larger task in desk-panel (several commits, a new area, or much searching or trial-and-error testing), or when the user asks how the work went - a short retrospective of what in the repository's documents, code or commands would have made the same task faster. Proposals only, never edits.
---

# Retrospective after a larger task

The user wants to know what would have made the **same task faster** if the working environment had been better prepared:
documents, code, commands. Not a summary of the work, not praise, not a plan for the feature.

When: after a larger task (several commits, a new area, much searching, ad-hoc test scripts written and thrown away), or
when the user asks. Not after a small fix. Once per task, at its end.

## What to look back at

Think about how you actually worked in this task, then answer only what has an answer:

1. A document that helped most (one or two, and why).
2. A document you needed but found late or never (where it was, or that it does not exist).
3. A document that misled you or contradicts the code (file:line and what is wrong).
4. A change to a document, or a new one, that would have saved real time (what it should say; a map, not a copy of the code).
5. Logic in code or a document you consider wrong (file:line, why, what breaks).
6. Which `just` commands helped, and which you wished existed or worked differently.
7. Your own inefficiency that no environment change would fix (e.g. running full `just check` after every small edit), said
   plainly, so it is not mistaken for a missing tool.

## Rules

- At most 3 findings, the ones that would have saved the most time. "Nothing worth changing" is a valid answer.
- Each finding has evidence: a path with a line, a command and what it did, or what you did by hand that a tool could do.
  No general advice ("better docs would help").
- Propose; change nothing. The user decides, and a fix follows the map in AGENTS.md (where each kind of knowledge goes).
- Say what you checked against the code and what is only your impression.
- In Polish, short: one sentence with the biggest gain first, then the findings.

## Why

On 2026-10-30 one such retrospective from Codex, after a long GUI task on Wektor, became `docs/wektor-ui.md`, the
`just wektor-ui` flows, a fixed contradiction in `docs/czat.md` and page errors failing the browser checks: the time it had
spent writing throw-away test scripts was saved for every later task.
