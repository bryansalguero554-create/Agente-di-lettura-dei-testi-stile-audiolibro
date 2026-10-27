// Punto di ingresso per l'apertura dei file: riconosce il formato e costruisce il libro.

import { buildBook } from '../book.js';

export const ACCEPT = '.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export function detectFormat(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return 'pdf';
  if (name.endsWith('.docx') || file.type.includes('wordprocessingml')) return 'docx';
  if (name.endsWith('.doc')) throw new Error('Il vecchio formato .doc non è supportato: apri il file in Word e salvalo come .docx.');
  throw new Error('Formato non supportato. Puoi aprire file PDF o Word (.docx).');
}

let pdfjsPromise = null;
async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ]).then(([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

/**
 * Legge un file e restituisce il libro pronto per la narrazione.
 * @param {File} file
 * @param {(p: number) => void} [onProgress]
 */
export async function openFile(file, onProgress) {
  const format = detectFormat(file);
  const data = await file.arrayBuffer();
  let parsed;
  if (format === 'pdf') {
    const { parsePdf } = await import('./pdf.js');
    parsed = await parsePdf(data.slice(0), await loadPdfjs(), onProgress);
  } else {
    const { parseDocx } = await import('./docx.js');
    parsed = await parseDocx(data);
  }
  const fallbackTitle = file.name.replace(/\.(pdf|docx)$/i, '').replace(/[_-]+/g, ' ').trim();
  const book = buildBook({ ...parsed, fallbackTitle });
  if (!book.chars) throw new Error('Non ho trovato testo da leggere in questo file.');
  return { book, data, format };
}
