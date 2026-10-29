import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // Tailwind serves only the chat cockpit (src/cockpit/cockpit.css): prefixed `tw:` utilities, no preflight.
  plugins: [react(), tailwindcss()],
  // `@/…` is src/: the assistant-ui components (shadcn, src/components) import each other that way.
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // DESK_API_URL lets scripts/scenario.ts point the dev server at a scenario API.
  // The Host header stays the page's own: the server compares it with Origin on actions (a string target would rewrite it).
  server: { host: '127.0.0.1', proxy: { '/api': { target: process.env.DESK_API_URL || 'http://127.0.0.1:5174', changeOrigin: false } } },
  // Task worktrees contain other branches and their own React; never collect their tests in this checkout.
  test: {
    restoreMocks: true, exclude: [...configDefaults.exclude, '.ai/**', '.claude/worktrees/**'],
    // Server and scripts run without a DOM; only the UI pays for jsdom. A UI test that renders the whole panel takes 1–3 s
    // of CPU, more while just check builds beside it: its limit catches a hang, not a slow machine.
    projects: [
      { extends: true, test: { name: 'server', include: ['server/**/*.test.ts', 'scripts/**/*.test.mjs'], environment: 'node' } },
      { extends: true, test: { name: 'ui', include: ['src/**/*.test.{ts,tsx}'], environment: 'jsdom', setupFiles: ['src/test-setup.ts'], testTimeout: 15_000 } },
    ],
  },
});
