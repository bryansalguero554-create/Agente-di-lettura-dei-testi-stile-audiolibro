// Il narratore: legge il libro frase per frase, prepara in anticipo l'audio delle frasi
// successive, inserisce pause naturali e segnala la posizione per l'evidenziazione.

import { normalizeForSpeech } from './text/normalize-it.js';
import { splitQuoted } from './text/segment.js';

const PACE = { compatto: 0.6, naturale: 1, disteso: 1.45 };
const PREFETCH = 3;

/** Pausa (ms a velocità 1x) dopo una frase, in base a punteggiatura e struttura. */
export function pauseAfter(sentence, next, pace = 'naturale') {
  let ms = { statement: 380, question: 480, exclamation: 430, suspense: 750 }[sentence.mood] ?? 380;
  if (sentence.heading) ms = 950;
  if (next && next.paragraph !== sentence.paragraph) ms += 420;
  if (next?.heading) ms += 600;
  if (next && !sentence.heading && !next.heading && (next.dialogue >= 0.5) !== (sentence.dialogue >= 0.5)) ms += 150;
  return ms * (PACE[pace] ?? 1);
}

/**
 * Divide una frase in unità da pronunciare: con la voce per i dialoghi attiva, le battute
 * tra virgolette vengono separate dalla narrazione.
 */
export function speechUnits(sentence, { dialogueVoice = false } = {}) {
  const base = { heading: !!sentence.heading, mood: sentence.mood };
  if (sentence.heading) return [{ ...base, text: sentence.text.replace(/[.:]?$/, '.'), dialogue: false }];
  if (dialogueVoice && sentence.dialogue > 0 && sentence.dialogue < 1) {
    const parts = splitQuoted(sentence.text, sentence.inQuote);
    if (parts.length > 1) return parts.map((p) => ({ ...base, text: p.text, dialogue: p.dialogue }));
  }
  return [{ ...base, text: sentence.text, dialogue: sentence.dialogue >= 0.5 }];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// WAV silenzioso in loop: tiene attiva la sessione audio (iPhone, schermo bloccato)
// durante le pause e mentre la frase successiva viene sintetizzata.
function silentWavUrl() {
  const rate = 8000;
  const samples = rate; // 1 secondo
  const buf = new ArrayBuffer(44 + samples * 2);
  const v = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + samples * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true);
  v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, samples * 2, true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

export class Player extends EventTarget {
  book = null;
  chapter = 0;
  sentence = 0;
  state = 'idle'; // idle | loading | playing | paused
  rate = 1;
  volume = 1;

  #engine = null;
  #settings;
  #runId = 0;
  #cache = new Map();
  #abort = new AbortController();
  #audio;
  #keepAlive;
  #playbackDone = null;

  /** @param {{ settings: () => any }} opts */
  constructor({ settings }) {
    super();
    this.#settings = settings;
    if (typeof Audio !== 'undefined') {
      this.#audio = new Audio();
      this.#audio.preload = 'auto';
      this.#keepAlive = new Audio(silentWavUrl());
      this.#keepAlive.loop = true;
    }
  }

  get audioElement() { return this.#audio; }

  #emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  #setState(state) {
    if (this.state === state) return;
    this.state = state;
    this.#emit('state', { state });
  }

  setEngine(engine) {
    const wasPlaying = this.state === 'playing' || this.state === 'loading';
    this.#stopOutput();
    this.#engine = engine;
    this.clearCache();
    if (wasPlaying) this.play();
  }

  get engine() { return this.#engine; }

  /** Svuota l'audio pre-caricato (cambio di voce, velocità del motore o impostazioni). */
  clearCache() {
    this.#abort.abort();
    this.#abort = new AbortController();
    this.#cache.forEach((p) => p.then((url) => url && URL.revokeObjectURL(url), () => {}));
    this.#cache.clear();
  }

  load(book, position = { chapter: 0, sentence: 0 }) {
    this.stop();
    this.clearCache();
    this.book = book;
    this.chapter = Math.min(position.chapter || 0, book.chapters.length - 1);
    this.sentence = Math.min(position.sentence || 0, book.chapters[this.chapter].sentences.length - 1);
    this.#emitPosition();
  }

  #emitPosition() {
    this.#emit('position', { chapter: this.chapter, sentence: this.sentence });
  }

  get current() {
    return this.book?.chapters[this.chapter]?.sentences[this.sentence];
  }

  #voiceFor(unit) {
    const s = this.#settings();
    const id = this.#engine?.id;
    if (unit.dialogue && s.dialogueVoiceEnabled && s.dialogueVoices?.[id]) return s.dialogueVoices[id];
    return s.voices?.[id];
  }

  #ctxFor(chapter, index, unit) {
    const sentences = this.book.chapters[chapter].sentences;
    return {
      voice: this.#voiceFor(unit),
      dialogue: unit.dialogue,
      mood: unit.mood,
      heading: unit.heading,
      previousText: sentences[index - 1]?.text,
      nextText: sentences[index + 1]?.text,
      signal: this.#abort.signal,
    };
  }

  #units(chapter, index) {
    const s = this.book.chapters[chapter].sentences[index];
    return speechUnits(s, { dialogueVoice: this.#settings().dialogueVoiceEnabled }).map((u) => ({
      ...u,
      spoken: normalizeForSpeech(u.text),
    }));
  }

  // Per i motori audio: promessa dell'URL dell'audio di una unità, con cache.
  #audioFor(chapter, index, unitIndex, unit) {
    const key = `${chapter}:${index}:${unitIndex}:${this.#voiceFor(unit)}`;
    if (!this.#cache.has(key)) {
      const engine = this.#engine;
      const p = engine.synthesize(unit.spoken, this.#ctxFor(chapter, index, unit)).then((blob) => URL.createObjectURL(blob));
      p.catch(() => this.#cache.delete(key));
      this.#cache.set(key, p);
      // limitiamo la memoria: teniamo al massimo ~40 clip
      if (this.#cache.size > 40) {
        const [oldKey, oldP] = this.#cache.entries().next().value;
        this.#cache.delete(oldKey);
        oldP.then((u) => URL.revokeObjectURL(u), () => {});
      }
    }
    return this.#cache.get(key);
  }

  #prefetch(chapter, index) {
    if (this.#engine?.kind !== 'audio') return;
    let c = chapter;
    let i = index;
    for (let n = 0; n < PREFETCH; n++) {
      i++;
      if (i >= this.book.chapters[c].sentences.length) {
        c++;
        i = 0;
        if (c >= this.book.chapters.length) return;
      }
      this.#units(c, i).forEach((u, k) => this.#audioFor(c, i, k, u).catch(() => {}));
    }
  }

  async play() {
    if (!this.book || !this.#engine) return;
    if (this.state === 'playing' || this.state === 'loading') return;
    const runId = ++this.#runId;
    this.#setState('loading');
    if (this.#engine.kind === 'audio') this.#unlockAudio();
    try {
      await this.#engine.prepare(this.#settings().voices?.[this.#engine.id]);
    } catch (err) {
      if (runId !== this.#runId) return;
      this.#fail(err);
      return;
    }
    if (runId !== this.#runId) return;
    this.#loop(runId);
  }

  // iOS consente audio programmato solo su elementi già avviati durante un tocco
  // dell'utente: play() viene chiamato in modo sincrono dal gesto.
  #unlockAudio() {
    if (!this.#audio) return;
    this.#keepAlive.play().catch(() => {});
    if (!this.#audio.src) {
      const silent = this.#keepAlive.src;
      this.#audio.src = silent;
      this.#audio.play().then(() => { if (this.#audio.src === silent) this.#audio.pause(); }, () => {});
    }
  }

  async #loop(runId) {
    const alive = () => runId === this.#runId;
    while (alive()) {
      const { chapter, sentence } = this;
      const s = this.current;
      if (!s) break;
      this.#emitPosition();
      const settings = this.#settings();
      const skip = s.heading && settings.announceChapters === false;
      try {
        if (!skip) {
          const units = this.#units(chapter, sentence);
          if (this.#engine.kind === 'audio') {
            const urls = units.map((u, k) => this.#audioFor(chapter, sentence, k, u));
            this.#prefetch(chapter, sentence);
            for (const urlP of urls) {
              const url = await urlP;
              if (!alive()) return;
              this.#setState('playing');
              await this.#playUrl(url);
              if (!alive()) return;
            }
          } else {
            this.#setState('playing');
            for (const u of units) {
              await this.#engine.speak(u.spoken, { ...this.#ctxFor(chapter, sentence, u), rate: this.rate, volume: this.volume });
              if (!alive()) return;
            }
          }
        }
      } catch (err) {
        if (!alive() || err?.name === 'AbortError') return;
        this.#fail(err);
        return;
      }
      if (!alive()) return;

      // avanzamento e pausa naturale
      const sentences = this.book.chapters[chapter].sentences;
      const atChapterEnd = sentence + 1 >= sentences.length;
      const nextSentence = atChapterEnd ? this.book.chapters[chapter + 1]?.sentences[0] : sentences[sentence + 1];
      if (!skip) await sleep(pauseAfter(s, nextSentence, settings.pace) / this.rate);
      if (!alive()) return;

      if (atChapterEnd) {
        if (chapter + 1 >= this.book.chapters.length) {
          this.#emit('bookend');
          this.stop();
          return;
        }
        this.chapter = chapter + 1;
        this.sentence = 0;
        this.#emit('chapterend', { chapter });
        if (!alive()) return; // il timer "fine capitolo" può aver messo in pausa
      } else {
        this.sentence = sentence + 1;
      }
    }
  }

  #playUrl(url) {
    const audio = this.#audio;
    return new Promise((resolve, reject) => {
      this.#playbackDone = resolve;
      audio.onended = () => resolve();
      audio.onerror = () => reject(new Error('Impossibile riprodurre l\'audio generato.'));
      audio.src = url;
      audio.playbackRate = this.rate;
      audio.preservesPitch = true;
      audio.volume = this.volume;
      audio.play().catch((err) => {
        // Safari/iOS: serve un tocco dell'utente per avviare l'audio
        if (err?.name === 'NotAllowedError') this.pause();
        else reject(err);
      });
    });
  }

  #fail(err) {
    this.#runId++;
    this.#stopOutput();
    this.#setState('paused');
    this.#emit('error', { message: err?.message || String(err) });
  }

  #stopOutput() {
    if (this.#audio) {
      this.#audio.onended = null;
      this.#audio.pause();
    }
    this.#playbackDone?.();
    this.#playbackDone = null;
    this.#engine?.stop?.();
    this.#keepAlive?.pause();
  }

  pause() {
    if (this.state === 'idle' || this.state === 'paused') return;
    this.#runId++;
    this.#stopOutput();
    this.#setState('paused');
  }

  stop() {
    this.#runId++;
    this.#stopOutput();
    this.#setState('idle');
  }

  toggle() {
    if (this.state === 'playing' || this.state === 'loading') this.pause();
    else this.play();
  }

  /** Salta a una posizione; se stava leggendo continua da lì. */
  seek(chapter, sentence = 0) {
    if (!this.book) return;
    const resume = this.state === 'playing' || this.state === 'loading';
    if (resume) {
      this.#runId++;
      this.#stopOutput();
      this.state = 'paused';
    }
    this.chapter = Math.max(0, Math.min(chapter, this.book.chapters.length - 1));
    const n = this.book.chapters[this.chapter].sentences.length;
    this.sentence = Math.max(0, Math.min(sentence, n - 1));
    this.#emitPosition();
    if (resume) this.play();
  }

  nextSentence() {
    const n = this.book.chapters[this.chapter].sentences.length;
    if (this.sentence + 1 < n) this.seek(this.chapter, this.sentence + 1);
    else this.nextChapter();
  }

  prevSentence() {
    if (this.sentence > 0) this.seek(this.chapter, this.sentence - 1);
    else if (this.chapter > 0) this.seek(this.chapter - 1, this.book.chapters[this.chapter - 1].sentences.length - 1);
  }

  nextChapter() {
    if (this.chapter + 1 < this.book.chapters.length) this.seek(this.chapter + 1, 0);
  }

  prevChapter() {
    // come nei lettori audio: se si è già avanti nel capitolo si torna al suo inizio
    if (this.sentence > 2 || this.chapter === 0) this.seek(this.chapter, 0);
    else this.seek(this.chapter - 1, 0);
  }

  setRate(rate) {
    this.rate = rate;
    if (this.#audio) this.#audio.playbackRate = rate;
  }

  setVolume(volume) {
    this.volume = volume;
    if (this.#audio) this.#audio.volume = volume;
  }
}
