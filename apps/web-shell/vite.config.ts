import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  envDir: new URL('../..', import.meta.url).pathname,
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '../../packages/console-app/src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 4015,
    strictPort: true,
  },
});
