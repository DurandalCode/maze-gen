import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  optimizeDeps: {
    include: [
      'react',
      'react-dom/client',
      'three',
      'clipper2-ts',
      'earcut',
      'three/addons/controls/OrbitControls.js',
      'three/addons/utils/BufferGeometryUtils.js',
    ],
  },
  server: { port: 1421, strictPort: true },
  preview: { port: 1421, strictPort: true },
  build: { target: 'es2022', outDir: 'dist', emptyOutDir: true },
});
