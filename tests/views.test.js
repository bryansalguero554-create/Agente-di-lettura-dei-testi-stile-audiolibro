import { describe, it, expect } from 'vitest';
import { squash, buildStream, alignBook, sentenceAtPosition } from '../src/views/align.js';
import { mergeLines } from '../src/views/pdf-view.js';
import { buildBook } from '../src/book.js';
import { geminiDirection, pcmToWav, GEMINI_MODELS } from '../src/engines/cloud.js';
import { Player } from '../src/player.js';

describe('allineamento con il documento originale', () => {
  it('confronta ignorando spazi, trattini di sillabazione, virgolette e legature', () => {
    expect(squash('«Parti-\nre» ﬁne')).toBe(squash('Partire fine'));
  });

  it('ritrova le frasi nei pezzi di testo del PDF, anche spezzate su più righe', () => {
    const pieces = ['Pagina 1', 'Era una notte buia e tempe-', 'stosa. «Chi', 'va là?» chiese', 'Anna.', '12'];
    const book = buildBook({ blocks: [{ type: 'p', text: 'Era una notte buia e tempestosa. «Chi va là?» chiese Anna.' }] });
    const stream = buildStream(pieces);
    const ranges = alignBook(book, stream);
    const text = (r) => stream.chars.slice(r[0], r[1]);
    expect(text(ranges[0][0])).toBe(squash('Era una notte buia e tempestosa.'));
    expect(text(ranges[0][1])).toBe(squash('«Chi va là?» chiese Anna.'));
    // il primo carattere della seconda frase è nel terzo pezzo
    expect(stream.piece[ranges[0][1][0]]).toBe(2);
    expect(sentenceAtPosition(ranges, ranges[0][1][0] + 3)).toEqual({ chapter: 0, sentence: 1 });
  });

  it('salta le frasi assenti dal documento senza perdere le successive', () => {
    const book = buildBook({ blocks: [{ type: 'heading', level: 2, text: 'Titolo dall\'indice' }, { type: 'p', text: 'Testo vero.' }] });
    const ranges = alignBook(book, buildStream(['Testo vero.']));
    expect(ranges[0][0]).toBeNull();
    expect(ranges[0][1]).not.toBeNull();
  });

  it('unisce le parole della stessa riga in una fascia', () => {
    const merged = mergeLines([
      { page: 0, left: 10, top: 20, width: 5, height: 2 },
      { page: 0, left: 16, top: 20.1, width: 5, height: 2 },
      { page: 0, left: 10, top: 23, width: 5, height: 2 },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ left: 10, width: 11 });
  });
});

describe('Gemini', () => {
  it('dà la regia separata dal testo da leggere', async () => {
    const d = geminiDirection({ dialogue: true });
    expect(d).toMatch(/accento italiano madrelingua/);
    expect(d).toMatch(/dialoghi/);
    expect(GEMINI_MODELS[0][0]).toMatch(/tts/);
    const { GeminiEngine } = await import('../src/engines/cloud.js');
    const bodies = [];
    const pcm = btoa(String.fromCharCode(...new Uint8Array(48)));
    globalThis.fetch = async (url, opts) => {
      const body = JSON.parse(opts.body);
      bodies.push(body);
      if (body.systemInstruction) return new Response('{"error":{"message":"Developer instruction is not enabled"}}', { status: 400 });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;rate=24000', data: pcm } }] } }] }));
    };
    const engine = new GeminiEngine(() => 'k', () => undefined);
    await engine.synthesize('Era notte.');
    // il testo letto è solo quello del libro
    expect(bodies[0].contents[0].parts[0].text).toBe('Era notte.');
    expect(bodies[0].systemInstruction.parts[0].text).toMatch(/narratore/);
    // il modello non accetta istruzioni: riprova con il solo testo
    expect(bodies[1].systemInstruction).toBeUndefined();
    expect(bodies[1].contents[0].parts[0].text).toBe('Era notte.');
  });

  it('trasforma il PCM in WAV', async () => {
    const wav = pcmToWav(new Uint8Array(480), 24000);
    const head = new DataView(await wav.arrayBuffer());
    expect(wav.size).toBe(524);
    expect(head.getUint32(24, true)).toBe(24000);
  });
});

describe('lettura a paragrafi', () => {
  const book = buildBook({ blocks: [
    { type: 'heading', level: 2, text: 'Uno' },
    { type: 'p', text: 'Prima frase. Seconda frase. Terza frase.' },
    { type: 'p', text: 'Altro paragrafo.' },
  ] });

  it('raggruppa le frasi dello stesso paragrafo fino al limite di caratteri', () => {
    const player = new Player({ settings: () => ({}) });
    player.setEngine({ kind: 'audio', id: 'gemini', groupChars: 900 });
    player.load(book);
    expect(player.groupEnd(0, 0)).toBe(0); // i titoli restano da soli
    expect(player.groupEnd(0, 1)).toBe(3);
    expect(player.groupEnd(0, 2)).toBe(3);
    player.setEngine({ kind: 'audio', id: 'gemini', groupChars: 20 });
    expect(player.groupEnd(0, 1)).toBe(1);
  });
});

describe('Gemini: scelta del modello', () => {
  it('usa Gemini 3.8 Flash TTS e ripiega su un altro modello se non è disponibile', async () => {
    const { GeminiEngine } = await import('../src/engines/cloud.js');
    const calls = [];
    const pcm = btoa(String.fromCharCode(...new Uint8Array(48)));
    globalThis.fetch = async (url) => {
      calls.push(url.match(/models\/([^:]+)/)[1]);
      if (calls.length === 1) return new Response('{}', { status: 404 });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: pcm } }] } }] }));
    };
    const engine = new GeminiEngine(() => 'k', () => undefined);
    const blob = await engine.synthesize('Ciao.');
    expect(calls).toEqual(['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts']);
    expect(blob.type).toBe('audio/wav');
    await engine.synthesize('Ancora.');
    expect(calls.at(-1)).toBe('gemini-3.8-flash-lite-tts'); // ricorda il modello che funziona
  });
});

describe('Gemini: chiave gratuita', () => {
  it('salta i modelli a pagamento e spiega cosa fare se nessuno è gratuito', async () => {
    const { GeminiEngine } = await import('../src/engines/cloud.js');
    const calls = [];
    const quota = JSON.stringify({ error: { code: 429, message: 'Quota exceeded for metric: generate_content_free_tier_requests, limit: 0' } });
    globalThis.fetch = async (url) => {
      calls.push(url.match(/models\/([^:]+)/)[1]);
      return new Response(quota, { status: 429 });
    };
    const engine = new GeminiEngine(() => 'k', () => undefined);
    await expect(engine.synthesize('Ciao.')).rejects.toThrow(/fatturazione/);
    expect(calls.length).toBeGreaterThan(2); // ha provato tutti i modelli, senza attese
  });
});
