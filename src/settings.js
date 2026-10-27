// Impostazioni dell'utente (salvate solo su questo dispositivo).

const KEY = 'narratore.settings.v1';

export const DEFAULTS = {
  engine: null, // scelto automaticamente al primo avvio
  voices: {}, // voce per motore
  dialogueVoices: {}, // seconda voce per i dialoghi, per motore
  dialogueVoiceEnabled: false,
  rate: 1,
  pace: 'naturale',
  announceChapters: true,
  fontSize: 19,
  theme: 'auto',
  follow: true,
  viewMode: 'original', // 'original' = PDF/Word come appare; 'text' = solo testo
  keys: { openai: '', elevenlabs: '', gemini: '' },
  elevenModel: 'eleven_multilingual_v2',
  geminiModel: 'gemini-3.8-flash-tts',
  piperConsent: false,
  piperStudio: true, // rifinitura "da studio" della voce Paola
};

export function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    // chi aveva il vecchio modello predefinito passa al nuovo, più naturale
    if (saved.geminiModel === 'gemini-3.1-flash-tts-preview') saved.geminiModel = DEFAULTS.geminiModel;
    // il motore Google Cloud è stato tolto: Gemini lo sostituisce
    if (saved.engine === 'google') saved.engine = 'gemini';
    return { ...DEFAULTS, ...saved, keys: { ...DEFAULTS.keys, ...saved.keys } };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch { /* archiviazione non disponibile (navigazione privata) */ }
}
