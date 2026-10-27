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

// ---------------------------------------------------------------- Gemini (Google AI Studio)

export const GEMINI_MODELS = [
  ['gemini-3.8-flash-tts', 'Gemini 3.8 Flash TTS · la più naturale'],
  ['gemini-3.8-flash-lite-tts', 'Gemini 3.8 Flash-Lite TTS · più veloce ed economica'],
  ['gemini-3.1-flash-tts-preview', 'Gemini 3.1 Flash TTS (anteprima)'],
  ['gemini-2.5-pro-preview-tts', 'Gemini 2.5 Pro TTS · massima qualità'],
  ['gemini-2.5-flash-preview-tts', 'Gemini 2.5 Flash TTS · veloce'],
];

const GEMINI_VOICES = [
  ['Sulafat', 'Femminile, calda'], ['Charon', 'Maschile, narrativa'], ['Kore', 'Femminile, decisa'],
  ['Algieba', 'Maschile, morbida'], ['Vindemiatrix', 'Femminile, gentile'], ['Iapetus', 'Maschile, chiara'],
  ['Achernar', 'Femminile, dolce'], ['Sadaltager', 'Maschile, colta'], ['Aoede', 'Femminile, ariosa'],
  ['Gacrux', 'Femminile, matura'], ['Schedar', 'Maschile, pacata'], ['Despina', 'Femminile, vellutata'],
  ['Rasalgethi', 'Maschile, informativa'], ['Erinome', 'Femminile, limpida'], ['Algenib', 'Maschile, roca'],
  ['Leda', 'Femminile, giovane'], ['Orus', 'Maschile, decisa'], ['Zephyr', 'Femminile, luminosa'],
  ['Puck', 'Maschile, vivace'], ['Enceladus', 'Maschile, sussurrata'], ['Umbriel', 'Maschile, rilassata'],
  ['Achird', 'Maschile, amichevole'], ['Callirrhoe', 'Femminile, rilassata'], ['Autonoe', 'Femminile, brillante'],
  ['Laomedeia', 'Femminile, allegra'], ['Pulcherrima', 'Femminile, diretta'], ['Alnilam', 'Maschile, ferma'],
  ['Fenrir', 'Maschile, energica'], ['Zubenelgenubi', 'Maschile, informale'], ['Sadachbia', 'Maschile, vivace'],
];

/**
 * Regia per Gemini. Va nelle istruzioni di sistema, separata dal testo, perché messa
 * nel testo il modello a volte la leggeva ad alta voce.
 */
export function geminiDirection(ctx = {}) {
  let style = 'Sei la voce di un audiolibro. Pronuncia ad alta voce SOLO il testo che ricevi, parola per parola, '
    + 'senza aggiungere, commentare o leggere queste istruzioni. Parla in italiano con accento italiano madrelingua e '
    + 'pronuncia standard, come un narratore professionista: tono caldo e coinvolgente, ritmo calmo, pause naturali alla punteggiatura';
  if (ctx.heading) style += '. Il testo è il titolo di un capitolo: annuncialo con calma';
  if (ctx.dialogue) style += '. Interpreta i dialoghi come un attore, con l\'emozione suggerita dal contenuto ma senza esagerare';
  return `${style}.`;
}

/** Avvolge il PCM 16 bit restituito da Gemini in un file WAV riproducibile. */
export function pcmToWav(bytes, sampleRate = 24000) {
  const header = new DataView(new ArrayBuffer(44));
  const str = (o, s) => [...s].forEach((c, i) => header.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); header.setUint32(4, 36 + bytes.length, true); str(8, 'WAVE'); str(12, 'fmt ');
  header.setUint32(16, 16, true); header.setUint16(20, 1, true); header.setUint16(22, 1, true);
  header.setUint32(24, sampleRate, true); header.setUint32(28, sampleRate * 2, true);
  header.setUint16(32, 2, true); header.setUint16(34, 16, true); str(36, 'data'); header.setUint32(40, bytes.length, true);
  return new Blob([header.buffer, bytes], { type: 'audio/wav' });
}

// risposte di Google per i modelli non inclusi nel piano gratuito
const GEMINI_PAID_ONLY = /limit:\s*0\b|free[_ -]?tier|billing|paid (tier|plan|account)|requires? (a )?paid|not available (on|for) (the )?free/i;

export class GeminiEngine {
  kind = 'audio';
  id = 'gemini';
  label = 'Gemini (Google AI Studio)';
  // più frasi per richiesta: il piano gratuito ha pochi messaggi al minuto
  groupChars = 900;
  constructor(getKey, getModel) { this.getKey = getKey; this.getModel = getModel; }

  async voices() {
    return GEMINI_VOICES.map(([id, hint]) => ({ id, label: id, hint, badge: 'Neurale' }));
  }

  bestVoiceId() { return 'Sulafat'; }

  async prepare() {
    if (!this.getKey()) throw new Error('Inserisci la chiave API di Gemini (Google AI Studio) nelle impostazioni.');
  }

  async synthesize(text, ctx = {}) {
    // se il modello scelto non è disponibile per questa chiave si prova il successivo
    const chosen = this.workingModel || this.getModel() || GEMINI_MODELS[0][0];
    const candidates = [chosen, ...GEMINI_MODELS.map(([id]) => id).filter((id) => id !== chosen)];
    let lastError;
    let paidOnly = false;
    for (const model of candidates) {
      try {
        const blob = await this.#synthesizeWith(model, text, ctx);
        if (this.workingModel !== model && model !== chosen) this.onModelFallback?.(model, chosen);
        this.workingModel = model;
        return blob;
      } catch (err) {
        if (!err.modelUnavailable) throw err;
        paidOnly ||= !!err.paidOnly;
        lastError = err;
      }
    }
    if (paidOnly) {
      throw new Error('Gemini: con questa chiave gratuita nessuna voce Gemini è disponibile. Attiva la fatturazione su aistudio.google.com (pochi centesimi per capitolo) oppure usa la voce gratuita Paola.');
    }
    throw lastError;
  }

  resetModel() { this.workingModel = null; }

  #synthesizeWith(model, text, ctx) {
    return withRetry(async () => {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.getKey() },
        body: JSON.stringify({
          ...(this.noDirection ? {} : { systemInstruction: { parts: [{ text: geminiDirection(ctx) }] } }),
          contents: [{ role: 'user', parts: [{ text }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: ctx.voice || this.bestVoiceId() } } },
          },
        }),
        signal: ctx.signal,
      });
      const body = res.ok ? '' : await res.clone().text();
      // alcuni modelli vocali non accettano istruzioni di sistema: si legge il testo e basta
      if (res.status === 400 && !this.noDirection && /system|instruction/i.test(body)) {
        this.noDirection = true;
        return this.#synthesizeWith(model, text, ctx);
      }
      // modello escluso dal piano gratuito (quota zero o fatturazione richiesta): si passa al successivo
      if ([400, 403, 429].includes(res.status) && GEMINI_PAID_ONLY.test(body)) {
        const err = new Error(`Gemini: il modello ${model} richiede una chiave con fatturazione attiva.`);
        err.modelUnavailable = true;
        err.paidOnly = true;
        throw err;
      }
      if (res.status === 429 && (ctx.attempt || 0) < 3) {
        // piano gratuito: si attende che si liberi la quota al minuto e si riprova
        const wait = Number(res.headers.get('retry-after')) || Number(body.match(/"retryDelay":\s*"(\d+)/)?.[1]) || 20;
        await new Promise((r) => setTimeout(r, wait * 1000));
        return this.#synthesizeWith(model, text, { ...ctx, attempt: (ctx.attempt || 0) + 1 });
      }
      if (res.status === 404) {
        const err = new Error(`Gemini: nessun modello vocale disponibile per questa chiave (ultimo provato: ${model}).`);
        err.modelUnavailable = true;
        throw err;
      }
      if (!res.ok) throw await apiError(res, 'Gemini');
      const json = await res.json();
      const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
      if (!part) throw new Error('Gemini non ha restituito audio per questo passaggio. Riprova o scegli un altro modello.');
      const rate = Number((part.inlineData.mimeType || '').match(/rate=(\d+)/)?.[1]) || 24000;
      const bytes = Uint8Array.from(atob(part.inlineData.data), (c) => c.charCodeAt(0));
      return pcmToWav(bytes, rate);
    });
  }
}
