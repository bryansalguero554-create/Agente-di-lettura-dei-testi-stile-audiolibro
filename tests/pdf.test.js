import { describe, it, expect } from 'vitest';
import { pageToLines, stripRunningHeaders, linesToBlocks, applyOutline } from '../src/parsers/pdf.js';

// costruisce una pagina sintetica: righe dall'alto, con x/y/dimensione
function page(lines, height = 800) {
  return {
    width: 600,
    height,
    items: lines.map(([str, y, size = 11, x = 72]) => ({ str, x, y, w: str.length * size * 0.5, h: size })),
  };
}

describe('PDF', () => {
  it('ricompone righe, paragrafi e parole sillabate', () => {
    const pages = [page([
      ['CAPITOLO 1', 700, 20, 240],
      ['Era una notte buia e tempestosa quando il vecchio capitano decise di parti-', 650],
      ['re verso il porto. Nessuno sapeva perché avesse scelto proprio quella', 636],
      ['notte.', 622],
      ['Il giorno dopo il mare era calmo e tutti in paese parlavano della sua', 600, 11, 90],
      ['partenza improvvisa.', 586],
      ['12', 40],
    ])];
    const lines = stripRunningHeaders(pages.map(pageToLines), pages).flat();
    const blocks = linesToBlocks(lines);
    expect(blocks[0]).toMatchObject({ type: 'heading', text: 'CAPITOLO 1' });
    expect(blocks[1].text).toBe('Era una notte buia e tempestosa quando il vecchio capitano decise di partire verso il porto. Nessuno sapeva perché avesse scelto proprio quella notte.');
    expect(blocks[2].text).toBe('Il giorno dopo il mare era calmo e tutti in paese parlavano della sua partenza improvvisa.');
    expect(blocks).toHaveLength(3);
  });

  it('elimina intestazioni ripetute e numeri di pagina', () => {
    const pages = [1, 2, 3, 4].map((n) => page([
      ['Il mio romanzo — Mario Rossi', 780, 9],
      [`Testo della pagina numero ${n} che continua normalmente fino in fondo alla riga.`, 600],
      [String(n), 30, 9, 300],
    ]));
    const lines = stripRunningHeaders(pages.map(pageToLines), pages).flat();
    expect(lines.map((l) => l.text).join(' ')).not.toMatch(/Mario Rossi|^\d$/);
    expect(lines).toHaveLength(4);
  });

  it('unisce parti di testo sulla stessa riga', () => {
    const lines = pageToLines({ width: 600, height: 800, items: [
      { str: 'Ciao', x: 72, y: 500, w: 22, h: 11 },
      { str: 'mondo', x: 100, y: 500.4, w: 30, h: 11 },
      { str: 'bel', x: 133.5, y: 500, w: 15, h: 11 },
    ] }, 0);
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe('Ciao mondo bel');
  });

  it('usa l\'indice del PDF per i capitoli', () => {
    const blocks = [
      { type: 'p', text: 'Introduzione breve.', page: 0 },
      { type: 'p', text: 'La partenza', page: 1 },
      { type: 'p', text: 'Testo del primo capitolo.', page: 1 },
      { type: 'p', text: 'Testo del secondo capitolo.', page: 2 },
    ];
    const out = applyOutline(blocks, [{ title: 'La partenza', page: 1 }, { title: 'Il ritorno', page: 2 }]);
    expect(out.filter((b) => b.type === 'heading').map((b) => b.text)).toEqual(['La partenza', 'Il ritorno']);
    expect(out[3]).toMatchObject({ type: 'heading', text: 'Il ritorno' });
  });
});
