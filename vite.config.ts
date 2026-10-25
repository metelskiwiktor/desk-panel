import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // DESK_API_URL lets scripts/scenario.ts point the dev server at a scenario API.
  // The Host header stays the page's own: the server compares it with Origin on actions (a string target would rewrite it).
  server: { host: '127.0.0.1', proxy: { '/api': { target: process.env.DESK_API_URL || 'http://127.0.0.1:5174', changeOrigin: false } } },
  test: { environment: 'jsdom', restoreMocks: true },
});
