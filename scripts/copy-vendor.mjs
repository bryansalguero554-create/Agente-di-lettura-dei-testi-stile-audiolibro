// Copia nella cartella public/vendor i file WebAssembly necessari alla voce neurale,
// così l'app non dipende da CDN esterni (a parte il modello vocale).
import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'vendor');
const files = [
  ['node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm', 'ort/ort-wasm-simd-threaded.wasm'],
  ['node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs', 'ort/ort-wasm-simd-threaded.mjs'],
  ['node_modules/@diffusionstudio/piper-wasm/build/piper_phonemize.wasm', 'piper/piper_phonemize.wasm'],
  ['node_modules/@diffusionstudio/piper-wasm/build/piper_phonemize.data', 'piper/piper_phonemize.data'],
];
for (const [from, to] of files) {
  const src = join(root, from);
  if (!existsSync(src)) throw new Error(`File mancante: ${from}. Esegui npm install.`);
  mkdirSync(dirname(join(out, to)), { recursive: true });
  cpSync(src, join(out, to));
}
console.log('vendor: file WebAssembly copiati in public/vendor');
