import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', proxy: { '/api/cezar': 'http://127.0.0.1:5174', '/api/calendar': 'http://127.0.0.1:5174', '/api/system': 'http://127.0.0.1:5174', '/api/quotas': 'http://127.0.0.1:5174' } },
  test: { environment: 'jsdom', restoreMocks: true },
});
