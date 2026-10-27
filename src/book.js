// Costruisce la struttura del libro (capitoli → paragrafi → frasi) a partire da blocchi di testo.

import { splitSentences, dialogueRatios, quoteStartStates, isDashDialogue, sentenceMood } from './text/segment.js';

const CHAPTER_WORDS = /^(capitolo|cap\.|parte|libro|prologo|epilogo|introduzione|prefazione|premessa|presentazione|conclusioni?|appendice|postfazione|ringraziamenti|indice|nota|chapter|part|prologue|epilogue)\b/i;
const SECTION_WORDS = 2500; // parole per "sezione" quando il documento non ha capitoli

/** Una riga breve che sembra il titolo di un capitolo ("Capitolo 3", "IV", "Prologo"). */
export function looksLikeChapterHeading(text) {
  const t = text.trim();
  if (!t || t.length > 90) return false;
  if (CHAPTER_WORDS.test(t)) return !/[.;,]$/.test(t) || /^(capitolo|cap\.|parte|chapter)\s+\S+\.?$/i.test(t);
  if (/^[IVXLC]{1,7}\.?$/.test(t)) return true;
  if (/^\d{1,3}\.?$/.test(t)) return true;
  return false;
}

/**
 * @typedef {{ type: 'heading', level: number, text: string } | { type: 'p', text: string }} Block
 * @typedef {{ text: string, dialogue: number, mood: string, paragraph: number, heading?: boolean, inQuote?: boolean }} Sentence
 * @typedef {{ title: string, paragraphs: { heading: boolean, sentences: number[] }[], sentences: Sentence[] }} Chapter
 * @typedef {{ title: string, author?: string, chapters: Chapter[], words: number, chars: number }} Book
 */

/**
 * @param {{ title?: string, author?: string, blocks: Block[], fallbackTitle?: string }} input
 * @returns {Book}
 */
export function buildBook({ title, author, blocks, fallbackTitle }) {
  blocks = blocks
    .map((b) => ({ ...b, text: b.text.replace(/\s+/g, ' ').trim() }))
    .filter((b) => b.text);

  // Il titolo del documento è spesso il primo heading di livello 1, unico nel testo.
  const h1 = blocks.filter((b) => b.type === 'heading' && b.level === 1);
  if (h1.length === 1 && blocks.indexOf(h1[0]) < 3 && !looksLikeChapterHeading(h1[0].text)) {
    title = title || h1[0].text;
    blocks = blocks.filter((b) => b !== h1[0]);
  }

  // Scegliamo il livello di heading che definisce i capitoli: il più alto che compare
  // almeno due volte; in alternativa le righe che sembrano titoli di capitolo.
  const levels = [1, 2, 3].filter((l) => blocks.filter((b) => b.type === 'heading' && b.level === l).length >= 2);
  const chapterLevel = levels[0];
  const isChapterStart = (b) =>
    chapterLevel
      ? b.type === 'heading' && b.level <= chapterLevel
      : (b.type === 'heading' || b.type === 'p') && looksLikeChapterHeading(b.text);

  const groups = [];
  let current = null;
  for (const b of blocks) {
    if (isChapterStart(b)) {
      current = { title: b.text, blocks: [{ ...b, type: 'heading' }] };
      groups.push(current);
      continue;
    }
    if (!current) {
      current = { title: '', blocks: [] };
      groups.push(current);
    }
    current.blocks.push(b);
  }

  // Un titolo isolato seguito da un sottotitolo breve ("Capitolo 1" + "La partenza") diventa un titolo unico.
  for (const g of groups) {
    const [first, second] = g.blocks;
    if (first?.type === 'heading' && second && second.text.length < 80 && !/[.!?…]$/.test(second.text) &&
        (second.type === 'heading' || /^(capitolo|parte|chapter)\s+\S+$|^[IVXLC\d]+\.?$/i.test(first.text))) {
      g.title = `${first.text}. ${second.text}`;
      second.type = 'heading';
    }
  }

  let chaptersRaw = groups.filter((g) => g.blocks.some((b) => b.type === 'p') || g.blocks.length > 1);
  if (!chaptersRaw.length) chaptersRaw = groups;

  // Senza capitoli riconosciuti si divide in sezioni di lunghezza regolare.
  if (chaptersRaw.length <= 1 && countWords(blocks) > SECTION_WORDS * 1.5) {
    chaptersRaw = splitIntoSections(chaptersRaw[0]?.blocks ?? blocks);
  }

  const chapters = chaptersRaw.map((g, i) => makeChapter(g, i));
  const words = chapters.reduce((n, c) => n + c.sentences.reduce((m, s) => m + s.text.split(/\s+/).length, 0), 0);
  const chars = chapters.reduce((n, c) => n + c.sentences.reduce((m, s) => m + s.text.length, 0), 0);
  return { title: title || fallbackTitle || 'Documento senza titolo', author, chapters, words, chars };
}

function countWords(blocks) {
  return blocks.reduce((n, b) => n + b.text.split(/\s+/).length, 0);
}

function splitIntoSections(blocks) {
  const sections = [];
  let current = null;
  let words = 0;
  for (const b of blocks) {
    if (!current || (words >= SECTION_WORDS && b.type === 'p')) {
      current = { title: `Sezione ${sections.length + 1}`, blocks: [] };
      sections.push(current);
      words = 0;
    }
    current.blocks.push(b);
    words += b.text.split(/\s+/).length;
  }
  return sections;
}

function makeChapter(group, index) {
  const chapter = {
    title: group.title || (index === 0 ? 'Inizio' : `Sezione ${index + 1}`),
    paragraphs: [],
    sentences: [],
  };
  for (const b of group.blocks) {
    const heading = b.type === 'heading';
    const parts = heading ? [b.text] : splitSentences(b.text);
    const ratios = heading ? [0] : dialogueRatios(parts, isDashDialogue(b.text));
    const inQuote = heading ? [false] : quoteStartStates(parts);
    const paragraph = { heading, sentences: [] };
    const pIndex = chapter.paragraphs.length;
    parts.forEach((text, j) => {
      paragraph.sentences.push(chapter.sentences.length);
      chapter.sentences.push({
        text,
        paragraph: pIndex,
        dialogue: Math.round(ratios[j] * 100) / 100,
        mood: sentenceMood(text),
        ...(heading ? { heading: true } : {}),
        ...(inQuote[j] ? { inQuote: true } : {}),
      });
    });
    if (paragraph.sentences.length) chapter.paragraphs.push(paragraph);
  }
  return chapter;
}

/** Posizione assoluta (indice globale di frase) utile per percentuali e stime di durata. */
export function globalIndex(book, chapter, sentence) {
  let n = 0;
  for (let i = 0; i < chapter; i++) n += book.chapters[i].sentences.length;
  return n + sentence;
}

export function totalSentences(book) {
  return book.chapters.reduce((n, c) => n + c.sentences.length, 0);
}

/** Caratteri ancora da leggere a partire da una posizione. */
export function remainingChars(book, chapter, sentence) {
  let n = 0;
  book.chapters.forEach((c, i) => {
    if (i < chapter) return;
    c.sentences.forEach((s, j) => {
      if (i > chapter || j >= sentence) n += s.text.length;
    });
  });
  return n;
}
