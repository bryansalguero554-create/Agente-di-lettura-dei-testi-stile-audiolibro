import { describe, it, expect } from 'vitest';
import { squash, buildStream, alignBook, sentenceAtPosition } from '../src/views/align.js';
import { mergeLines } from '../src/views/pdf-view.js';
import { buildBook } from '../src/book.js';
import { pcmToWav, GEMINI_MODELS } from '../src/engines/cloud.js';
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
  it('invia a Gemini solo il testo del libro e accetta audio WAV o PCM', async () => {
    expect(GEMINI_MODELS[0][0]).toBe('gemini-3.8-flash-tts');
    const { GeminiEngine } = await import('../src/engines/cloud.js');
    const bodies = [];
    const wav = btoa('RIFF' + 'x'.repeat(40));
    globalThis.fetch = async (url, opts) => {
      bodies.push(JSON.parse(opts.body));
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/wav', data: wav } }] } }] }));
    };
    const blob = await new GeminiEngine(() => 'k', () => undefined).synthesize('Era notte.');
    expect(bodies[0].contents[0].parts[0].text).toBe('Era notte.');
    expect(bodies[0].systemInstruction).toBeUndefined();
    expect(blob.size).toBe(44); // il WAV di Gemini non viene avvolto una seconda volta
  });

  it('con il limite giornaliero esaurito passa subito al modello successivo', async () => {
    const { GeminiEngine } = await import('../src/engines/cloud.js');
    const calls = [];
    const pcm = btoa(String.fromCharCode(...new Uint8Array(48)));
    globalThis.fetch = async (url) => {
      calls.push(url.match(/models\/([^:]+)/)[1]);
      if (calls.length === 1) {
        return new Response(JSON.stringify({ error: { code: 429, message: 'Quota exceeded, limit: 10', details: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }, { retryDelay: '32452s' }] } }), { status: 429 });
      }
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/l16; rate=24000', data: pcm } }] } }] }));
    };
    const started = Date.now();
    await new GeminiEngine(() => 'k', () => undefined).synthesize('Ciao.');
    expect(Date.now() - started).toBeLessThan(2000);
    expect(calls).toEqual(['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts']);
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
    // Gemini: blocchi che attraversano i paragrafi
    player.setEngine({ kind: 'audio', id: 'gemini', groupChars: 900, groupAcrossParagraphs: true });
    expect(player.groupEnd(0, 1)).toBe(4);
    expect(player.groupEnd(0, 1, 20)).toBe(1);
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

describe('audio pulito', () => {
  it('toglie il blocco di firma C2PA e aggiunge le dissolvenze', async () => {
    const { cleanWav, pcmToWav } = await import('../src/engines/cloud.js');
    const pcm = new Uint8Array(2000).fill(0x40); // campioni costanti non nulli
    const wav = new Uint8Array(await pcmToWav(pcm, 24000).arrayBuffer());
    const c2pa = new Uint8Array(16);
    c2pa.set([0x43, 0x32, 0x50, 0x41, 8, 0, 0, 0]); // chunk "C2PA" di 8 byte
    const withSig = new Uint8Array(wav.length + 16);
    withSig.set(wav);
    withSig.set(c2pa, wav.length);
    const out = new Uint8Array(await cleanWav(withSig).arrayBuffer());
    expect(out.length).toBe(44 + 2000);
    const samples = new Int16Array(out.buffer, 44);
    expect(samples[0]).toBe(0); // dissolvenza in entrata
    expect(samples[samples.length - 1]).toBe(0); // e in uscita
    expect(samples[500]).toBe(0x4040);
  });
});

describe('voci premium gratuite (Puter)', () => {
  it('usa il fornitore scelto senza chiavi e restituisce audio', async () => {
    const { PuterEngine } = await import('../src/engines/puter.js');
    const calls = [];
    const fakePuter = { ai: { txt2speech: async (text, opts) => { calls.push({ text, opts }); return { src: 'data:audio/mpeg;base64,SUQz' }; } } };
    globalThis.fetch = async () => new Response(new Uint8Array([1, 2, 3])); // lettura del data: URL
    const engine = new PuterEngine(async () => fakePuter);
    const blob = await engine.synthesize('Era notte.', { voice: 'openai:cedar', dialogue: true });
    expect(blob.size).toBe(3);
    expect(calls[0].opts).toMatchObject({ provider: 'openai', voice: 'cedar', model: 'gpt-4o-mini-tts' });
    expect(calls[0].opts.instructions).toMatch(/italian/);
    await engine.synthesize('Ciao.', { voice: 'gemini:Sulafat' });
    expect(calls[1].opts).toMatchObject({ provider: 'gemini', voice: 'Sulafat' });
  });

  it('spiega quando i crediti gratuiti sono finiti', async () => {
    const { PuterEngine } = await import('../src/engines/puter.js');
    const engine = new PuterEngine(async () => ({ ai: { txt2speech: async () => { throw { message: 'insufficient funds' }; } } }));
    await expect(engine.synthesize('x')).rejects.toMatchObject({ code: 'voice-unavailable' });
  });
});
