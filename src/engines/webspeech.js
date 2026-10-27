// Motore "voci del dispositivo": Web Speech API con selezione automatica delle voci
// italiane più naturali (Microsoft Natural, Apple Premium/Enhanced, Google).

const QUALITY_HINTS = [
  [/natural|neural/i, 60, 'Neurale'],
  [/online/i, 40, 'Neurale'],
  [/premium/i, 55, 'Premium'],
  [/enhanced|migliorat|siri/i, 45, 'Migliorata'],
  [/google/i, 25, 'Google'],
];
const KNOWN_GOOD = /isabella|elsa|diego|giuseppe|benigno|calimero|cataldo|fabiola|fiamma|gianni|imelda|irma|lisandro|palmira|pierina|rinaldo|federica|alice|luca|paola|emma|marco|chiara|silvia/i;
const NOVELTY = /bad news|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|albert|bahh|fred|junior|ralph|kathy|grandma|grandpa|eddy|flo|reed|rocko|sandy|shelley/i;

/** Punteggio di naturalezza di una voce: più alto è meglio. */
export function scoreVoice(voice) {
  let score = 0;
  let badge = 'Standard';
  for (const [re, pts, label] of QUALITY_HINTS) {
    if (re.test(voice.name)) {
      if (pts > score) badge = label;
      score = Math.max(score, pts);
    }
  }
  if (KNOWN_GOOD.test(voice.name)) score += 8;
  if (NOVELTY.test(voice.name)) score -= 50;
  if (/^it[-_]IT$/i.test(voice.lang)) score += 5;
  if (/compact/i.test(voice.voiceURI || '')) score -= 10;
  return { score, badge };
}

/** "Microsoft Isabella Online (Natural) - Italian (Italy)" → "Isabella" */
export function cleanVoiceName(name) {
  return name
    .replace(/^Microsoft\s+/i, '')
    .replace(/\s*\((natural|neural|premium|enhanced|migliorata)\)/gi, '')
    .replace(/\s+Online\b/i, '')
    .replace(/\s*[-–]\s*(Italian|Italiano).*$/i, '')
    .replace(/\s*\((Italy|Italia|it-IT)\)/gi, '')
    .trim() || name;
}

function synth() {
  return typeof window !== 'undefined' ? window.speechSynthesis : undefined;
}

export function isSupported() {
  return !!synth() && typeof SpeechSynthesisUtterance !== 'undefined';
}

/** Elenco delle voci italiane, dalla più naturale alla meno naturale. */
export async function listItalianVoices() {
  const s = synth();
  if (!s) return [];
  let voices = s.getVoices();
  if (!voices.length) {
    voices = await new Promise((resolve) => {
      const done = () => resolve(s.getVoices());
      s.addEventListener('voiceschanged', done, { once: true });
      setTimeout(done, 2000);
    });
  }
  return voices
    .filter((v) => /^it([-_]|$)/i.test(v.lang))
    .map((v) => ({ voice: v, id: v.voiceURI || v.name, label: cleanVoiceName(v.name), ...scoreVoice(v) }))
    .sort((a, b) => b.score - a.score);
}

export class WebSpeechEngine {
  kind = 'speech';
  id = 'device';
  label = 'Voci del dispositivo';
  #utterance = null;
  #voices = [];

  async prepare() {
    this.#voices = await listItalianVoices();
    if (!this.#voices.length) {
      throw new Error('Questo dispositivo non ha voci italiane installate. Scegli la voce neurale "Paola" oppure installa una voce italiana nelle impostazioni del sistema.');
    }
  }

  async voices() {
    if (!this.#voices.length) this.#voices = await listItalianVoices();
    return this.#voices.map((v) => ({ id: v.id, label: v.label, badge: v.badge }));
  }

  bestVoiceId() {
    return this.#voices[0]?.id;
  }

  /**
   * Pronuncia un testo; la promessa si risolve a fine lettura.
   * @param {string} text
   * @param {{ voice?: string, rate?: number, dialogue?: boolean, mood?: string, volume?: number }} ctx
   */
  speak(text, ctx = {}) {
    const s = synth();
    return new Promise((resolve, reject) => {
      const u = new SpeechSynthesisUtterance(text);
      const v = this.#voices.find((x) => x.id === ctx.voice) || this.#voices[0];
      if (v) u.voice = v.voice;
      u.lang = v?.voice.lang || 'it-IT';
      // interpretazione: battute leggermente più vivaci, sospensioni più lente
      let rate = ctx.rate ?? 1;
      let pitch = 1;
      if (ctx.dialogue) { pitch = 1.07; rate *= 1.02; }
      if (ctx.mood === 'question') pitch += 0.03;
      if (ctx.mood === 'exclamation') rate *= 1.03;
      if (ctx.mood === 'suspense') rate *= 0.94;
      if (ctx.heading) rate *= 0.92;
      u.rate = Math.min(3, Math.max(0.3, rate));
      u.pitch = pitch;
      u.volume = ctx.volume ?? 1;
      u.onend = () => resolve();
      u.onerror = (e) => (e.error === 'interrupted' || e.error === 'canceled' ? resolve() : reject(new Error(`Errore della voce: ${e.error}`)));
      this.#utterance = u; // evita che Chrome raccolga l'oggetto e perda l'evento "end"
      s.speak(u);
      // Safari a volte resta in pausa dopo un cancel
      if (s.paused) s.resume();
    });
  }

  stop() {
    synth()?.cancel();
    this.#utterance = null;
  }
}
