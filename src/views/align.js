// Allinea le frasi del libro al testo del documento originale (pezzi di testo del PDF o
// nodi di testo del Word), così la frase in lettura si può evidenziare sul documento.

const DROP = /[\s­\-‐‑‒–—«»“”„"‘’'`´*_·•]/u;

/** Forma "compatta" di un carattere per il confronto: minuscolo, senza spazi, trattini e virgolette. */
function squashChar(ch) {
  if (DROP.test(ch)) return '';
  if (ch === '…') return '...';
  return ch.normalize('NFKC').toLowerCase();
}

export function squash(text) {
  let out = '';
  for (const ch of text) out += squashChar(ch);
  return out;
}

/**
 * Costruisce il flusso compatto di tutti i pezzi di testo, ricordando per ogni carattere
 * da quale pezzo e da quale posizione originale proviene.
 * @param {string[]} pieces
 */
export function buildStream(pieces) {
  let chars = '';
  const piece = [];
  const offset = [];
  pieces.forEach((text, p) => {
    let i = 0;
    for (const ch of text) {
      const sq = squashChar(ch);
      for (let k = 0; k < sq.length; k++) {
        piece.push(p);
        offset.push(i);
      }
      chars += sq;
      i += ch.length;
    }
  });
  return { chars, piece: Int32Array.from(piece), offset: Int32Array.from(offset) };
}

const ANCHOR = 24;

/**
 * Trova ogni frase nel flusso, in ordine. Restituisce per ogni capitolo un array di
 * intervalli [inizio, fine) nel flusso compatto, oppure null se la frase non è stata trovata.
 * @param {{ chapters: { sentences: { text: string }[] }[] }} book
 * @param {{ chars: string }} stream
 */
export function alignBook(book, stream) {
  const { chars } = stream;
  let cursor = 0;
  return book.chapters.map((chapter) =>
    chapter.sentences.map((s) => {
      const target = squash(s.text);
      if (!target) return null;
      const windowEnd = cursor + Math.max(6000, target.length * 4);
      let start = chars.indexOf(target, cursor);
      let end = start + target.length;
      if (start === -1 || start > windowEnd) {
        // testo leggermente diverso (note, simboli): ci si aggancia a inizio e fine frase
        const head = target.slice(0, ANCHOR);
        const tail = target.slice(-ANCHOR);
        start = chars.indexOf(head, cursor);
        if (start === -1 || start > windowEnd) return null;
        const tailAt = chars.indexOf(tail, start + head.length - Math.min(head.length, tail.length));
        end = tailAt !== -1 && tailAt - start < target.length * 2 + 200 ? tailAt + tail.length : start + head.length;
      }
      cursor = end;
      return [start, end];
    }),
  );
}

/** Frase (capitolo, indice) che contiene la posizione `pos` del flusso compatto. */
export function sentenceAtPosition(ranges, pos) {
  let best = null;
  for (let c = 0; c < ranges.length; c++) {
    for (let i = 0; i < ranges[c].length; i++) {
      const r = ranges[c][i];
      if (!r) continue;
      if (pos >= r[0] && pos < r[1]) return { chapter: c, sentence: i };
      if (r[0] > pos) return best;
      best = { chapter: c, sentence: i };
    }
  }
  return best;
}
