// Voci premium gratuite tramite Puter.js: OpenAI, Gemini ed ElevenLabs senza chiavi API.
// Ogni utente accede (o ottiene un account ospite) su Puter e usa i crediti gratuiti che
// Puter gli assegna: lo sviluppatore non paga e l'utente non inserisce chiavi.

import { openAiInstructions } from './cloud.js';

const SCRIPT = 'https://js.puter.com/v2/';
let loading = null;

/** Carica Puter.js una sola volta. */
export function loadPuter() {
  if (typeof window !== 'undefined' && window.puter) return Promise.resolve(window.puter);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = SCRIPT;
      el.onload = () => (window.puter ? resolve(window.puter) : reject(new Error('Puter non si è caricato.')));
      el.onerror = () => {
        loading = null;
        reject(new Error('Non riesco a raggiungere Puter: controlla la connessione.'));
      };
      document.head.appendChild(el);
    });
  }
  return loading;
}

// voce = "fornitore:id"
export const PUTER_VOICES = [
  ['openai:marin', 'Marin · OpenAI', 'Femminile, naturalissima, consigliata'],
  ['openai:cedar', 'Cedar · OpenAI', 'Maschile, profonda, consigliata'],
  ['openai:coral', 'Coral · OpenAI', 'Femminile, calda'],
  ['openai:sage', 'Sage · OpenAI', 'Femminile, pacata'],
  ['openai:ballad', 'Ballad · OpenAI', 'Maschile, espressiva'],
  ['openai:ash', 'Ash · OpenAI', 'Maschile, chiara'],
  ['openai:verse', 'Verse · OpenAI', 'Maschile, teatrale'],
  ['openai:onyx', 'Onyx · OpenAI', 'Maschile, grave'],
  ['openai:nova', 'Nova · OpenAI', 'Femminile, brillante'],
  ['gemini:Sulafat', 'Sulafat · Gemini', 'Femminile, calda'],
  ['gemini:Charon', 'Charon · Gemini', 'Maschile, narrativa'],
  ['gemini:Kore', 'Kore · Gemini', 'Femminile, decisa'],
  ['gemini:Algieba', 'Algieba · Gemini', 'Maschile, morbida'],
  ['gemini:Achernar', 'Achernar · Gemini', 'Femminile, dolce'],
  ['gemini:Iapetus', 'Iapetus · Gemini', 'Maschile, chiara'],
  ['elevenlabs:21m00Tcm4TlvDq8ikWAM', 'Rachel · ElevenLabs', 'Femminile, multilingue'],
  ['elevenlabs:pNInz6obpgDQGcFmaJgB', 'Adam · ElevenLabs', 'Maschile, multilingue'],
];

const PROVIDER_OPTIONS = {
  openai: (ctx) => ({ model: 'gpt-4o-mini-tts', response_format: 'mp3', instructions: openAiInstructions(ctx) }),
  gemini: () => ({ language: 'it-IT' }),
  elevenlabs: () => ({ model: 'eleven_multilingual_v2', output_format: 'mp3_44100_128' }),
};

export class PuterEngine {
  kind = 'audio';
  id = 'puter';
  label = 'Voci premium gratis (Puter)';
  // Puter accetta al massimo 3000 caratteri per richiesta
  groupChars = 2400;
  firstGroupChars = 450;
  groupAcrossParagraphs = true;

  /** @param {() => Promise<any>} [load] */
  constructor(load = loadPuter) { this.load = load; }

  async voices() {
    return PUTER_VOICES.map(([id, label, hint]) => ({ id, label, hint, badge: 'Premium' }));
  }

  bestVoiceId() { return PUTER_VOICES[0][0]; }

  async prepare() {
    await this.load();
  }

  async synthesize(text, ctx = {}) {
    const puter = await this.load();
    const [provider, voice] = (ctx.voice || this.bestVoiceId()).split(':');
    let audio;
    try {
      audio = await puter.ai.txt2speech(text, { provider, voice, ...PROVIDER_OPTIONS[provider]?.(ctx) });
    } catch (err) {
      const msg = String(err?.message || err?.error?.message || err?.msg || err || '');
      const e = new Error(/insufficient|usage|limit|credit|funds|quota/i.test(msg)
        ? 'Hai finito i crediti gratuiti di Puter per ora. Continua con una voce gratuita o riprova più tardi.'
        : /auth|sign|login|token|cancel/i.test(msg)
          ? 'Per usare le voci premium gratuite accedi a Puter (si apre una finestra: puoi anche continuare come ospite).'
          : `Puter: ${msg || 'errore sconosciuto'}`);
      e.code = 'voice-unavailable';
      throw e;
    }
    const src = audio?.src || (typeof audio === 'string' ? audio : null);
    if (!src) throw new Error('Puter non ha restituito audio.');
    return (await fetch(src)).blob();
  }
}
