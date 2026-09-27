import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    // three/webgpu alone is ~900 kB minified (~250 kB gzip); the whole app is that renderer.
    chunkSizeWarningLimit: 1100,
  },
});
