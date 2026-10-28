// Worker della voce neurale offline (Piper): fonemizzazione, inferenza ONNX e cache del
// modello. Scritto su misura per poter regolare ritmo ed espressività del narratore.

import * as ortModule from 'onnxruntime-web/wasm';
import { createPiperPhonemize } from 'piper-phonemize';
import { PATH_MAP, HF_BASE } from '@mintplex-labs/piper-tts-web';

const CACHE = 'narratore-voci-v1';
let ort = null;
let session = null;
let config = null;
let paths = null;
let queue = Promise.resolve();

// La libreria usata nelle versioni precedenti salvava i modelli in OPFS: li riutilizziamo
// per non far riscaricare la voce a chi l'aveva già.
async function readOldCache(url) {
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('piper');
    const file = await (await dir.getFileHandle(url.split('/').at(-1))).getFile();
    return new Uint8Array(await file.arrayBuffer());
  } catch {
    return null;
  }
}

async function fetchCached(url, onProgress) {
  const cache = await caches.open(CACHE).catch(() => null);
  const hit = await cache?.match(url);
  if (hit) return new Uint8Array(await hit.arrayBuffer());
  const old = await readOldCache(url);
  if (old?.length) {
    await cache?.put(url, new Response(old)).catch(() => {});
    return old;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download non riuscito (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress?.(loaded, total);
  }
  const bytes = new Uint8Array(loaded);
  let o = 0;
  for (const c of chunks) { bytes.set(c, o); o += c.length; }
  await cache?.put(url, new Response(bytes)).catch(() => {});
  return bytes;
}

async function init(voiceId, wasmPaths, modelUrl) {
  paths = wasmPaths;
  ort = ortModule.default || ortModule;
  ort.env.wasm.wasmPaths = paths.onnxWasm;
  ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
  // le voci più recenti hanno un indirizzo proprio, le altre stanno nell'archivio della libreria
  const url = modelUrl || (PATH_MAP[voiceId] && `${HF_BASE}/${PATH_MAP[voiceId]}`);
  if (!url) throw new Error(`voce sconosciuta: ${voiceId}`);
  config = JSON.parse(new TextDecoder().decode(await fetchCached(`${url}.json`)));
  const model = await fetchCached(url, (loaded, total) => self.postMessage({ type: 'progress', loaded, total }));
  session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'] });
}

// Il fonemizzatore (espeak-ng, ~18 MB di dati) si carica una sola volta e si riusa:
// ricrearlo a ogni frase costava centinaia di millisecondi e creava pause tra le frasi.
let phonemizer = null;
let waiting = null;

function loadPhonemizer() {
  phonemizer ??= createPiperPhonemize({
    print: (data) => waiting?.resolve(JSON.parse(data).phoneme_ids),
    printErr: (message) => waiting?.reject(new Error(message)),
    locateFile: (file) => (file.endsWith('.wasm') ? paths.piperWasm : file.endsWith('.data') ? paths.piperData : file),
  }).catch((err) => {
    phonemizer = null;
    throw err;
  });
  return phonemizer;
}

async function phonemize(text, espeakVoice = config?.espeak?.voice, retry = true) {
  const module = await loadPhonemizer();
  try {
    return await new Promise((resolve, reject) => {
      waiting = { resolve, reject };
      module.callMain(['-l', espeakVoice, '--input', JSON.stringify([{ text }]), '--espeak_data', '/espeak-ng-data']);
    });
  } catch (err) {
    // se il modulo non accetta un'altra esecuzione se ne crea uno nuovo, una volta
    if (!retry) throw err;
    phonemizer = null;
    return phonemize(text, espeakVoice, false);
  } finally {
    waiting = null;
  }
}

/**
 * @param {string} text
 * @param {{ lengthScale?: number, noiseScale?: number, noiseW?: number }} opts
 */
async function synth(text, opts) {
  const ids = await phonemize(text.trim());
  const inf = config.inference || {};
  const scales = [
    opts.noiseScale ?? inf.noise_scale ?? 0.667,
    opts.lengthScale ?? inf.length_scale ?? 1,
    opts.noiseW ?? inf.noise_w ?? 0.8,
  ];
  const feeds = {
    input: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
    input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
    scales: new ort.Tensor('float32', Float32Array.from(scales), [3]),
  };
  if (Object.keys(config.speaker_id_map || {}).length) feeds.sid = new ort.Tensor('int64', BigInt64Array.from([0n]), [1]);
  const { output } = await session.run(feeds);
  return { pcm: new Float32Array(output.data), rate: config.audio.sample_rate };
}

async function handle({ type, id, ...data }) {
  if (type === 'init') {
    await init(data.voiceId, data.wasmPaths, data.modelUrl);
    self.postMessage({ type: 'ready', id, inference: config.inference || {} });
  } else if (type === 'synth') {
    const { pcm, rate } = await synth(data.text, data.opts || {});
    self.postMessage({ type: 'audio', id, pcm, rate }, [pcm.buffer]);
  } else if (type === 'phonemes') {
    // controllo diagnostico: fonemizzazione senza bisogno del modello vocale
    paths = data.wasmPaths;
    const texts = Array.isArray(data.text) ? data.text : [data.text];
    const times = [];
    let ids;
    for (const t of texts) {
      const start = performance.now();
      ids = await phonemize(t, data.espeakVoice || 'it');
      times.push(Math.round(performance.now() - start));
    }
    self.postMessage({ type: 'phonemes', id, ids, times });
  } else if (type === 'flush') {
    await caches.delete(CACHE).catch(() => {});
    try {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry('piper', { recursive: true });
    } catch { /* niente da cancellare */ }
    self.postMessage({ type: 'flushed', id });
  }
}

// una richiesta alla volta: la sessione ONNX non è rientrante
self.onmessage = ({ data }) => {
  queue = queue.then(() => handle(data)).catch((err) => {
    self.postMessage({ type: 'error', id: data.id, message: String(err?.message || err) });
  });
};
