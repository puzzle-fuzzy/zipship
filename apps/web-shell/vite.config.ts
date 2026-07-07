import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  envDir: new URL('../..', import.meta.url).pathname,
  plugins: [tailwindcss(), react()],
  resolve: {
    dedupe: [
      "react",
      "react-dom",
      "react-router",
      "cookie",
      "set-cookie-parser",
    ],
    alias: {
      '@': path.resolve(__dirname, '../../packages/console-core/src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  optimizeDeps: {
    force: true,
    include: [
      "react",
      "react-dom",
      "react-router",
      "cookie",
      "set-cookie-parser",
      "react-router > cookie",
      "react-router > set-cookie-parser",
    ],
  },
});
