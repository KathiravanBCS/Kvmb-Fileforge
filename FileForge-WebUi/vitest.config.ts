import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Unit and component tests. The app itself is built by vite.config.ts; this adds the browser-like test environment.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // Nothing in the tests needs real styles: CSS imports (Mantine, the data grid, CSS modules) become empty.
    css: false,
    // Rendering the data grid in jsdom is CPU-heavy; with the whole suite running in parallel a test can take several seconds.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    clearMocks: true,
    restoreMocks: true,
    // No real API is ever called: the HTTP client reads this at import time, nothing listens there.
    env: { VITE_API_BASE_URL: 'http://localhost:4000' },
  },
});
