import { describe, it, expect, vi } from 'vitest';
import { Player, pauseAfter, speechUnits } from '../src/player.js';
import { buildBook } from '../src/book.js';
import { SleepTimer } from '../src/sleep-timer.js';
import { openAiInstructions, elevenBody } from '../src/engines/cloud.js';

const book = buildBook({
  blocks: [
    { type: 'heading', level: 2, text: 'Capitolo 1' },
    { type: 'p', text: 'Era sera. «Vieni qui!» disse Anna.' },
    { type: 'heading', level: 2, text: 'Capitolo 2' },
    { type: 'p', text: 'Fine della storia.' },
  ],
});

// motore finto: registra le frasi e termina subito
function fakeEngine() {
  return {
    kind: 'speech',
    id: 'device',
    spoken: [],
    async prepare() {},
    speak(text, ctx) { this.spoken.push({ text, ...ctx }); return new Promise((r) => setTimeout(r, 1)); },
    stop() {},
  };
}

describe('player', () => {
  it('legge tutto il libro in ordine, normalizzando il testo', async () => {
    vi.useFakeTimers();
    const settings = { pace: 'compatto', voices: {}, dialogueVoices: {}, announceChapters: true };
    const player = new Player({ settings: () => settings });
    const engine = fakeEngine();
    player.setEngine(engine);
    player.load(book);
    const ended = new Promise((r) => player.addEventListener('bookend', r));
    player.play();
    await vi.runAllTimersAsync();
    await ended;
    expect(engine.spoken.map((s) => s.text)).toEqual([
      'Capitolo uno.', 'Era sera.', '"Vieni qui!"', 'disse Anna.', 'Capitolo due.', 'Fine della storia.',
    ]);
    expect(player.state).toBe('idle');
    vi.useRealTimers();
  });

  it('con la voce per i dialoghi separa battuta e narrazione', async () => {
    vi.useFakeTimers();
    const settings = { pace: 'naturale', voices: { device: 'narratore' }, dialogueVoices: { device: 'attrice' }, dialogueVoiceEnabled: true, announceChapters: false };
    const player = new Player({ settings: () => settings });
    const engine = fakeEngine();
    player.setEngine(engine);
    player.load(book);
    player.play();
    await vi.runAllTimersAsync();
    const voices = engine.spoken.map((s) => [s.text, s.voice]);
    expect(voices).toEqual([
      ['Era sera.', 'narratore'],
      ['"Vieni qui!"', 'attrice'],
      ['disse Anna.', 'narratore'],
      ['Fine della storia.', 'narratore'],
    ]);
    vi.useRealTimers();
  });

  it('salta, mette in pausa e cambia capitolo', () => {
    const player = new Player({ settings: () => ({}) });
    player.setEngine(fakeEngine());
    player.load(book);
    player.nextSentence();
    expect([player.chapter, player.sentence]).toEqual([0, 1]);
    player.nextChapter();
    expect([player.chapter, player.sentence]).toEqual([1, 0]);
    player.prevSentence();
    expect([player.chapter, player.sentence]).toEqual([0, 2]);
    player.prevChapter();
    expect([player.chapter, player.sentence]).toEqual([0, 0]);
  });

  it('pause più lunghe a fine paragrafo e prima dei capitoli', () => {
    const [h, a, b] = book.chapters[0].sentences;
    expect(pauseAfter(a, b)).toBeGreaterThan(300);
    expect(pauseAfter(b, book.chapters[1].sentences[0])).toBeGreaterThan(pauseAfter(a, b));
    expect(pauseAfter(h, a, 'disteso')).toBeGreaterThan(pauseAfter(h, a, 'compatto'));
  });

  it('unità di lettura per i titoli', () => {
    expect(speechUnits({ text: 'Capitolo 1', heading: true, mood: 'statement' })[0].text).toBe('Capitolo 1.');
  });

  it('il timer a fine capitolo mette in pausa', async () => {
    vi.useFakeTimers();
    const player = new Player({ settings: () => ({ voices: {}, dialogueVoices: {} }) });
    const engine = fakeEngine();
    player.setEngine(engine);
    player.load(book);
    const timer = new SleepTimer(player);
    timer.untilChapterEnd();
    player.play();
    await vi.runAllTimersAsync();
    expect(player.state).toBe('paused');
    expect([player.chapter, player.sentence]).toEqual([1, 0]);
    expect(engine.spoken.map((s) => s.text)).not.toContain('Fine della storia.');
    vi.useRealTimers();
  });
});

describe('motori premium', () => {
  it('OpenAI riceve istruzioni da narratore italiano', () => {
    expect(openAiInstructions({})).toMatch(/accento italiani|italiano/);
    expect(openAiInstructions({ dialogue: true })).toMatch(/battuta di dialogo/);
    expect(openAiInstructions({ mood: 'question' })).toMatch(/interrogativa/);
  });

  it('ElevenLabs usa il contesto e la lingua italiana', () => {
    const b = elevenBody('Ciao.', { previousText: 'Prima.', nextText: 'Dopo.', dialogue: true }, 'eleven_flash_v2_5');
    expect(b).toMatchObject({ previous_text: 'Prima.', next_text: 'Dopo.', language_code: 'it' });
    expect(b.voice_settings.stability).toBeLessThan(0.5);
    expect(elevenBody('x', { previousText: 'p' }, 'eleven_v3').previous_text).toBeUndefined();
  });
});
