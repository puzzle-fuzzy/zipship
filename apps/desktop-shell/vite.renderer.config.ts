import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  envDir: new URL('../..', import.meta.url).pathname,
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom', 'scheduler'],
  },
  optimizeDeps: {
    include: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', 'scheduler'],
  },
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
  },
});
