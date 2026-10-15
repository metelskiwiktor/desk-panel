# Desk Panel

Local React/TypeScript dashboard with a Node HTTP server. Read README.md for
integration details. Keep the server bound to loopback; credentials stay on the
backend and outside Git. Google refresh tokens use user-scoped Windows DPAPI.

- `just setup`: install locked dependencies.
- `just dev`: run API and Vite during development.
- `just check`: all tests, typecheck and frontend build. Run before publishing.
- `just service`: Windows service status. `just service RESTART` applies changes
  after a successful build. Never run another listener while the service runs.
- `just install`: first-time Servy registration; may need Windows credentials
  entered by the user in the native dialog. See servy/README.md.

Source is in src/ and server/. Contract schemas validate provider data. Preserve
real observation timestamps on failures. Quota reads must never send model prompts
or start agent turns. Do not commit .env, OAuth clients, tokens, logs, screenshots,
node_modules or dist. Do not print credentials in tool output.
