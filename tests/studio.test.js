import { describe, it, expect } from 'vitest';
import { trimSilence, normalizeLoudness, fade, studioMaster, floatToWav } from '../src/engines/studio.js';
import { piperProsody } from '../src/engines/piper.js';

const tone = (n, amp = 0.3) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin(i / 5));

describe('voce da studio', () => {
  it('toglie i silenzi ai bordi lasciando un respiro', () => {
    const pcm = new Float32Array(3000);
    pcm.set(tone(1000), 1000);
    const out = trimSilence(pcm, 22050);
    expect(out.length).toBeLessThan(1000 + 2 * 552); // 25 ms di respiro per lato
    expect(out.length).toBeGreaterThan(1000);
  });

  it('porta frasi forti e deboli allo stesso volume senza saturare', () => {
    const rms = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
    const soft = normalizeLoudness(tone(4000, 0.05));
    const loud = normalizeLoudness(tone(4000, 0.6));
    expect(Math.abs(rms(soft) - rms(loud))).toBeLessThan(0.01);
    expect(Math.max(...loud.map(Math.abs))).toBeLessThanOrEqual(0.89 + 1e-6);
  });

  it('sfuma i bordi e produce un WAV valido', async () => {
    const out = fade(tone(2000), 22050);
    expect(out[0]).toBe(0);
    const { pcm, rate } = await studioMaster(tone(5000), 22050);
    const wav = floatToWav(pcm, rate);
    expect(wav.size).toBe(44 + pcm.length * 2);
  });

  it('regia di Paola: domande più vive, titoli più lenti', () => {
    expect(piperProsody({ mood: 'question' }).noiseScale).toBeGreaterThan(piperProsody({}).noiseScale);
    expect(piperProsody({ heading: true }).lengthScale).toBeGreaterThan(piperProsody({}).lengthScale);
  });
});

describe('intonazione delle domande', async () => {
  const { pitchContour, questionRise, questionContour, trackPeriods } = await import('../src/engines/studio.js');
  const rate = 22050;

  // vocale sintetica: impulsi glottali a f0 filtrati da una risonanza (formante) a 900 Hz
  function vowel(f0, seconds = 1) {
    const n = Math.round(rate * seconds);
    const x = new Float32Array(n);
    const T = rate / f0;
    let y1 = 0;
    let y2 = 0;
    const r = 0.97;
    const w = (2 * Math.PI * 900) / rate;
    for (let i = 0; i < n; i++) {
      const pulse = i % Math.round(T) === 0 ? 1 : 0;
      const y = pulse + 2 * r * Math.cos(w) * y1 - r * r * y2;
      y2 = y1;
      y1 = y;
      x[i] = y * 0.05;
    }
    return x;
  }
  const f0At = (x, a, b) => {
    const { periods } = trackPeriods(x.subarray(a, b), rate);
    const v = periods.filter(Boolean).sort((p, q) => p - q);
    return rate / v[Math.floor(v.length / 2)];
  };
  // frequenza in cui cade la maggior parte dell'energia sopra i 400 Hz (la formante)
  const formant = (x, a, b) => {
    let best = 0;
    let bestF = 0;
    for (let f = 400; f < 2000; f += 20) {
      let re = 0;
      let im = 0;
      for (let i = a; i < b; i++) { re += x[i] * Math.cos((2 * Math.PI * f * i) / rate); im += x[i] * Math.sin((2 * Math.PI * f * i) / rate); }
      const p = re * re + im * im;
      if (p > best) { best = p; bestF = f; }
    }
    return bestF;
  };

  it('alza la nota alla fine senza cambiare durata né timbro', () => {
    const x = vowel(150);
    const out = pitchContour(x, rate, questionContour('«Siamo arrivati?»'));
    expect(out.length).toBe(x.length);
    const startF0 = f0At(out, 2000, 7000);
    const endF0 = f0At(out, rate - 2500, rate - 300);
    expect(startF0).toBeGreaterThan(140);
    expect(startF0).toBeLessThan(160);
    expect(endF0 / startF0).toBeGreaterThan(1.1);
    // il timbro (formante) resta dov'era: il vecchio metodo lo spostava del 20%
    const fA = formant(x, rate - 2500, rate - 300);
    const fB = formant(out, rate - 2500, rate - 300);
    expect(Math.abs(fB - fA) / fA).toBeLessThan(0.08);
  });

  it('domande sì/no salgono più di quelle con chi/come/dove', () => {
    expect(questionRise('«Siamo arrivati?»')).toBeGreaterThan(questionRise('Dove vai?'));
    expect(questionRise('Perché sei qui?')).toBeLessThan(1.1);
    expect(questionContour('Siamo arrivati?')(0.3)).toBe(1); // l'inizio della frase non cambia
  });
});
