// Motore neurale gratuito e offline (Piper) che gira interamente nel browser.
// Ogni voce ha il proprio worker, così narratore e voce dei dialoghi restano caricati insieme.

import { studioMaster, cleanVoice, floatToWav } from './studio.js';

/**
 * Regia della voce. Il profilo "naturale" dà al modello un po' più di libertà
 * nell'intonazione (noiseScale) e nel ritmo (noiseW) rispetto ai valori di fabbrica,
 * che suonano piatti e meccanici; "standard" usa i valori del modello.
 * @param {{ mood?: string, heading?: boolean, dialogue?: boolean }} ctx
 * @param {{ noise_scale?: number, length_scale?: number, noise_w?: number }} [base] valori del modello
 * @param {'naturale' | 'standard'} [profile]
 */
export function piperProsody(ctx = {}, base = {}, profile = 'naturale') {
  const noise = base.noise_scale ?? 0.667;
  const length = base.length_scale ?? 1;
  const noiseW = base.noise_w ?? 0.8;
  if (profile === 'standard') return { lengthScale: length, noiseScale: noise, noiseW };
  const p = { lengthScale: length * 1.02, noiseScale: noise * 1.12, noiseW: noiseW * 1.12 };
  if (ctx.heading) Object.assign(p, { lengthScale: length * 1.1, noiseScale: noise });
  if (ctx.mood === 'question' || ctx.mood === 'exclamation') p.noiseScale = noise * 1.2;
  if (ctx.mood === 'suspense') p.lengthScale = length * 1.08;
  if (ctx.dialogue) p.noiseScale += 0.03;
  return p;
}

export const PIPER_VOICES = [
  { id: 'it_IT-paola-medium', label: 'Paola', badge: 'Neurale', size: 63.5, hint: 'Femminile, calda e chiara' },
  {
    id: 'it_IT-serena-high',
    label: 'Serena',
    badge: 'Neurale alta qualità',
    size: 114,
    hint: 'Femminile, la più recente voce italiana ufficiale, in alta qualità',
    url: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/it/it_IT/serena/high/it_IT-serena-high.onnx',
  },
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
        modelUrl: PIPER_VOICES.find((v) => v.id === voiceId)?.url,
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
  /** @param {() => { studio?: boolean, profile?: 'naturale' | 'standard' }} [getOptions] */
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
    return session.ready.then((info) => {
      session.inference ??= info?.inference || {};
      return session;
    });
  }

  async synthesize(text, ctx = {}) {
    const session = await this.prepare(ctx.voice);
    // il modello intona meglio se la frase finisce con la punteggiatura
    const line = /[.!?…:;]["»”')]*$/.test(text.trim()) ? text : `${text.trim()}.`;
    const { studio = false, profile = 'naturale' } = this.getOptions();
    const { pcm, rate } = await session.call('synth', { text: line, opts: piperProsody(ctx, session.inference, profile) });
    // pulizia sempre attiva (silenzi ai bordi, volume uniforme); la rifinitura da studio è facoltativa
    const out = studio ? await studioMaster(pcm, rate) : cleanVoice(pcm, rate);
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
