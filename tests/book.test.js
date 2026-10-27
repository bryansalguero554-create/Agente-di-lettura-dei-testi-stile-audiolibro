import { describe, it, expect } from 'vitest';
import { buildBook, looksLikeChapterHeading, globalIndex, totalSentences, remainingChars } from '../src/book.js';

const p = (text) => ({ type: 'p', text });
const h = (level, text) => ({ type: 'heading', level, text });

describe('costruzione del libro', () => {
  it('riconosce i titoli di capitolo', () => {
    expect(looksLikeChapterHeading('Capitolo 3')).toBe(true);
    expect(looksLikeChapterHeading('CAPITOLO PRIMO')).toBe(true);
    expect(looksLikeChapterHeading('Prologo')).toBe(true);
    expect(looksLikeChapterHeading('XIV')).toBe(true);
    expect(looksLikeChapterHeading('Il capitano entrò nella stanza e si sedette.')).toBe(false);
    expect(looksLikeChapterHeading('Parte della folla era già andata via.')).toBe(false);
  });

  it('usa gli heading come capitoli e il titolo unico come titolo del libro', () => {
    const book = buildBook({
      blocks: [
        h(1, 'Il giardino segreto'),
        h(2, 'Capitolo 1'), p('Era una mattina di sole. Maria uscì.'),
        h(2, 'Capitolo 2'), p('«Dove vai?» chiese il nonno.'),
      ],
    });
    expect(book.title).toBe('Il giardino segreto');
    expect(book.chapters.map((c) => c.title)).toEqual(['Capitolo 1', 'Capitolo 2']);
    expect(book.chapters[0].sentences.map((s) => s.text)).toEqual(['Capitolo 1', 'Era una mattina di sole.', 'Maria uscì.']);
    expect(book.chapters[0].sentences[0].heading).toBe(true);
    expect(book.chapters[1].sentences[1].dialogue).toBeGreaterThan(0);
  });

  it('riconosce i capitoli anche senza stili di titolo', () => {
    const book = buildBook({
      title: 'Racconti',
      blocks: [p('Prefazione dell\'autore.'), p('Capitolo I'), p('Testo uno.'), p('Capitolo II'), p('Testo due.')],
    });
    expect(book.chapters.map((c) => c.title)).toEqual(['Inizio', 'Capitolo I', 'Capitolo II']);
  });

  it('unisce numero e nome del capitolo', () => {
    const book = buildBook({ blocks: [h(2, 'Capitolo 1'), h(3, 'La partenza'), p('Testo.'), h(2, 'Capitolo 2'), p('Altro.')] });
    expect(book.chapters[0].title).toBe('Capitolo 1. La partenza');
  });

  it('divide in sezioni i documenti lunghi senza capitoli', () => {
    const para = 'Questa è una frase di prova con un certo numero di parole dentro. '.repeat(20);
    const book = buildBook({ title: 'Lungo', blocks: Array.from({ length: 60 }, () => p(para)) });
    expect(book.chapters.length).toBeGreaterThan(2);
    expect(book.chapters[0].title).toBe('Sezione 1');
  });

  it('calcola posizione globale e testo rimanente', () => {
    const book = buildBook({ blocks: [h(2, 'Uno'), p('A b. C d.'), h(2, 'Due'), p('E f.')] });
    expect(totalSentences(book)).toBe(5);
    expect(globalIndex(book, 1, 1)).toBe(4);
    expect(remainingChars(book, 1, 0)).toBe('Due'.length + 'E f.'.length);
  });

  it('usa il nome del file se manca un titolo', () => {
    expect(buildBook({ blocks: [p('Ciao.')], fallbackTitle: 'appunti' }).title).toBe('appunti');
  });
});
