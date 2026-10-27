// Lettura dei PDF con pdf.js: ricostruzione di righe e paragrafi, rimozione di
// intestazioni / numeri di pagina, unione delle parole sillabate e capitoli dall'indice.

import { looksLikeChapterHeading } from '../book.js';

/**
 * @typedef {{ str: string, x: number, y: number, w: number, h: number }} Item
 * @typedef {{ width: number, height: number, items: Item[] }} Page
 * @typedef {{ text: string, x: number, xEnd: number, y: number, size: number, page: number }} Line
 */

/** Raggruppa gli elementi di testo di una pagina in righe ordinate dall'alto in basso. */
export function pageToLines(page, pageIndex) {
  const items = page.items
    .filter((it) => it.str)
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const it of items) {
    const size = it.h || 10;
    let line = lines.find((l) => Math.abs(l.y - it.y) < Math.max(2, size * 0.45));
    if (!line) {
      line = { parts: [], y: it.y, size: 0, page: pageIndex };
      lines.push(line);
    }
    line.parts.push(it);
    line.size = Math.max(line.size, size);
  }
  return lines
    .map((l) => {
      const parts = l.parts.sort((a, b) => a.x - b.x);
      let text = '';
      let lastEnd = null;
      for (const p of parts) {
        if (lastEnd !== null && p.x - lastEnd > l.size * 0.12 && !/\s$/.test(text) && !/^\s/.test(p.str)) text += ' ';
        text += p.str;
        lastEnd = p.x + p.w;
      }
      return {
        text: text.replace(/­/g, '').replace(/\s+/g, ' ').trim(),
        x: parts[0].x,
        xEnd: lastEnd,
        y: l.y,
        size: Math.round(l.size * 10) / 10,
        page: l.page,
      };
    })
    .filter((l) => l.text)
    .sort((a, b) => b.y - a.y);
}

const PAGE_NUMBER = /^(?:[-–—]\s*)?(?:pag(?:\.|ina)?\s*)?\d{1,4}(?:\s*(?:di|\/|of)\s*\d{1,4})?(?:\s*[-–—])?$|^[ivxlc]{1,6}$/i;

/** Rimuove numeri di pagina e intestazioni/piè di pagina ripetuti. */
export function stripRunningHeaders(pagesLines, pages) {
  const margin = (p) => pages[p].height * 0.09;
  const isMargin = (l) => l.y > pages[l.page].height - margin(l.page) - l.size || l.y < margin(l.page);
  const key = (t) => t.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ');
  const counts = new Map();
  pagesLines.forEach((lines) => {
    const seen = new Set();
    lines.filter(isMargin).forEach((l) => seen.add(key(l.text)));
    seen.forEach((k) => counts.set(k, (counts.get(k) || 0) + 1));
  });
  const threshold = Math.max(3, pagesLines.length * 0.25);
  return pagesLines.map((lines) =>
    lines.filter((l) => !(isMargin(l) && (PAGE_NUMBER.test(l.text) || (counts.get(key(l.text)) || 0) >= threshold))),
  );
}

// valore più frequente pesato: [[valore, peso], ...]
function mode(pairs) {
  const m = new Map();
  for (const [v, w] of pairs) m.set(v, (m.get(v) || 0) + w);
  let best;
  let bestWeight = -1;
  for (const [v, w] of m) if (w > bestWeight) { best = v; bestWeight = w; }
  return best;
}

function median(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

const ENDS_SENTENCE = /[.!?…:»”"')]$/;

/** Ricostruisce paragrafi e titoli a partire dalle righe di tutte le pagine. */
export function linesToBlocks(lines) {
  if (!lines.length) return [];
  const bodySize = mode(lines.map((l) => [l.size, l.text.length]));
  const gaps = [];
  for (let i = 1; i < lines.length; i++) {
    const a = lines[i - 1];
    const b = lines[i];
    if (a.page === b.page && Math.abs(a.size - bodySize) < 0.6 && Math.abs(b.size - bodySize) < 0.6 && a.y > b.y) gaps.push(a.y - b.y);
  }
  const spacing = median(gaps) || bodySize * 1.2;
  const bodyLines = lines.filter((l) => Math.abs(l.size - bodySize) < 0.6);
  const leftMargin = median(bodyLines.map((l) => l.x));
  const rightEdge = median(bodyLines.map((l) => l.xEnd).sort((a, b) => a - b).slice(-Math.ceil(bodyLines.length / 2)));
  const textWidth = Math.max(1, rightEdge - leftMargin);

  const blocks = [];
  let cur = null;
  let prev = null;

  const flush = () => {
    if (cur) blocks.push(cur);
    cur = null;
  };

  for (const line of lines) {
    const ratio = line.size / bodySize;
    const gapBefore = prev && prev.page === line.page ? prev.y - line.y : null;
    const big = ratio >= 1.18 && line.text.length < 140;
    const isolated = gapBefore === null || gapBefore > spacing * 1.5;
    const chapterLike = looksLikeChapterHeading(line.text) && isolated;

    if (big || chapterLike) {
      const level = ratio >= 1.6 ? 1 : ratio >= 1.35 ? 2 : big ? 3 : 2;
      if (cur?.type === 'heading' && cur.level === level && gapBefore !== null && gapBefore < spacing * 2.2 * ratio) {
        cur.text += ' ' + line.text;
      } else {
        flush();
        cur = { type: 'heading', level, text: line.text, page: line.page };
      }
      prev = line;
      continue;
    }

    let newParagraph = !cur || cur.type === 'heading';
    if (!newParagraph && prev) {
      const prevEnds = ENDS_SENTENCE.test(prev.text);
      const prevShort = prev.xEnd < rightEdge - textWidth * 0.12;
      const indented = line.x > leftMargin + bodySize * 0.9 && line.x < leftMargin + textWidth * 0.3;
      if (gapBefore !== null && gapBefore > spacing * 1.45) newParagraph = true;
      else if (prevEnds && prevShort) newParagraph = true;
      else if (prevEnds && indented) newParagraph = true;
      else if (/^[—–-]\s?\S/.test(line.text) && prevEnds) newParagraph = true;
      else if (/^([•▪●◦‣]|\d{1,2}[.)])\s/.test(line.text)) newParagraph = true;
    }

    if (newParagraph) {
      flush();
      cur = { type: 'p', text: line.text, page: line.page };
    } else if (/[\p{L}]-$/u.test(cur.text) && /^\p{Ll}/u.test(line.text)) {
      // parola sillabata a fine riga: "inte-" + "ressante"
      cur.text = cur.text.slice(0, -1) + line.text;
    } else {
      cur.text += ' ' + line.text;
    }
    prev = line;
  }
  flush();
  return blocks;
}

const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Usa l'indice (outline) del PDF per marcare l'inizio dei capitoli.
 * @param {Array<{ type: string, text: string, page: number, level?: number }>} blocks
 * @param {Array<{ title: string, page: number }>} outline
 */
export function applyOutline(blocks, outline) {
  if (!outline || outline.length < 2) return blocks;
  // i titoli trovati con la dimensione del carattere diventano sottotitoli
  let out = blocks.map((b) => (b.type === 'heading' ? { ...b, level: Math.max(2, b.level) } : b));
  for (const entry of outline) {
    const target = norm(entry.title);
    if (!target) continue;
    const onPage = out.filter((b) => b.page === entry.page);
    const match = onPage.find((b) => {
      const n = norm(b.text);
      return n === target || (b.type === 'heading' && (n.startsWith(target) || target.startsWith(n) && n.length > 3));
    });
    if (match) {
      const i = out.indexOf(match);
      if (match.type === 'heading') out[i] = { ...match, level: 1 };
      else if (norm(match.text) === target) out[i] = { ...match, type: 'heading', level: 1 };
      else out.splice(i, 0, { type: 'heading', level: 1, text: entry.title, page: entry.page });
    } else {
      // il capitolo inizia sulla pagina indicata: inseriamo il titolo prima del primo blocco
      let i = out.findIndex((b) => b.page >= entry.page);
      if (i === -1) i = out.length;
      out.splice(i, 0, { type: 'heading', level: 1, text: entry.title, page: entry.page });
    }
  }
  return out;
}

async function readOutline(pdf) {
  try {
    const items = await pdf.getOutline();
    if (!items?.length) return [];
    // se il primo livello contiene un solo elemento (es. il titolo del libro) scendiamo di un livello
    let level = items;
    while (level.length === 1 && level[0].items?.length) level = level[0].items;
    const out = [];
    for (const it of level) {
      let dest = it.dest;
      if (typeof dest === 'string') dest = await pdf.getDestination(dest);
      if (!Array.isArray(dest)) continue;
      const page = typeof dest[0] === 'number' ? dest[0] : await pdf.getPageIndex(dest[0]);
      out.push({ title: it.title.trim(), page });
    }
    return out.sort((a, b) => a.page - b.page);
  } catch {
    return [];
  }
}

/**
 * @param {ArrayBuffer} data
 * @param {any} pdfjs modulo pdfjs-dist già configurato
 * @param {(p: number) => void} [onProgress]
 */
export async function parsePdf(data, pdfjs, onProgress) {
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items = content.items
      .filter((it) => 'str' in it && Math.abs(it.transform[1]) < 0.01)
      .map((it) => ({
        str: it.str,
        x: it.transform[4],
        y: it.transform[5],
        w: it.width,
        h: Math.hypot(it.transform[2], it.transform[3]) || it.height,
      }));
    pages.push({ width: viewport.width, height: viewport.height, items });
    page.cleanup();
    onProgress?.(i / pdf.numPages);
  }

  const pagesLines = stripRunningHeaders(pages.map(pageToLines), pages);
  const lines = pagesLines.flat();
  if (lines.reduce((n, l) => n + l.text.length, 0) < 20) {
    throw new Error('Questo PDF non contiene testo selezionabile (probabilmente è una scansione). Serve un PDF con testo o un documento Word.');
  }
  let blocks = linesToBlocks(lines);
  blocks = applyOutline(blocks, await readOutline(pdf));

  let meta = {};
  try {
    meta = (await pdf.getMetadata())?.info ?? {};
  } catch { /* metadati facoltativi */ }
  await pdf.destroy();
  const title = meta.Title?.trim();
  const useless = !title || /^(microsoft word|untitled|senza titolo|documento\d*$)|\.(docx?|pdf|odt)$/i.test(title);
  return { title: useless ? undefined : title, author: meta.Author?.trim() || undefined, blocks };
}
