import { fileLibraryPlugin } from './server/dev-plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  clearScreen: false,
  plugins: [fileLibraryPlugin()],
  server: { port: 1420, strictPort: true },
  build: {
    target: 'es2022',
    rollupOptions: { output: { manualChunks: { three: ['three'] } } },
  },
});
