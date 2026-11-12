import { fileLibraryPlugin } from './server/dev-plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  clearScreen: false,
  plugins: [fileLibraryPlugin()],
  server: { port: 1420, strictPort: true },
  build: {
    // Open games still reference their fingerprinted workers and lazy chunks.
    // Keep those files available when publishing the next local build.
    emptyOutDir: false,
    target: 'es2022',
    rollupOptions: { output: { manualChunks: { three: ['three'] } } },
  },
});
