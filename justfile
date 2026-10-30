set windows-shell := ["powershell.exe", "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command"]

# List available commands.
default:
    @just --list

# Install exactly the locked dependencies and Playwright's Chromium.
setup:
    npm ci
    node scripts/dependencies.mjs
    npx playwright install chromium

# Start API and Vite for development.
dev:
    npm run dev

# Serve the UI on a scenario file from scenarios/ (or a path) instead of real sources.
scenario name="standard":
    npm run scenario -- {{name}}

# Playwright screenshots of a scenario into output/screenshots, e.g. `just screenshots offline --pages pulpit`.
screenshots name="standard" *args:
    node scripts/ensure-deps.mjs
    npm run scenario -- {{name}} --shot {{args}}

# Synthetic browser flows for Wektor: composer, keyboard, history, switching, or all. No real agent or provider.
wektor-ui case="all" *args:
    node scripts/ensure-deps.mjs
    npx tsx scripts/wektor-ui.ts {{case}} {{args}}

# Target screens from devices.json with derived CSS sizes and Chrome DevTools values.
devices:
    npx tsx scripts/devices.ts

# Full-resolution screenshot of a real monitor into output/screenshots (default: the first non-primary one).
monitor display="0":
    & ./scripts/monitor-shot.ps1 -Display {{display}}

# The dashboard as a bare full-screen Chrome window on one monitor (default P16, see `just monitor`); Alt+F4 closes it.
kiosk display="P16":
    & ./scripts/kiosk.ps1 -Display '{{display}}'

# Open the kiosk's Chrome profile as an ordinary window: sign in to Google once, set the dashboard's layout. Then `just kiosk`.
kiosk-setup:
    & ./scripts/kiosk.ps1 -Setup

# Start the kiosk window at sign-in: ON, OFF or STATUS.
kiosk-autostart action="STATUS" display="P16":
    & ./scripts/kiosk-autostart.ps1 -Action '{{action}}' -Display '{{display}}'

# Hide or show the Windows taskbar on a specific monitor: HIDE (default), SHOW or STATUS.
kiosk-taskbar action="HIDE" display="P16":
    & ./scripts/kiosk-taskbar.ps1 -Action '{{action}}' -Display '{{display}}'

# Sign in to Garmin Connect once; e-mail, password and MFA are typed in the terminal, only DPAPI-encrypted tokens are saved.
garmin-login:
    npx tsx scripts/garmin-login.ts

# Tests, typecheck, dead code (knip) and the frontend build, side by side. Run before publishing.
check:
    node scripts/ensure-deps.mjs
    node scripts/check.mjs

# While working: only the tests that the uncommitted changes can affect (vitest --changed).
test-fast:
    node scripts/ensure-deps.mjs
    npx vitest run --changed

# Bring origin/main in (stops on any conflict with local work), test, build and restart
# the service with it, uncommitted local changes included. Pass --force to redeploy.
update *args:
    node scripts/update.mjs {{args}}

# Manage the Windows service: STATUS, START, STOP, RESTART; RUN runs in foreground.
service action="STATUS" *args:
    & ./servy/desk-panel.ps1 -Action '{{action}}' {{args}}

# Hermes (default chat engine) as its own service: STATUS, START, STOP, RESTART, RUN (foreground), CHECK (pin + health).
hermes action="STATUS":
    & ./servy/hermes.ps1 -Action '{{action}}'

# One-time Hermes setup outside Git: API server key on loopback, panel.env, MCP tools in ~/.hermes/config.yaml.
hermes-setup:
    & ./scripts/hermes-setup.ps1

# Register Hermes as a Servy service with automatic (delayed) start; Windows credential dialog like `just install`.
hermes-install:
    & ./servy/register.ps1 -Manifest servy/hermes.json -Start

# Build and register the service with automatic startup (Windows credential dialog).
install: check
    & ./servy/register.ps1 -Start
