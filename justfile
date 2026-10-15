set windows-shell := ["powershell.exe", "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command"]

# List available commands.
default:
    @just --list

# Install exactly the locked dependencies.
setup:
    npm ci

# Start API and Vite for development.
dev:
    npm run dev

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
