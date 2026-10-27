import { describe, it, expect } from 'vitest';
import { cardinal, ordinal, romanToInt, decimal } from '../src/text/numbers-it.js';
import { normalizeForSpeech } from '../src/text/normalize-it.js';
import { splitSentences, dialogueRatios, sentenceMood, splitQuoted, quoteStartStates } from '../src/text/segment.js';

describe('numeri in italiano', () => {
  it.each([
    [0, 'zero'], [1, 'uno'], [8, 'otto'], [17, 'diciassette'], [21, 'ventuno'], [23, 'ventitré'],
    [28, 'ventotto'], [80, 'ottanta'], [100, 'cento'], [108, 'centotto'], [180, 'centottanta'],
    [103, 'centotré'], [999, 'novecentonovantanove'], [1000, 'mille'], [1984, 'millenovecentottantaquattro'],
    [2024, 'duemilaventiquattro'], [21000, 'ventunmila'], [23000, 'ventitremila'],
    [1000000, 'un milione'], [2500000, 'due milioni cinquecentomila'], [1000000000, 'un miliardo'],
  ])('%i → %s', (n, w) => expect(cardinal(n)).toBe(w));

  it.each([
    [1, 'primo'], [3, 'terzo'], [10, 'decimo'], [11, 'undicesimo'], [14, 'quattordicesimo'],
    [20, 'ventesimo'], [23, 'ventitreesimo'], [26, 'ventiseiesimo'], [100, 'centesimo'],
    [1000, 'millesimo'], [2000, 'duemillesimo'],
  ])('ordinale %i → %s', (n, w) => expect(ordinal(n)).toBe(w));

  it('ordinali femminili', () => {
    expect(ordinal(1, 'f')).toBe('prima');
    expect(ordinal(12, 'f')).toBe('dodicesima');
  });

  it('numeri romani', () => {
    expect(romanToInt('XIV')).toBe(14);
    expect(romanToInt('MCMLXXXIV')).toBe(1984);
    expect(romanToInt('IIII')).toBeNull();
    expect(romanToInt('CIAO')).toBeNull();
  });

  it('decimali', () => {
    expect(decimal('3', '5')).toBe('tre virgola cinque');
    expect(decimal('0', '05')).toBe('zero virgola zero cinque');
  });
});

describe('normalizzazione per la voce', () => {
  const n = (t) => normalizeForSpeech(t);

  it('abbreviazioni', () => {
    expect(n('Il Sig. Rossi e la Dott.ssa Bianchi.')).toBe('Il Signor Rossi e la Dottoressa Bianchi.');
    expect(n('Vedi pag. 12, ecc.')).toBe('Vedi pagina dodici, eccetera.');
    expect(n('Mele, pere ecc. sono frutti.')).toBe('Mele, pere eccetera sono frutti.');
    expect(n('La Rossi S.p.A. cresce.')).toBe('La Rossi esse pi a cresce.');
  });

  it('numeri romani nel contesto', () => {
    expect(n('Capitolo IV')).toBe('Capitolo quarto');
    expect(n('Parte II')).toBe('Parte seconda');
    expect(n('Luigi XIV era il re.')).toBe('Luigi quattordicesimo era il re.');
    expect(n('Nel XIX secolo.')).toBe('Nel diciannovesimo secolo.');
    expect(n('Papa Giovanni XXIII')).toBe('Papa Giovanni ventitreesimo');
    expect(n('Io sono qui.')).toBe('Io sono qui.');
  });

  it('date, orari e ordinali', () => {
    expect(n('Il 12/03/2024 alle 14:30.')).toBe('Il dodici marzo duemilaventiquattro alle quattordici e trenta.');
    expect(n('Il 1° maggio.')).toBe('Il primo maggio.');
    expect(n('Arrivò 2° in classifica.')).toBe('Arrivò secondo in classifica.');
  });

  it('valute, percentuali e migliaia', () => {
    expect(n('Costa 15 €.')).toBe('Costa quindici euro.');
    expect(n('Costa €1.250,50.')).toBe('Costa milleduecentocinquanta virgola cinquanta euro.');
    expect(n('Il 30% dei casi.')).toBe('Il trenta per cento dei casi.');
    expect(n('Ci sono 25 °C.')).toBe('Ci sono venticinque gradi.');
  });

  it('pulizia tipografica, note e dialoghi', () => {
    expect(n('«Vieni qui!» disse lui¹.')).toBe('"Vieni qui!" disse lui.');
    expect(n('Aspetta...')).toBe('Aspetta…');
    expect(n('— Vieni, — disse Mario, — è tardi.')).toBe('Vieni, disse Mario, è tardi.');
    expect(n('Vedi www.esempio.it per info.')).toBe('Vedi il sito esempio punto it per info.');
  });

  it('lascia le cifre al motore se richiesto', () => {
    expect(normalizeForSpeech('Ho 3 gatti.', { numbers: false })).toBe('Ho 3 gatti.');
  });
});

describe('segmentazione', () => {
  it('divide le frasi rispettando abbreviazioni e iniziali', () => {
    expect(splitSentences('Il Sig. Rossi arrivò. Era tardi! Chi era? A. Manzoni scrisse molto.')).toEqual([
      'Il Sig. Rossi arrivò.', 'Era tardi!', 'Chi era?', 'A. Manzoni scrisse molto.',
    ]);
  });

  it('tiene le virgolette di chiusura con la frase', () => {
    expect(splitSentences('«Vieni qui!» disse. «Subito.» Poi partì.')).toEqual([
      '«Vieni qui!» disse.', '«Subito.»', 'Poi partì.',
    ]);
  });

  it('spezza le frasi troppo lunghe', () => {
    const long = Array.from({ length: 30 }, (_, i) => `parola${i} altra parola`).join(', ') + '.';
    const parts = splitSentences(long);
    expect(parts.length).toBeGreaterThan(1);
    parts.forEach((p) => expect(p.length).toBeLessThanOrEqual(280));
    expect(parts.join(' ')).toBe(long);
  });

  it('riconosce i dialoghi anche su più frasi', () => {
    const s = splitSentences('«Ciao. Come stai?» chiese Anna. Lui sorrise.');
    const r = dialogueRatios(s);
    expect(r[0]).toBe(1);
    expect(r[1]).toBeGreaterThan(0.3);
    expect(quoteStartStates(s)).toEqual([false, true, false]);
    expect(r[2]).toBe(0);
    expect(dialogueRatios(['Vieni, disse.'], true)).toEqual([1]);
  });

  it('separa battute e narrazione', () => {
    expect(splitQuoted('«Vieni qui!» disse lui, «subito.»')).toEqual([
      { text: '«Vieni qui!»', dialogue: true },
      { text: 'disse lui,', dialogue: false },
      { text: '«subito.»', dialogue: true },
    ]);
    expect(splitQuoted('Come stai?» chiese Anna.', true)).toEqual([
      { text: 'Come stai?»', dialogue: true },
      { text: 'chiese Anna.', dialogue: false },
    ]);
    expect(splitQuoted('Era notte.')).toEqual([{ text: 'Era notte.', dialogue: false }]);
  });

  it('riconosce il tono della frase', () => {
    expect(sentenceMood('Davvero?')).toBe('question');
    expect(sentenceMood('«Basta!»')).toBe('exclamation');
    expect(sentenceMood('E poi…')).toBe('suspense');
    expect(sentenceMood('Era notte.')).toBe('statement');
  });
});
