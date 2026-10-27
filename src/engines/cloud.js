// Motori premium in cloud: OpenAI, ElevenLabs e Google Cloud. Le chiavi API restano
// sul dispositivo dell'utente e le richieste partono direttamente dal browser.

async function apiError(res, service) {
  let detail = '';
  try {
    const body = await res.json();
    detail = body?.error?.message || body?.detail?.message || body?.detail?.status || body?.message || '';
    if (typeof detail !== 'string') detail = JSON.stringify(detail);
  } catch { /* corpo non JSON */ }
  if (res.status === 401 || res.status === 403) return new Error(`${service}: chiave API non valida o senza permessi. ${detail}`.trim());
  if (res.status === 429) return new Error(`${service}: limite di utilizzo o credito esaurito. ${detail}`.trim());
  return new Error(`${service}: errore ${res.status}. ${detail}`.trim());
}

async function withRetry(fn) {
  try {
    return await fn();
  } catch (err) {
    // un solo nuovo tentativo per errori di rete temporanei
    if (err instanceof TypeError) {
      await new Promise((r) => setTimeout(r, 800));
      return fn();
    }
    throw err;
  }
}

// ---------------------------------------------------------------- OpenAI

const OPENAI_VOICES = [
  ['marin', 'Marin', 'Naturale, consigliata'],
  ['cedar', 'Cedar', 'Maschile, profonda, consigliata'],
  ['coral', 'Coral', 'Femminile, calda'],
  ['sage', 'Sage', 'Femminile, pacata'],
  ['ballad', 'Ballad', 'Maschile, espressiva'],
  ['ash', 'Ash', 'Maschile, chiara'],
  ['verse', 'Verse', 'Maschile, teatrale'],
  ['nova', 'Nova', 'Femminile, brillante'],
  ['onyx', 'Onyx', 'Maschile, grave'],
  ['shimmer', 'Shimmer', 'Femminile, morbida'],
  ['alloy', 'Alloy', 'Neutra'],
  ['echo', 'Echo', 'Maschile'],
  ['fable', 'Fable', 'Narrativa'],
];

const NARRATOR_IT =
  'Sei un narratore professionista di audiolibri italiani. Parla esclusivamente in italiano, con pronuncia e accento italiani standard, ' +
  'naturali e madrelingua, senza alcuna inflessione straniera. ';

export function openAiInstructions(ctx) {
  let style = NARRATOR_IT;
  if (ctx.heading) style += 'Stai annunciando il titolo di un capitolo: tono solenne, lento, con una piccola pausa finale.';
  else if (ctx.dialogue) style += 'Questa è una battuta di dialogo: interpretala come un attore, con l\'emozione suggerita dal contenuto, senza esagerare.';
  else style += 'Questa è narrazione: tono caldo e coinvolgente, ritmo calmo, pause naturali alla punteggiatura.';
  if (ctx.mood === 'question') style += ' La frase è una domanda: intonazione interrogativa.';
  if (ctx.mood === 'exclamation') style += ' La frase è esclamativa: più energia.';
  if (ctx.mood === 'suspense') style += ' La frase resta in sospeso: rallenta e lascia la frase aperta.';
  return style;
}

export class OpenAIEngine {
  kind = 'audio';
  id = 'openai';
  label = 'OpenAI (premium)';
  constructor(getKey) { this.getKey = getKey; }

  async voices() {
    return OPENAI_VOICES.map(([id, label, hint]) => ({ id, label, hint, badge: 'Neurale' }));
  }

  bestVoiceId() { return 'marin'; }

  async prepare() {
    if (!this.getKey()) throw new Error('Inserisci la chiave API di OpenAI nelle impostazioni.');
  }

  synthesize(text, ctx = {}) {
    return withRetry(async () => {
      const res = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.getKey()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o-mini-tts',
          voice: ctx.voice || this.bestVoiceId(),
          input: text,
          instructions: openAiInstructions(ctx),
          response_format: 'mp3',
        }),
        signal: ctx.signal,
      });
      if (!res.ok) throw await apiError(res, 'OpenAI');
      return res.blob();
    });
  }
}

// ---------------------------------------------------------------- ElevenLabs

export const ELEVEN_MODELS = [
  ['eleven_multilingual_v2', 'Multilingual v2 · massima qualità'],
  ['eleven_v3', 'v3 · la più espressiva'],
  ['eleven_flash_v2_5', 'Flash v2.5 · veloce ed economico'],
];

export function elevenBody(text, ctx, model) {
  const body = {
    text,
    model_id: model,
    voice_settings: {
      // le battute sono più libere e interpretate, la narrazione più stabile
      stability: ctx.dialogue ? 0.35 : 0.55,
      similarity_boost: 0.8,
      style: ctx.dialogue ? 0.35 : 0.15,
      use_speaker_boost: true,
    },
  };
  if (model !== 'eleven_v3') {
    // il contesto delle frasi vicine rende la prosodia continua tra un pezzo e l'altro
    if (ctx.previousText) body.previous_text = ctx.previousText;
    if (ctx.nextText) body.next_text = ctx.nextText;
  }
  // solo i modelli v2.5 accettano di forzare la lingua
  if (model === 'eleven_flash_v2_5') body.language_code = 'it';
  return body;
}

export class ElevenLabsEngine {
  kind = 'audio';
  id = 'elevenlabs';
  label = 'ElevenLabs (premium)';
  #voices = null;
  constructor(getKey, getModel) { this.getKey = getKey; this.getModel = getModel; }

  async prepare() {
    if (!this.getKey()) throw new Error('Inserisci la chiave API di ElevenLabs nelle impostazioni.');
  }

  async voices() {
    if (!this.getKey()) return [];
    if (this.#voices) return this.#voices;
    const res = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': this.getKey() } });
    if (!res.ok) throw await apiError(res, 'ElevenLabs');
    const { voices = [] } = await res.json();
    const italian = (v) => {
      const l = v.labels || {};
      return /ital/i.test(`${l.accent || ''} ${l.language || ''} ${v.name} ${v.description || ''}`) ||
        (v.verified_languages || []).some((x) => x.language === 'it');
    };
    this.#voices = voices
      .map((v) => ({
        id: v.voice_id,
        label: v.name,
        badge: italian(v) ? 'Italiana' : 'Multilingue',
        hint: [v.labels?.gender, v.labels?.age, v.labels?.accent, v.labels?.description || v.labels?.descriptive].filter(Boolean).join(', '),
        italian: italian(v),
      }))
      .sort((a, b) => Number(b.italian) - Number(a.italian) || a.label.localeCompare(b.label));
    return this.#voices;
  }

  resetVoices() { this.#voices = null; }

  bestVoiceId() { return this.#voices?.[0]?.id; }

  synthesize(text, ctx = {}) {
    const voice = ctx.voice || this.bestVoiceId();
    if (!voice) return Promise.reject(new Error('ElevenLabs: scegli una voce nelle impostazioni.'));
    const model = this.getModel() || ELEVEN_MODELS[0][0];
    return withRetry(async () => {
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
        method: 'POST',
        headers: { 'xi-api-key': this.getKey(), 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        body: JSON.stringify(elevenBody(text, ctx, model)),
        signal: ctx.signal,
      });
      if (!res.ok) throw await apiError(res, 'ElevenLabs');
      return res.blob();
    });
  }
}

// ---------------------------------------------------------------- Google Cloud

const GOOGLE_RANK = [/Chirp3-HD/, /Chirp-HD/, /Studio/, /Neural2/, /Wavenet/, /Standard/];

export class GoogleEngine {
  kind = 'audio';
  id = 'google';
  label = 'Google Cloud (premium)';
  #voices = null;
  constructor(getKey) { this.getKey = getKey; }

  async prepare() {
    if (!this.getKey()) throw new Error('Inserisci la chiave API di Google Cloud nelle impostazioni.');
  }

  async voices() {
    if (!this.getKey()) return [];
    if (this.#voices) return this.#voices;
    const res = await fetch(`https://texttospeech.googleapis.com/v1/voices?languageCode=it-IT&key=${encodeURIComponent(this.getKey())}`);
    if (!res.ok) throw await apiError(res, 'Google');
    const { voices = [] } = await res.json();
    const rank = (n) => {
      const i = GOOGLE_RANK.findIndex((re) => re.test(n));
      return i === -1 ? 99 : i;
    };
    this.#voices = voices
      .filter((v) => v.languageCodes.includes('it-IT'))
      .sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name))
      .map((v) => ({
        id: v.name,
        label: v.name.replace('it-IT-', ''),
        badge: rank(v.name) <= 1 ? 'HD' : rank(v.name) <= 3 ? 'Neurale' : 'Standard',
        hint: v.ssmlGender === 'FEMALE' ? 'Femminile' : v.ssmlGender === 'MALE' ? 'Maschile' : '',
      }));
    return this.#voices;
  }

  resetVoices() { this.#voices = null; }

  bestVoiceId() { return this.#voices?.[0]?.id || 'it-IT-Chirp3-HD-Achernar'; }

  synthesize(text, ctx = {}) {
    return withRetry(async () => {
      const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(this.getKey())}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { text },
          voice: { languageCode: 'it-IT', name: ctx.voice || this.bestVoiceId() },
          audioConfig: { audioEncoding: 'MP3' },
        }),
        signal: ctx.signal,
      });
      if (!res.ok) throw await apiError(res, 'Google');
      const { audioContent } = await res.json();
      const bytes = Uint8Array.from(atob(audioContent), (c) => c.charCodeAt(0));
      return new Blob([bytes], { type: 'audio/mpeg' });
    });
  }
}
