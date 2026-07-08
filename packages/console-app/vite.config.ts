import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration for the console-app package.
 *
 * The app shells (web/desktop) own the production Vite build; this config exists
 * only so vitest can compile the shared React UI (JSX + the `@/` alias) in the
 * jsdom environment. Tests live in `tests/` and import source via `../src`.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    // Avoid picking up the apps' index.html / source maps.
    exclude: ['node_modules', 'dist'],
  },
});
