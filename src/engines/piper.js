// Motore neurale gratuito e offline (Piper) che gira interamente nel browser.
// Ogni voce ha il proprio worker, così narratore e voce dei dialoghi restano caricati insieme.

import { studioMaster, floatToWav } from './studio.js';

/**
 * Regia di Paola: ritmo da narratore un po' più disteso e intonazione più viva nelle
 * domande e nelle esclamazioni (noise = variazione espressiva, noiseW = variazione del ritmo).
 */
export function piperProsody(ctx = {}) {
  const p = { lengthScale: 1.06, noiseScale: 0.6, noiseW: 0.72 };
  if (ctx.heading) Object.assign(p, { lengthScale: 1.14, noiseScale: 0.5 });
  if (ctx.mood === 'question') Object.assign(p, { noiseScale: 0.7, noiseW: 0.8 });
  if (ctx.mood === 'exclamation') Object.assign(p, { noiseScale: 0.74, lengthScale: 1.0 });
  if (ctx.mood === 'suspense') Object.assign(p, { lengthScale: 1.12 });
  if (ctx.dialogue) p.noiseScale += 0.05;
  return p;
}

export const PIPER_VOICES = [
  { id: 'it_IT-paola-medium', label: 'Paola', badge: 'Neurale', size: 63.5, hint: 'Femminile, calda e chiara' },
  { id: 'it_IT-riccardo-x_low', label: 'Riccardo', badge: 'Neurale leggera', size: 28.1, hint: 'Maschile, più leggera ma meno definita' },
];

function vendorUrl(path) {
  return new URL(`vendor/${path}`, document.baseURI).href;
}

class PiperSession {
  #worker;
  #pending = new Map();
  #seq = 0;
  ready;

  constructor(voiceId, onProgress) {
    this.#worker = new Worker(new URL('./piper.worker.js', import.meta.url), { type: 'module' });
    this.#worker.onmessage = ({ data }) => {
      if (data.type === 'progress') {
        onProgress?.(data.total ? data.loaded / data.total : 0, data.loaded);
        return;
      }
      const p = this.#pending.get(data.id);
      if (!p) return;
      this.#pending.delete(data.id);
      if (data.type === 'error') p.reject(new Error(data.message));
      else p.resolve(data);
    };
    this.#worker.onerror = (e) => this.#rejectAll(new Error(e.message || 'Errore del motore neurale'));
    this.ready = voiceId
      ? this.call('init', {
        voiceId,
        wasmPaths: {
          onnxWasm: vendorUrl('ort/'),
          piperData: vendorUrl('piper/piper_phonemize.data'),
          piperWasm: vendorUrl('piper/piper_phonemize.wasm'),
        },
      })
      : Promise.resolve();
  }

  call(type, payload = {}) {
    const id = ++this.#seq;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#worker.postMessage({ type, id, ...payload });
    });
  }

  #rejectAll(err) {
    this.#pending.forEach((p) => p.reject(err));
    this.#pending.clear();
  }

  dispose() {
    this.#worker.terminate();
    this.#rejectAll(new Error('annullato'));
  }
}

export class PiperEngine {
  kind = 'audio';
  id = 'piper';
  label = 'Voce neurale gratuita (offline)';
  #sessions = new Map();
  onProgress = null;
  /** @param {() => { studio?: boolean }} [getOptions] */
  constructor(getOptions = () => ({})) { this.getOptions = getOptions; }

  async voices() {
    return PIPER_VOICES.map((v) => ({ id: v.id, label: v.label, badge: v.badge, hint: `${v.hint} · ${Math.round(v.size)} MB al primo uso` }));
  }

  bestVoiceId() {
    return PIPER_VOICES[0].id;
  }

  /** Scarica (una sola volta) e carica il modello della voce scelta. */
  prepare(voiceId) {
    voiceId = PIPER_VOICES.some((v) => v.id === voiceId) ? voiceId : this.bestVoiceId();
    let session = this.#sessions.get(voiceId);
    if (!session) {
      session = new PiperSession(voiceId, (...a) => this.onProgress?.(...a));
      this.#sessions.set(voiceId, session);
      session.ready = session.ready.catch((err) => {
        session.dispose();
        this.#sessions.delete(voiceId);
        throw new Error(`Non riesco a caricare la voce neurale (${err.message}). Controlla la connessione e riprova.`);
      });
    }
    return session.ready.then(() => session);
  }

  async synthesize(text, ctx = {}) {
    const session = await this.prepare(ctx.voice);
    // il modello intona meglio se la frase finisce con la punteggiatura
    const line = /[.!?…:;]["»”')]*$/.test(text.trim()) ? text : `${text.trim()}.`;
    const { pcm, rate } = await session.call('synth', { text: line, opts: piperProsody(ctx) });
    const out = this.getOptions().studio === false ? { pcm, rate } : await studioMaster(pcm, rate);
    return floatToWav(out.pcm, out.rate);
  }

  /** Diagnostica: trasforma un testo in fonemi (non serve il modello vocale). */
  async phonemes(text) {
    const tmp = new PiperSession(null);
    try {
      const { ids } = await tmp.call('phonemes', {
        text,
        wasmPaths: {
          onnxWasm: vendorUrl('ort/'),
          piperData: vendorUrl('piper/piper_phonemize.data'),
          piperWasm: vendorUrl('piper/piper_phonemize.wasm'),
        },
      });
      return ids;
    } finally {
      tmp.dispose();
    }
  }

  /** Cancella i modelli scaricati (utile se un download si è interrotto). */
  async clearCache() {
    this.dispose();
    const tmp = new PiperSession(null);
    try {
      await tmp.call('flush');
    } finally {
      tmp.dispose();
    }
  }

  dispose() {
    this.#sessions.forEach((s) => s.dispose());
    this.#sessions.clear();
  }
}
