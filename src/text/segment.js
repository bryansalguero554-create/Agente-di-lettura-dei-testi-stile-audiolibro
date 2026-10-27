// Divisione del testo in frasi e riconoscimento dei dialoghi.

// Abbreviazioni dopo le quali il punto NON chiude la frase.
const NO_BREAK_ABBR = new Set([
  'sig', 'sigg', 'sig.ra', 'sig.na', 'dott', 'dott.ssa', 'dr', 'prof', 'prof.ssa', 'avv', 'ing',
  'arch', 'geom', 'rag', 'on', 'mons', 'gen', 'col', 'cap', 'pag', 'pagg', 'p', 'art', 'artt',
  'vol', 'fig', 'tab', 'par', 'sec', 'cfr', 'vd', 'es', 'ca', 'tel', 'n', 'nr', 'st', 's', 'ss',
  'p.es', 'c.d', 'a.c', 'd.c', 'vs', 'mr', 'mrs', 'ms', 'jr', 'sr', 'ad',
]);

const MAX_SENTENCE = 280;
const OPEN_QUOTES = '«“"‘\'';
const CLOSERS = '»”"’\')]';

/**
 * Divide un paragrafo in frasi, mantenendo le virgolette di chiusura con la frase precedente.
 * @param {string} paragraph
 * @returns {string[]}
 */
export function splitSentences(paragraph) {
  const text = paragraph.replace(/\s+/g, ' ').trim();
  if (!text) return [];
  const out = [];
  let start = 0;
  const re = /([.!?…]+)([»”"’')\]]*)(\s+)(?=[«“"‘'(\[—–-]?\s?[A-ZÀ-Ý0-9¿¡])/g;
  let m;
  while ((m = re.exec(text))) {
    const end = m.index + m[1].length + m[2].length;
    if (m[1] === '.' && !m[2]) {
      // controlla la parola prima del punto
      const before = text.slice(start, m.index);
      const word = (before.match(/([\p{L}.]+)$/u) || [, ''])[1].toLowerCase();
      if (NO_BREAK_ABBR.has(word)) continue;
      // iniziali: "A. Manzoni", "J. R. R. Tolkien"
      if (/(^|\s)\p{Lu}$/u.test(before)) continue;
    }
    out.push(text.slice(start, end).trim());
    start = end + m[3].length;
  }
  if (start < text.length) out.push(text.slice(start).trim());
  return out.flatMap(splitLong).filter(Boolean);
}

// Le frasi molto lunghe si spezzano su ; : o virgola per mantenere una prosodia naturale
// e un'evidenziazione leggibile.
function splitLong(sentence) {
  if (sentence.length <= MAX_SENTENCE) return [sentence];
  const separators = [/;\s/g, /:\s/g, /,\s/g, /\s[—–]\s/g, /\s/g];
  for (const sep of separators) {
    const positions = [];
    let m;
    while ((m = sep.exec(sentence))) positions.push(m.index + m[0].length);
    const mid = sentence.length / 2;
    const candidates = positions.filter((p) => p > 60 && sentence.length - p > 60);
    if (!candidates.length) continue;
    const cut = candidates.reduce((a, b) => (Math.abs(b - mid) < Math.abs(a - mid) ? b : a));
    return [...splitLong(sentence.slice(0, cut).trim()), ...splitLong(sentence.slice(cut).trim())];
  }
  return [sentence];
}

/**
 * Per ogni frase di un paragrafo restituisce la quota di testo tra virgolette (0..1).
 * Lo stato delle virgolette prosegue da una frase all'altra, così «Ciao. Come stai?»
 * risulta dialogo in entrambe le frasi. I paragrafi introdotti da trattino sono dialogo.
 * @param {string[]} sentences
 * @param {boolean} [dash]
 * @returns {number[]}
 */
export function dialogueRatios(sentences, dash = false) {
  if (dash) return sentences.map(() => 1);
  let depth = 0;
  return sentences.map((sentence) => {
    let inside = 0;
    let total = 0;
    for (const ch of sentence) {
      if (ch === '«' || ch === '“') { depth++; continue; }
      if (ch === '»' || ch === '”') { depth = Math.max(0, depth - 1); continue; }
      if (ch === '"') { depth = depth ? 0 : 1; continue; }
      if (/[\s.,;:!?…—–-]/.test(ch)) continue;
      total++;
      if (depth > 0) inside++;
    }
    return total ? inside / total : 0;
  });
}

/** Per ogni frase indica se inizia dentro virgolette aperte in una frase precedente. */
export function quoteStartStates(sentences) {
  let depth = 0;
  return sentences.map((sentence) => {
    const startInside = depth > 0;
    for (const ch of sentence) {
      if (ch === '«' || ch === '“') depth++;
      else if (ch === '»' || ch === '”') depth = Math.max(0, depth - 1);
      else if (ch === '"') depth = depth ? 0 : 1;
    }
    return startInside;
  });
}

export function isDashDialogue(paragraph) {
  return /^\s*[—–-]\s?\S/.test(paragraph);
}

/** Tipo di frase per l'interpretazione: domanda, esclamazione, sospensione o affermazione. */
export function sentenceMood(sentence) {
  const s = sentence.replace(/[»”"’')\]\s]+$/, '');
  if (/\?!?$/.test(s)) return 'question';
  if (/!$/.test(s)) return 'exclamation';
  if (/…$|\.\.\.$/.test(s)) return 'suspense';
  return 'statement';
}

export { OPEN_QUOTES, CLOSERS };

/**
 * Divide una frase in parti narrate e parti dialogate, per leggere le battute con
 * una voce diversa: «Vieni qui!» disse lui → [«Vieni qui!»] [disse lui].
 * @param {string} sentence
 * @param {boolean} [startInside] la frase inizia dentro virgolette aperte in precedenza
 * @returns {{ text: string, dialogue: boolean }[]}
 */
export function splitQuoted(sentence, startInside = false) {
  const parts = [];
  let inside = startInside;
  let buf = '';
  const push = () => {
    if (/[\p{L}\p{N}]/u.test(buf)) parts.push({ text: buf.trim(), dialogue: inside });
    else if (parts.length && buf.trim()) parts[parts.length - 1].text += buf.trimEnd();
    buf = '';
  };
  for (const ch of sentence) {
    const open = ch === '«' || ch === '“' || (ch === '"' && !inside);
    const close = ch === '»' || ch === '”' || (ch === '"' && inside);
    if (open && !inside) { push(); inside = true; buf += ch; continue; }
    if (close && inside) { buf += ch; push(); inside = false; continue; }
    buf += ch;
  }
  push();
  return parts.length ? parts : [{ text: sentence, dialogue: startInside }];
}
