# Desk Panel

Local React/TypeScript dashboard with a Node HTTP server. Read README.md for
integration details. Keep the server bound to loopback; credentials stay on the
backend and outside Git. Google refresh tokens use user-scoped Windows DPAPI.

- `just setup`: install locked dependencies and Playwright Chromium.
- `just dev`: run API and Vite during development.
- `just scenario NAME` / `just screenshots NAME [--pages pulpit,ustawienia]
  [--device ID|all] [--scale N|primary|all]`: run the real UI against
  `scenarios/NAME.json` (Vite + a scenario API on free ports, never the service
  port) and take Playwright screenshots into output/screenshots. Use this to
  check UI changes visually on the target screens.
- `just devices`: target screens from devices.json with derived CSS sizes.
  Screen sizes live only there; the layout is fluid and never reads it.
- `just check`: all tests, typecheck and frontend build. Run before publishing.
- `just update [--force]`: deploy to the service — merges origin/main only when it
  cannot conflict with local work (otherwise lists the files and changes
  nothing), runs tests and build, swaps dist and restarts. Uncommitted local
  changes are deployed too; an unchanged version is skipped. Restart may show a
  UAC prompt the user must confirm.
- `just service`: Windows service status. `just service RESTART` applies changes
  after a successful build. Never run another listener while the service runs.
- `just install`: first-time Servy registration; may need Windows credentials
  entered by the user in the native dialog. See servy/README.md.

Source is in src/ and server/. The UI reads only `/api/*`; `server/sources.ts`
defines `PanelSources`, implemented by `real-sources.ts` (service) and
`scenario.ts` (JSON files validated by the same contract schemas). Mock data
lives only in scenarios/ — add a file there instead of branching in the UI. Contract schemas validate provider data. Preserve
real observation timestamps on failures. Quota reads must never send model prompts
or start agent turns. Do not commit .env, OAuth clients, tokens, logs, screenshots,
node_modules or dist. Do not print credentials in tool output.
