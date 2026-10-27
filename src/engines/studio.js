// "Voce da studio": rifinitura dell'audio della voce neurale offline, come in una sala
// d'incisione. Toglie i silenzi ai bordi, scalda la voce, smussa le asprezze metalliche,
// comprime, aggiunge un velo d'ambiente e porta tutte le frasi allo stesso volume.

const OUT_RATE = 44100;
const TARGET_RMS = 0.1; // circa -20 dBFS: volume da audiolibro
const PEAK_LIMIT = 0.89; // -1 dBFS

/** Toglie il silenzio all'inizio e alla fine, lasciando un respiro di pochi millisecondi. */
export function trimSilence(pcm, rate, threshold = 0.012, keepMs = 25) {
  const keep = Math.round((rate * keepMs) / 1000);
  let start = 0;
  let end = pcm.length - 1;
  while (start < pcm.length && Math.abs(pcm[start]) < threshold) start++;
  while (end > start && Math.abs(pcm[end]) < threshold) end--;
  if (start >= end) return pcm;
  return pcm.subarray(Math.max(0, start - keep), Math.min(pcm.length, end + keep + 1));
}

/** Porta il volume medio della voce al livello di riferimento, senza superare il limite di picco. */
export function normalizeLoudness(pcm, target = TARGET_RMS, peakLimit = PEAK_LIMIT) {
  let sum = 0;
  let count = 0;
  let peak = 0;
  for (const v of pcm) {
    const a = Math.abs(v);
    if (a > 0.01) { sum += v * v; count++; } // solo le parti parlate
    if (a > peak) peak = a;
  }
  if (!count || !peak) return pcm;
  const rms = Math.sqrt(sum / count);
  const gain = Math.min(target / rms, peakLimit / peak, 8);
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] * gain;
  return out;
}

/** Dissolvenza breve ai bordi contro i "click". */
export function fade(pcm, rate, ms = 6) {
  const n = Math.min(Math.round((rate * ms) / 1000), Math.floor(pcm.length / 2));
  for (let i = 0; i < n; i++) {
    const k = i / n;
    pcm[i] *= k;
    pcm[pcm.length - 1 - i] *= k;
  }
  return pcm;
}

// riverbero da piccola sala: rumore che si spegne in fretta, già filtrato
function roomImpulse(ctx, seconds = 0.32) {
  const len = Math.round(ctx.sampleRate * seconds);
  const ir = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = ir.getChannelData(0);
  let lp = 0;
  for (let i = 0; i < len; i++) {
    const t = i / len;
    lp = lp * 0.6 + (Math.random() * 2 - 1) * 0.4; // morbidezza: niente sibili nel riverbero
    d[i] = lp * Math.pow(1 - t, 3.2);
  }
  return ir;
}

/**
 * Passa la voce nella catena da studio. Nel browser usa la Web Audio API
 * (OfflineAudioContext); altrove applica solo le correzioni di base.
 * @param {Float32Array} pcm
 * @param {number} rate
 * @returns {Promise<{ pcm: Float32Array, rate: number }>}
 */
export async function studioMaster(pcm, rate) {
  const trimmed = trimSilence(pcm, rate);
  const Offline = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!Offline) return { pcm: fade(normalizeLoudness(trimmed), rate), rate };

  const tail = 0.25; // spazio per la coda del riverbero
  const length = Math.ceil((trimmed.length / rate + tail) * OUT_RATE);
  const ctx = new Offline(1, length, OUT_RATE);
  const buffer = ctx.createBuffer(1, trimmed.length, rate);
  buffer.copyToChannel(Float32Array.from(trimmed), 0);
  const src = ctx.createBufferSource();
  src.buffer = buffer;

  const filter = (type, frequency, gain = 0, Q = 0.7) => {
    const f = ctx.createBiquadFilter();
    Object.assign(f, { type });
    f.frequency.value = frequency;
    f.gain.value = gain;
    f.Q.value = Q;
    return f;
  };
  const chain = [
    filter('highpass', 70, 0, 0.7), // via rimbombi e fruscii bassi
    filter('lowshelf', 190, 2.5), // calore e corpo
    filter('peaking', 1100, -1.2, 0.9), // meno "nasale"
    filter('peaking', 3600, -2.2, 1.4), // smussa la parte metallica tipica delle voci sintetiche
    filter('peaking', 6800, -2.5, 2.2), // de-esser: sibilanti più morbide
    filter('highshelf', 9500, -2), // meno fruscio
  ];
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -24;
  comp.knee.value = 14;
  comp.ratio.value = 2.6;
  comp.attack.value = 0.006;
  comp.release.value = 0.16;

  const dry = ctx.createGain();
  dry.gain.value = 1;
  const wet = ctx.createGain();
  wet.gain.value = 0.06; // un velo d'ambiente, non un'eco
  const reverb = ctx.createConvolver();
  reverb.normalize = true;
  reverb.buffer = roomImpulse(ctx);

  let node = src;
  for (const f of chain) { node.connect(f); node = f; }
  node.connect(comp);
  comp.connect(dry).connect(ctx.destination);
  comp.connect(reverb).connect(wet).connect(ctx.destination);
  src.start();
  const rendered = await ctx.startRendering();
  const out = trimSilence(rendered.getChannelData(0), OUT_RATE, 0.004, 60);
  return { pcm: fade(normalizeLoudness(Float32Array.from(out)), OUT_RATE), rate: OUT_RATE };
}

/** Float32 [-1, 1] → WAV 16 bit mono. */
export function floatToWav(pcm, rate) {
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true);
  v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, pcm.length * 2, true);
  for (let i = 0, o = 44; i < pcm.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}
