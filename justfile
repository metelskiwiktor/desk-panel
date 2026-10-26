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

# Target screens from devices.json with derived CSS sizes and Chrome DevTools values.
devices:
    npx tsx scripts/devices.ts

# Full-resolution screenshot of a real monitor into output/screenshots (default: the first non-primary one).
monitor display="0":
    & ./scripts/monitor-shot.ps1 -Display {{display}}

# The dashboard as a bare full-screen Chrome window on one monitor (default 1, see `just monitor`); Alt+F4 closes it.
kiosk display="1":
    & ./scripts/kiosk.ps1 -Display {{display}}

# Open the kiosk's Chrome profile as an ordinary window: sign in to Google once, set the dashboard's layout. Then `just kiosk`.
kiosk-setup:
    & ./scripts/kiosk.ps1 -Setup

# Start the kiosk window at sign-in: ON, OFF or STATUS.
kiosk-autostart action="STATUS" display="1":
    & ./scripts/kiosk-autostart.ps1 -Action '{{action}}' -Display {{display}}

# Sign in to Garmin Connect once; e-mail, password and MFA are typed in the terminal, only DPAPI-encrypted tokens are saved.
garmin-login:
    npx tsx scripts/garmin-login.ts

# Run all tests, typecheck and produce the frontend served by the service.
check:
    node scripts/ensure-deps.mjs
    npm test
    npm run build

# Bring origin/main in (stops on any conflict with local work), test, build and restart
# the service with it, uncommitted local changes included. Pass --force to redeploy.
update *args:
    node scripts/update.mjs {{args}}

# Manage the Windows service: STATUS, START, STOP, RESTART; RUN runs in foreground.
service action="STATUS":
    & ./servy/desk-panel.ps1 -Action '{{action}}'

# Build and register the service with automatic startup (Windows credential dialog).
install: check
    & ./servy/register.ps1 -Start
