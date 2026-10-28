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
export async function studioMaster(pcm, rate, { question = null } = {}) {
  let trimmed = trimSilence(pcm, rate);
  if (question) trimmed = pitchContour(trimmed, rate, { peak: questionRise(question) });
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
    filter('lowshelf', 190, 1.5), // un po' di calore
    filter('peaking', 3600, -1.5, 1.4), // smussa la parte metallica tipica delle voci sintetiche
    filter('peaking', 6800, -1.5, 2.2), // sibilanti più morbide
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
  wet.gain.value = 0;
  const reverb = ctx.createConvolver();
  reverb.normalize = true;
  reverb.buffer = roomImpulse(ctx);

  let node = src;
  for (const f of chain) { node.connect(f); node = f; }
  node.connect(comp);
  comp.connect(dry).connect(ctx.destination);
  // il riverbero rende la voce meno naturale: resta disponibile ma spento
  if (wet.gain.value > 0) comp.connect(reverb).connect(wet).connect(ctx.destination);
  src.start();
  const rendered = await ctx.startRendering();
  const out = trimSilence(rendered.getChannelData(0), OUT_RATE, 0.004, 60);
  return { pcm: fade(normalizeLoudness(Float32Array.from(out)), OUT_RATE), rate: OUT_RATE };
}

/** Pulizia leggera e trasparente: silenzi ai bordi, volume uniforme, niente click. */
export function cleanVoice(pcm, rate, { question = null } = {}) {
  let voice = trimSilence(pcm, rate, 0.008, 40);
  if (question) voice = pitchContour(voice, rate, { peak: questionRise(question) });
  return { pcm: fade(normalizeLoudness(voice), rate), rate };
}

const WH_WORDS = /^[\s«“"'(—–-]*(chi|che cosa|cosa|che|come|dove|quando|perché|perche|quale|quali|quanto|quanta|quanti|quante)(?=[\s,?!.]|$)/i;

/**
 * Intonazione della domanda italiana: la voce sale verso la fine. Più marcata nelle
 * domande sì/no («Siamo arrivati?»), più lieve in quelle con chi/come/dove/perché.
 * @returns {number} rapporto di altezza finale (1 = nessun cambiamento)
 */
export function questionRise(text) {
  return WH_WORDS.test(text) ? 1.1 : 1.22; // circa +1,6 e +3,5 semitoni
}

/**
 * Allunga il suono (fattore alpha > 1 = più lungo) senza cambiarne l'altezza (WSOLA:
 * ogni pezzo viene allineato a quello precedente per non creare battimenti).
 * Restituisce anche, per ogni campione prodotto, la posizione corrispondente nell'originale.
 */
function wsolaStretch(x, rate, alphaAt) {
  const n = x.length;
  const N = Math.round(rate * 0.03) & ~1; // 30 ms
  const hs = N / 2;
  const tol = Math.round(rate * 0.008);
  const win = Float32Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  const cap = Math.ceil(n * 1.6) + N * 2;
  const y = new Float32Array(cap);
  const ypos = new Float32Array(cap);
  let a = 0;
  let prev = 0;
  let k = 0;
  for (; ; k++) {
    const outStart = k * hs;
    if (outStart + N >= cap) break;
    let best = Math.round(a);
    if (k > 0) {
      const nat = prev + hs; // continuazione naturale del pezzo precedente
      let bestScore = -Infinity;
      for (let d = -tol; d <= tol; d++) {
        const st = Math.round(a) + d;
        if (st < 0 || st + N > n || nat + N > n) continue;
        let sc = 0;
        for (let i = 0; i < N; i += 2) sc += x[st + i] * x[nat + i];
        if (sc > bestScore) { bestScore = sc; best = st; }
      }
    }
    if (best + N > n) break;
    for (let i = 0; i < N; i++) {
      y[outStart + i] += x[best + i] * win[i];
      ypos[outStart + i] = best + i;
    }
    prev = best;
    a += hs / alphaAt(a / n);
  }
  const len = Math.min(cap, k * hs + hs);
  return { y: y.subarray(0, len), ypos: ypos.subarray(0, len) };
}

/**
 * Cambia l'altezza della voce lungo la frase senza cambiarne la durata: allunga il suono
 * della stessa misura (WSOLA) e poi lo ricampiona. L'altezza resta invariata fino a
 * `from` (frazione della frase), poi sale dolcemente fino a `peak`.
 * @param {Float32Array} pcm
 * @param {number} rate
 * @param {{ peak: number, from?: number }} contour
 */
export function pitchContour(pcm, rate, { peak, from = 0.6 }) {
  const n = pcm.length;
  if (peak === 1 || n < rate * 0.15) return pcm;
  const ratioAt = (t) => {
    if (t <= from) return 1;
    const k = Math.min(1, (t - from) / Math.max(0.05, 1 - from - 0.06));
    return 1 + (peak - 1) * (0.5 - 0.5 * Math.cos(Math.PI * k)); // salita morbida
  };
  const { y, ypos } = wsolaStretch(pcm, rate, ratioAt);
  const out = new Float32Array(n);
  let j = 0;
  for (let o = 0; o < n; o++) {
    const j0 = Math.floor(j);
    if (j0 + 1 >= y.length) break;
    const f = j - j0;
    out[o] = y[j0] * (1 - f) + y[j0 + 1] * f;
    j += ratioAt(ypos[j0] / n); // lettura più veloce = voce più alta
  }
  return out;
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
