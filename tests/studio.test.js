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
  const { pitchContour, questionRise } = await import('../src/engines/studio.js');
  // frequenza stimata dai passaggi per lo zero in una finestra
  const freq = (pcm, rate, from, to) => {
    let z = 0;
    for (let i = from + 1; i < to; i++) if ((pcm[i - 1] < 0) !== (pcm[i] < 0)) z++;
    return (z / 2) / ((to - from) / rate);
  };

  it('alza la voce alla fine senza cambiare la durata', () => {
    const rate = 22050;
    const pcm = Float32Array.from({ length: rate }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 200 * i) / rate));
    const out = pitchContour(pcm, rate, { peak: 1.22 });
    expect(out.length).toBe(pcm.length);
    const start = freq(out, rate, 1000, 8000);
    const end = freq(out, rate, rate - 3000, rate - 1200);
    expect(start).toBeGreaterThan(190);
    expect(start).toBeLessThan(210);
    expect(end / start).toBeGreaterThan(1.15);
  });

  it('domande sì/no salgono più di quelle con chi/come/dove', () => {
    expect(questionRise('«Siamo arrivati?»')).toBeGreaterThan(questionRise('Dove vai?'));
    expect(questionRise('Perché sei qui?')).toBeLessThan(1.2);
  });
});
