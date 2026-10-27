// Vista del documento Word originale: il contenuto formattato (titoli, grassetti, elenchi,
// tabelle, immagini) con la frase in lettura evidenziata sul posto.

import mammoth from 'mammoth';
import { buildStream, alignBook, sentenceAtPosition } from './align.js';

export class DocxView {
  /**
   * @param {HTMLElement} container
   * @param {ArrayBuffer} data
   */
  constructor(container, data) {
    this.container = container;
    this.data = data;
    this.marks = [];
  }

  async init(book) {
    const { value: html } = await mammoth.convertToHtml({ arrayBuffer: this.data.slice(0) }, { ignoreEmptyParagraphs: true });
    const page = document.createElement('article');
    page.className = 'docx-page';
    page.innerHTML = html;
    // i link del documento si aprono fuori dall'app
    page.querySelectorAll('a[href]').forEach((a) => { a.target = '_blank'; a.rel = 'noopener'; });
    this.container.replaceChildren(page);
    this.page = page;

    // le note a piè di pagina (<sup>) non fanno parte del testo letto
    const walker = document.createTreeWalker(page, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement.closest('sup') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    this.nodes = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) this.nodes.push(n);
    this.stream = buildStream(this.nodes.map((n) => n.data));
    this.ranges = alignBook(book, this.stream);

    this.highlighter = typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined';
    page.addEventListener('click', (e) => this.#onClick(e));
    this.resize = () => this.lastRange && this.#drawFallback(this.lastRange);
    window.addEventListener('resize', this.resize);
  }

  #domRange(start, end) {
    const { piece, offset } = this.stream;
    const range = document.createRange();
    range.setStart(this.nodes[piece[start]], offset[start]);
    const last = end - 1;
    const endNode = this.nodes[piece[last]];
    range.setEnd(endNode, Math.min(endNode.data.length, offset[last] + 1));
    return range;
  }

  // senza la CSS Custom Highlight API si disegnano rettangoli sopra il testo
  #drawFallback(range) {
    this.marks.forEach((m) => m.remove());
    this.marks = [];
    const base = this.page.getBoundingClientRect();
    for (const r of range.getClientRects()) {
      const mark = document.createElement('div');
      mark.className = 'doc-mark';
      Object.assign(mark.style, {
        left: `${r.left - base.left}px`, top: `${r.top - base.top}px`, width: `${r.width}px`, height: `${r.height}px`,
      });
      this.page.appendChild(mark);
      this.marks.push(mark);
    }
  }

  highlight(chapter, sentence) {
    const r = this.ranges[chapter]?.[sentence];
    if (!r) {
      if (this.highlighter) CSS.highlights.delete('reading');
      else this.marks.forEach((m) => m.remove());
      this.lastRange = null;
      return null;
    }
    const range = this.#domRange(r[0], r[1]);
    this.lastRange = range;
    if (this.highlighter) CSS.highlights.set('reading', new Highlight(range));
    else this.#drawFallback(range);
    return range;
  }

  #onClick(e) {
    if (e.target.closest('a')) return;
    const pos = document.caretPositionFromPoint?.(e.clientX, e.clientY);
    const node = pos ? pos.offsetNode : document.caretRangeFromPoint?.(e.clientX, e.clientY)?.startContainer;
    const offset = pos ? pos.offset : document.caretRangeFromPoint?.(e.clientX, e.clientY)?.startOffset ?? 0;
    const idx = this.nodes.indexOf(node);
    if (idx < 0) return;
    const { piece, offset: offs } = this.stream;
    let at = -1;
    for (let i = 0; i < piece.length; i++) {
      if (piece[i] === idx && offs[i] >= offset) { at = i; break; }
      if (piece[i] > idx) { at = i; break; }
    }
    if (at < 0) return;
    const hit = sentenceAtPosition(this.ranges, at);
    if (hit) this.onSentenceClick?.(hit);
  }

  destroy() {
    if (this.highlighter) CSS.highlights.delete('reading');
    window.removeEventListener('resize', this.resize);
    this.container.replaceChildren();
  }
}
