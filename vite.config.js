import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // percorsi relativi: l'app funziona in qualsiasi sottocartella (es. GitHub Pages)
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  resolve: {
    alias: {
      // fonemizzatore di Piper (non esportato dal pacchetto, lo prendiamo dal suo file)
      'piper-phonemize': fileURLToPath(new URL('./node_modules/@mintplex-labs/piper-tts-web/dist/piper-o91UDS6e.js', import.meta.url)),
    },
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
