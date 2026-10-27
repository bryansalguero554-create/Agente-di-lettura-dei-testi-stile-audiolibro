import { defineConfig } from 'vite';

export default defineConfig({
  // percorsi relativi: l'app funziona in qualsiasi sottocartella (es. GitHub Pages)
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['@mintplex-labs/piper-tts-web', 'onnxruntime-web'],
  },
  test: {
    include: ['tests/**/*.test.js'],
  },
});
