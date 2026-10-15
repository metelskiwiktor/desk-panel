set windows-shell := ["powershell.exe", "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command"]

# List available commands.
default:
    @just --list

# Install exactly the locked dependencies and Playwright's Chromium.
setup:
    npm ci
    npx playwright install chromium

# Start API and Vite for development.
dev:
    npm run dev

# Serve the UI on a scenario file from scenarios/ (or a path) instead of real sources.
scenario name="standard":
    npm run scenario -- {{name}}

# Playwright screenshots of a scenario into output/screenshots, e.g. `just screenshots offline --pages pulpit`.
screenshots name="standard" *args:
    npm run scenario -- {{name}} --shot {{args}}

# Run all tests, typecheck and produce the frontend served by the service.
check:
    npm test
    npm run build

# Manage the Windows service: STATUS, START, STOP, RESTART; RUN runs in foreground.
service action="STATUS":
    & ./servy/desk-panel.ps1 -Action '{{action}}'

# Build and register the service with automatic startup (Windows credential dialog).
install: check
    & ./servy/register.ps1 -Start
