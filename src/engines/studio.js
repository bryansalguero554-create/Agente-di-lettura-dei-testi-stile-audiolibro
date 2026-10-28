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
  if (question) trimmed = pitchContour(trimmed, rate, questionContour(question));
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
  if (question) voice = pitchContour(voice, rate, questionContour(question));
  return { pcm: fade(normalizeLoudness(voice), rate), rate };
}

const WH_WORDS = /^[\s«“"'(—–-]*(chi|che cosa|cosa|che|come|dove|quando|perché|perche|quale|quali|quanto|quanta|quanti|quante)(?=[\s,?!.]|$)/i;

/**
 * Curva d'intonazione della domanda italiana, come rapporto di altezza lungo la frase
 * (0 = inizio, 1 = fine). Domande sì/no («Siamo arrivati?»): voce invariata, piccola
 * discesa sull'ultima parola e risalita finale. Domande con chi/come/dove/perché:
 * attacco appena più alto e risalita lieve.
 * @returns {(t: number) => number}
 */
export function questionContour(text) {
  const smooth = (a, b, t) => a + (b - a) * (0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, t))));
  if (WH_WORDS.test(text)) {
    return (t) => (t < 0.25 ? smooth(1.05, 1, t / 0.25) : t < 0.75 ? 1 : smooth(1, 1.08, (t - 0.75) / 0.22));
  }
  return (t) => (t < 0.55 ? 1 : t < 0.72 ? smooth(1, 0.96, (t - 0.55) / 0.17) : smooth(0.96, 1.19, (t - 0.72) / 0.24));
}

/** Rapporto di altezza raggiunto alla fine della domanda. */
export function questionRise(text) {
  return questionContour(text)(1);
}

/**
 * Trova la frequenza della voce (periodo in campioni) a intervalli di 5 ms con il metodo YIN.
 * 0 = tratto non vocalizzato (consonanti sorde, pause).
 */
export function trackPeriods(x, rate) {
  const hop = Math.round(rate * 0.005);
  const win = Math.round(rate * 0.03);
  const minLag = Math.floor(rate / 420);
  const maxLag = Math.ceil(rate / 65);
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  const d = new Float32Array(maxLag + 1);
  const periods = [];
  for (let start = 0; start + win + maxLag < x.length; start += hop) {
    let energy = 0;
    for (let j = 0; j < win; j++) energy += x[start + j] * x[start + j];
    if (Math.sqrt(energy / win) < peak * 0.04) { periods.push(0); continue; }
    let running = 0;
    let found = 0;
    for (let lag = 1; lag <= maxLag; lag++) {
      let sum = 0;
      for (let j = 0; j < win; j++) { const diff = x[start + j] - x[start + j + lag]; sum += diff * diff; }
      running += sum;
      d[lag] = (sum * lag) / (running || 1);
    }
    let bestLag = 0;
    for (let lag = minLag; lag < maxLag; lag++) {
      if (d[lag] < 0.2 && d[lag] <= d[lag + 1]) { found = lag; break; }
      if (!bestLag || d[lag] < d[bestLag]) bestLag = lag;
    }
    // nessun minimo netto: si accetta il migliore se abbastanza periodico
    if (!found && bestLag && d[bestLag] < 0.35) found = bestLag;
    periods.push(found);
  }
  return { hop, periods };
}

/**
 * Cambia l'altezza della voce lungo la frase senza cambiarne né la durata né il timbro
 * (TD-PSOLA): ogni vibrazione delle corde vocali viene ritagliata e riposizionata più
 * vicina alle altre, quindi sale solo la nota, non le risonanze della bocca.
 * @param {Float32Array} pcm
 * @param {number} rate
 * @param {(t: number) => number} contour rapporto di altezza in funzione della posizione (0..1)
 */
export function pitchContour(pcm, rate, contour) {
  const n = pcm.length;
  if (n < rate * 0.15) return pcm;
  // si lavora solo dove la curva si allontana da 1: il resto resta identico all'originale
  let first = n;
  for (let i = 0; i < n; i += Math.round(rate * 0.005)) if (Math.abs(contour(i / n) - 1) > 0.002) { first = i; break; }
  if (first >= n) return pcm;
  const fadeLen = Math.round(rate * 0.03);
  const from = Math.max(0, first - Math.round(rate * 0.06));
  const part = pcm.subarray(from);
  const shifted = psola(part, rate, (t) => contour((from + t * part.length) / n));
  const out = Float32Array.from(pcm);
  for (let i = 0; i < part.length; i++) {
    const k = Math.min(1, i / fadeLen);
    out[from + i] = pcm[from + i] * (1 - k) + shifted[i] * k;
  }
  return out;
}

// TD-PSOLA con segni di vibrazione allineati per somiglianza della forma d'onda
function psola(x, rate, contour) {
  const n = x.length;
  const { hop, periods } = trackPeriods(x, rate);
  const periodAt = (i) => periods[Math.min(periods.length - 1, Math.max(0, Math.round(i / hop)))] || 0;
  const fallback = Math.round(rate * 0.005);
  const marks = [];
  let prev = -1;
  for (let i = 0; i < n;) {
    const T = periodAt(i);
    if (!T) { marks.push({ at: i, T: fallback, voiced: false }); prev = -1; i += fallback; continue; }
    let best = i;
    if (prev >= 0 && i - prev < T * 1.5) {
      // la vibrazione successiva è quella che somiglia di più alla precedente
      let bestScore = -Infinity;
      const half = Math.round(T / 2);
      for (let c = prev + Math.round(T * 0.8); c <= prev + Math.round(T * 1.2); c++) {
        if (c - half < 0 || c + half >= n) continue;
        let sc = 0;
        for (let k = -half; k < half; k++) sc += x[prev + k] * x[c + k];
        if (sc > bestScore) { bestScore = sc; best = c; }
      }
    } else {
      for (let j = i; j < Math.min(n, i + T); j++) if (Math.abs(x[j]) > Math.abs(x[best])) best = j;
    }
    if (best >= n) break;
    marks.push({ at: best, T, voiced: true });
    prev = best;
    i = best + Math.max(1, Math.round(T * 0.9));
  }
  if (marks.length < 3) return x;

  const out = new Float32Array(n);
  const norm = new Float32Array(n);
  let m = 0;
  for (let t = marks[0].at; t < n;) {
    while (m + 1 < marks.length && Math.abs(marks[m + 1].at - t) <= Math.abs(marks[m].at - t)) m++;
    const { at, T, voiced } = marks[m];
    const r = voiced ? contour(t / n) : 1;
    const L = 2 * T;
    for (let k = -T; k < T; k++) {
      const src = at + k;
      const dst = Math.round(t + k);
      if (src < 0 || src >= n || dst < 0 || dst >= n) continue;
      const w = 0.5 + 0.5 * Math.cos((Math.PI * 2 * k) / L);
      out[dst] += x[src] * w;
      norm[dst] += w;
    }
    // passo reale fino alla vibrazione successiva, accorciato del rapporto: nota più alta
    const step = m + 1 < marks.length ? marks[m + 1].at - at : T;
    t += voiced && marks[m + 1]?.voiced ? step / r : step;
  }
  for (let i = 0; i < n; i++) out[i] = norm[i] > 0.05 ? out[i] / norm[i] : x[i];
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
