// Timer di spegnimento: a tempo (con dissolvenza finale) oppure a fine capitolo.

const FADE_MS = 12000;

export class SleepTimer extends EventTarget {
  mode = null; // null | 'time' | 'chapter'
  endsAt = 0;
  #tick = null;

  /** @param {import('./player.js').Player} player */
  constructor(player) {
    super();
    this.player = player;
    player.addEventListener('chapterend', () => {
      if (this.mode === 'chapter') this.#finish();
    });
  }

  start(minutes) {
    this.cancel();
    this.mode = 'time';
    this.endsAt = Date.now() + minutes * 60000;
    this.#tick = setInterval(() => this.#update(), 500);
    this.#update();
  }

  untilChapterEnd() {
    this.cancel();
    this.mode = 'chapter';
    this.#emit();
  }

  /** Aggiunge minuti al timer in corso (es. "ancora 5 minuti"). */
  extend(minutes) {
    if (this.mode !== 'time') return this.start(minutes);
    this.endsAt += minutes * 60000;
    this.player.setVolume(1);
    this.#update();
  }

  cancel() {
    clearInterval(this.#tick);
    this.#tick = null;
    if (this.mode) this.player.setVolume(1);
    this.mode = null;
    this.endsAt = 0;
    this.#emit();
  }

  get remainingMs() {
    return this.mode === 'time' ? Math.max(0, this.endsAt - Date.now()) : 0;
  }

  #update() {
    const left = this.remainingMs;
    if (left <= 0) return this.#finish();
    // durante la lettura il tempo scorre; in pausa il timer si "congela"
    if (this.player.state !== 'playing' && this.player.state !== 'loading') {
      this.endsAt += 500;
    } else if (left < FADE_MS) {
      this.player.setVolume(Math.max(0.05, left / FADE_MS));
    }
    this.#emit();
  }

  #finish() {
    this.player.pause();
    this.cancel();
    this.dispatchEvent(new CustomEvent('finished'));
  }

  #emit() {
    this.dispatchEvent(new CustomEvent('change', { detail: { mode: this.mode, remainingMs: this.remainingMs } }));
  }
}
