// Trasforma il testo scritto in testo "da pronunciare" per un narratore italiano:
// abbreviazioni, numeri romani, ordinali, date, orari, valute, simboli e numeri.

import { cardinal, ordinal, romanToInt, decimal, MONTHS } from './numbers-it.js';

// Abbreviazioni comuni (la chiave è senza punto finale, il confronto ignora le maiuscole
// solo dove indicato con la flag i).
const ABBREVIATIONS = [
  [/\bS\.p\.A\./g, 'esse pi a'],
  [/\bS\.r\.l\./g, 'esse erre elle'],
  [/\bp\.\s?es\./gi, 'per esempio'],
  [/\bad es\./gi, 'ad esempio'],
  [/\bper es\./gi, 'per esempio'],
  [/\bc\.d\./gi, 'cosiddetto'],
  [/\bd\.C\./g, 'dopo Cristo'],
  [/\ba\.C\./g, 'avanti Cristo'],
  [/\bN\.d\.T\./g, 'nota del traduttore'],
  [/\bN\.d\.R\./g, 'nota della redazione'],
  [/\bN\.d\.A\./g, "nota dell'autore"],
  [/\becc\.(?=\s*[a-zà-ù,;:)])/g, 'eccetera'],
  [/\becc\./g, 'eccetera.'],
  [/\betc\./gi, 'eccetera'],
  [/\bSig\.ra\b\.?/g, 'Signora'],
  [/\bSig\.na\b\.?/g, 'Signorina'],
  [/\bSigg\./g, 'Signori'],
  [/\bSig\./g, 'Signor'],
  [/\bDott\.ssa\b\.?/g, 'Dottoressa'],
  [/\bDott\./g, 'Dottor'],
  [/\bDr\./g, 'Dottor'],
  [/\bProf\.ssa\b\.?/g, 'Professoressa'],
  [/\bProf\./g, 'Professor'],
  [/\bAvv\./g, 'Avvocato'],
  [/\bIng\./g, 'Ingegner'],
  [/\bArch\./g, 'Architetto'],
  [/\bGeom\./g, 'Geometra'],
  [/\bRag\./g, 'Ragionier'],
  [/\bOn\./g, 'Onorevole'],
  [/\bSan\.|\bS\.(?=\s[A-Z])/g, 'San'],
  [/\bMons\./g, 'Monsignor'],
  [/\bGen\./g, 'Generale'],
  [/\bCap\.(?=\s*\d)/g, 'Capitolo'],
  [/\bcap\.(?=\s*\d)/g, 'capitolo'],
  [/\bpagg\.(?=\s*\d)/gi, 'pagine'],
  [/\bpag\.(?=\s*\d)/gi, 'pagina'],
  [/\bp\.(?=\s*\d)/g, 'pagina'],
  [/\bart\.(?=\s*\d)/gi, 'articolo'],
  [/\bartt\.(?=\s*\d)/gi, 'articoli'],
  [/\bvol\.(?=\s*\d|\s*[IVX])/gi, 'volume'],
  [/\bfig\.(?=\s*\d)/gi, 'figura'],
  [/\btab\.(?=\s*\d)/gi, 'tabella'],
  [/\bpar\.(?=\s*\d)/gi, 'paragrafo'],
  [/\bsec\.(?=\s*[IVXLC])/gi, 'secolo'],
  [/\bcfr\./gi, 'confronta'],
  [/\bvd\./gi, 'vedi'],
  [/\bca\.(?=\s*\d)/g, 'circa'],
  [/\btel\.(?=\s*[\d+])/gi, 'telefono'],
  [/\bvs\.?(?=\s)/g, 'contro'],
  [/\bkm\b/g, 'chilometri'],
  [/\bkg\b/g, 'chili'],
  [/\b(\d+)\s?cm\b/g, '$1 centimetri'],
  [/\b(\d+)\s?mm\b/g, '$1 millimetri'],
  [/\b(\d+)\s?m\b(?!\.\w)/g, '$1 metri'],
  [/\b(\d+)\s?g\b(?!\.\w)/g, '$1 grammi'],
  [/\b(\d+)\s?l\b(?!\.\w)/g, '$1 litri'],
  [/\b(\d+)\s?h\b/g, '$1 ore'],
  [/\b(\d+)\s?min\b\.?/g, '$1 minuti'],
];

// Parole dopo le quali un numero romano va letto come ordinale ("Capitolo IV" → "capitolo quarto").
const ROMAN_AFTER = /\b(capitolo|parte|libro|tomo|volume|atto|scena|canto|sezione|secolo|sec\.|papa|re|regina|imperatore|vol\.)\s+([IVXLCDM]+)\b/gi;
// Nomi propri seguiti da numero romano di almeno due cifre (Luigi XIV, Giovanni XXIII)
const ROMAN_AFTER_NAME = /\b([A-ZÀ-Ý][a-zà-ÿ]+)\s+([IVXLCDM]{2,})\b/g;
// "XIX secolo"
const ROMAN_BEFORE = /\b([IVXLCDM]+)\s+(secolo|sec\.)/g;

const FEMININE_AFTER = /^(parte|scena|sezione|regina)$/i;

function replaceRomans(text) {
  text = text.replace(ROMAN_AFTER, (m, word, roman) => {
    const n = romanToInt(roman.toUpperCase());
    if (!n || roman !== roman.toUpperCase()) return m;
    const w = word.toLowerCase() === 'sec.' ? 'secolo' : word;
    return `${w} ${ordinal(n, FEMININE_AFTER.test(word) ? 'f' : 'm')}`;
  });
  text = text.replace(ROMAN_BEFORE, (m, roman) => {
    const n = romanToInt(roman);
    return n ? `${ordinal(n)} secolo` : m;
  });
  text = text.replace(ROMAN_AFTER_NAME, (m, name, roman) => {
    const n = romanToInt(roman);
    // evitiamo sigle come "Mario CD" che sarebbero numeri romani validi ma improbabili
    if (!n || n > 40) return m;
    return `${name} ${ordinal(n)}`;
  });
  return text;
}

function replaceDatesAndTimes(text) {
  // 12/03/2024, 1-1-2000, 3.4.1999
  text = text.replace(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/g, (m, d, mo, y) => {
    const day = +d;
    const month = +mo;
    if (day < 1 || day > 31 || month < 1 || month > 12) return m;
    return `${day === 1 ? 'primo' : day} ${MONTHS[month - 1]} ${y}`;
  });
  // "1 maggio" → "primo maggio"
  text = text.replace(new RegExp(`\\b1(?:°|º)?\\s+(${MONTHS.join('|')})\\b`, 'gi'), 'primo $1');
  // orari: 14:30, 9.05 (solo se preceduti da "ore"/"alle")
  text = text.replace(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g, (m, h, mi) => (mi === '00' ? `${+h}` : `${+h} e ${+mi}`));
  text = text.replace(/\b(ore|alle|dalle|verso le|entro le)\s+([01]?\d|2[0-3])\.([0-5]\d)\b/gi, (m, w, h, mi) =>
    mi === '00' ? `${w} ${+h}` : `${w} ${+h} e ${+mi}`);
  return text;
}

function replaceSymbols(text) {
  return text
    // valute
    .replace(/€\s?(\d+(?:[.,]\d+)*)/g, '$1 euro')
    .replace(/(\d+(?:[.,]\d+)*)\s?€/g, '$1 euro')
    .replace(/\$\s?(\d+(?:[.,]\d+)*)/g, '$1 dollari')
    .replace(/(\d+(?:[.,]\d+)*)\s?\$/g, '$1 dollari')
    .replace(/£\s?(\d+(?:[.,]\d+)*)/g, '$1 sterline')
    .replace(/\bEUR\b/g, 'euro')
    // percentuali e gradi
    .replace(/(\d)\s?%/g, '$1 per cento')
    .replace(/(\d)\s?°\s?C\b/g, '$1 gradi')
    // numero
    .replace(/\b[Nn](?:°|º|\.)\s?(\d)/g, 'numero $1')
    .replace(/&/g, ' e ')
    .replace(/\s\+\s/g, ' più ')
    .replace(/(\d)\s?[x×]\s?(\d)/g, '$1 per $2')
    .replace(/(\d)\s?=\s?(\d)/g, '$1 uguale $2')
    // URL ed email: si annunciano invece di leggerle carattere per carattere
    .replace(/\bhttps?:\/\/(?:www\.)?([^\s/]+)[^\s]*/gi, (m, host) => `il sito ${host.replace(/\./g, ' punto ')}`)
    .replace(/\bwww\.([^\s/]+)[^\s]*/gi, (m, host) => `il sito ${host.replace(/\./g, ' punto ')}`)
    .replace(/\b([\w.+-]+)@([\w-]+)\.([a-z]{2,})\b/gi, '$1 chiocciola $2 punto $3');
}

function replaceOrdinalsAndNumbers(text) {
  // ordinali: 1°, 2ª, 3º, 21esimo
  text = text.replace(/\b(\d{1,4})\s?(°|º)(?!\s?C\b)/g, (m, n) => ordinal(+n));
  text = text.replace(/\b(\d{1,4})\s?(ª)/g, (m, n) => ordinal(+n, 'f'));

  // numeri con separatore delle migliaia e decimali all'italiana: 1.250.000,75
  text = text.replace(/\b\d{1,3}(?:\.\d{3})+(?:,\d+)?\b/g, (m) => {
    const [int, dec] = m.replace(/\./g, '').split(',');
    return decimal(int, dec);
  });
  // decimali semplici 3,5
  text = text.replace(/\b(\d+),(\d+)\b/g, (m, i, d) => decimal(i, d));
  // intervalli: 1990-1995 → "1990, 1995" con una breve pausa
  text = text.replace(/\b(\d+)\s?[-–]\s?(\d+)\b/g, (m, a, b) => `${a}, ${b}`);
  // interi rimanenti
  text = text.replace(/\b\d+\b/g, (m) => {
    // codici, telefoni e numeri con zeri iniziali: cifra per cifra
    if ((m.length > 1 && m[0] === '0') || m.length > 12) return m.split('').map((d) => cardinal(+d)).join(' ');
    return cardinal(+m);
  });
  return text;
}

function cleanTypography(text) {
  return text
    // note a piè di pagina: parola¹ oppure [12]
    .replace(/[¹²³⁰-⁹]+/g, '')
    .replace(/\[\d{1,3}\]/g, '')
    .replace(/\.{3,}/g, '…')
    .replace(/[_*#~^|]/g, ' ')
    .replace(/[«»“”„"]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Prepara una frase per la sintesi vocale in italiano.
 * @param {string} text testo così come appare nel libro
 * @param {{ numbers?: boolean }} [opts] numbers=false lascia le cifre al motore vocale
 */
export function normalizeForSpeech(text, opts = {}) {
  const { numbers = true } = opts;
  let t = cleanTypography(text);
  for (const [re, rep] of ABBREVIATIONS) t = t.replace(re, rep);
  t = replaceRomans(t);
  t = replaceSymbols(t);
  t = replaceDatesAndTimes(t);
  if (numbers) t = replaceOrdinalsAndNumbers(t);
  // i trattini dei dialoghi diventano brevi pause
  t = t.replace(/(^|\s)[—–-](\s|$)/g, '$1, $2').replace(/^,\s*/, '');
  return t.replace(/\s+([,.;:!?])/g, '$1').replace(/,\s*,/g, ',').replace(/\s+/g, ' ').trim();
}

export const _internals = { replaceRomans, replaceDatesAndTimes, replaceSymbols, replaceOrdinalsAndNumbers };
