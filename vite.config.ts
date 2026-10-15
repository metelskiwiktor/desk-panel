import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // DESK_API_URL lets scripts/scenario.ts point the dev server at a scenario API.
  server: { host: '127.0.0.1', proxy: { '/api': process.env.DESK_API_URL || 'http://127.0.0.1:5174' } },
  test: { environment: 'jsdom', restoreMocks: true },
});
