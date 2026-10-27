// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { parseDocx } from '../src/parsers/docx.js';
import { buildBook } from '../src/book.js';
import { makeDocx } from './fixtures/make-docx.js';

describe('DOCX', () => {
  it('legge titolo, autore, capitoli, elenchi e tabelle', async () => {
    const buf = await makeDocx();
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const parsed = await parseDocx(ab);
    expect(parsed.title).toBe('Il faro di Levante');
    expect(parsed.author).toBe('Giulia Verdi');
    const book = buildBook(parsed);
    expect(book.title).toBe('Il faro di Levante');
    expect(book.chapters.map((c) => c.title)).toEqual(['Capitolo 1', 'Capitolo 2']);
    const texts = book.chapters[0].sentences.map((s) => s.text);
    expect(texts).toContain('Il Sig. Bianchi arrivò al faro il 12/03/1924 alle 18:30.');
    expect(texts).toContain('Primo punto della lista');
    expect(texts).toContain('Ora; Evento.');
    const dialogue = book.chapters[0].sentences.filter((s) => s.dialogue >= 0.5).map((s) => s.text);
    expect(dialogue).toContain('«Sono io, il nuovo assistente.»');
    expect(book.chapters[1].sentences.map((s) => s.text)).toEqual([
      'Capitolo 2', 'La notte passò in silenzio.', 'Al mattino il mare era calmo.',
    ]);
  });
});
