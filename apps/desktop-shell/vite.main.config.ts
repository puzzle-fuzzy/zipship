import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  envDir: new URL('../..', import.meta.url).pathname,
});
