// Vista del PDF originale: pagine disegnate con pdf.js e frase in lettura evidenziata
// direttamente sulla pagina.

import { buildStream, alignBook, sentenceAtPosition } from './align.js';

/** Unisce in una sola fascia i rettangoli della stessa riga (una parola per pezzo nei PDF). */
export function mergeLines(rects) {
  const lines = [];
  for (const r of [...rects].sort((a, b) => a.page - b.page || a.top - b.top || a.left - b.left)) {
    const line = lines.find((l) => l.page === r.page && Math.abs(l.top - r.top) < Math.min(l.height, r.height) * 0.5);
    if (!line) { lines.push({ ...r }); continue; }
    const right = Math.max(line.left + line.width, r.left + r.width);
    line.left = Math.min(line.left, r.left);
    line.width = right - line.left;
    const bottom = Math.max(line.top + line.height, r.top + r.height);
    line.top = Math.min(line.top, r.top);
    line.height = bottom - line.top;
  }
  return lines;
}

export class PdfView {
  /**
   * @param {HTMLElement} container
   * @param {ArrayBuffer} data
   * @param {any} pdfjs
   */
  constructor(container, data, pdfjs) {
    this.container = container;
    this.data = data;
    this.pdfjs = pdfjs;
    this.pages = []; // { el, canvas, overlay, viewport, items, page, rendered }
    this.ranges = [];
    this.observer = null;
    this.destroyed = false;
  }

  async init(book) {
    const { pdfjs } = this;
    this.doc = await pdfjs.getDocument({ data: new Uint8Array(this.data.slice(0)), isEvalSupported: false }).promise;
    const root = document.createElement('div');
    root.className = 'pdf-pages';
    const pieces = [];
    for (let n = 1; n <= this.doc.numPages; n++) {
      if (this.destroyed) return;
      const page = await this.doc.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items = [];
      for (const it of content.items) {
        if (!('str' in it) || !it.str) continue;
        const tx = pdfjs.Util.transform(viewport.transform, it.transform);
        const h = Math.hypot(tx[2], tx[3]) || it.height;
        items.push({
          str: it.str,
          x: tx[4],
          y: tx[5] - h * 0.86,
          w: it.width * (Math.hypot(tx[0], tx[1]) / Math.hypot(it.transform[0], it.transform[1]) || 1),
          h: h * 1.12,
          page: n - 1,
        });
        pieces.push(it.str);
      }
      const el = document.createElement('div');
      el.className = 'pdf-page';
      el.style.aspectRatio = `${viewport.width} / ${viewport.height}`;
      el.dataset.page = n - 1;
      const canvas = document.createElement('canvas');
      const overlay = document.createElement('div');
      overlay.className = 'pdf-overlay';
      el.append(canvas, overlay);
      root.appendChild(el);
      this.pages.push({ el, canvas, overlay, viewport, items, page, rendered: false });
    }
    this.items = this.pages.flatMap((p) => p.items);
    this.stream = buildStream(pieces);
    this.ranges = alignBook(book, this.stream);
    this.container.replaceChildren(root);

    // si disegnano solo le pagine vicine allo schermo, liberando la memoria delle altre
    this.observer = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const p = this.pages[+e.target.dataset.page];
        if (e.isIntersecting) this.#render(p);
        else this.#release(p);
      }
    }, { root: this.container, rootMargin: '1200px 0px' });
    this.pages.forEach((p) => this.observer.observe(p.el));
    root.addEventListener('click', (e) => this.#onClick(e));
  }

  async #render(p) {
    if (p.rendered || this.destroyed) return;
    p.rendered = true;
    const width = p.el.clientWidth || this.container.clientWidth;
    const scale = (width / p.viewport.width) * Math.min(window.devicePixelRatio || 1, 2);
    const viewport = p.page.getViewport({ scale });
    p.canvas.width = Math.floor(viewport.width);
    p.canvas.height = Math.floor(viewport.height);
    p.task = p.page.render({ canvasContext: p.canvas.getContext('2d'), viewport });
    try {
      await p.task.promise;
    } catch { /* rendering annullato */ }
  }

  #release(p) {
    if (!p.rendered) return;
    p.task?.cancel();
    p.rendered = false;
    p.canvas.width = 0;
    p.canvas.height = 0;
  }

  /** Rettangoli (in % della pagina) del tratto [start, end) del flusso. */
  #rects(start, end) {
    const { piece, offset } = this.stream;
    const byItem = new Map();
    for (let i = start; i < end; i++) {
      const it = piece[i];
      const o = offset[i];
      const r = byItem.get(it);
      if (r) { r.from = Math.min(r.from, o); r.to = Math.max(r.to, o + 1); } else byItem.set(it, { from: o, to: o + 1 });
    }
    const rects = [];
    for (const [idx, { from, to }] of byItem) {
      const it = this.items[idx];
      const len = it.str.length || 1;
      const vp = this.pages[it.page].viewport;
      const x = it.x + (it.w * from) / len;
      const w = (it.w * (to - from)) / len;
      rects.push({
        page: it.page,
        left: (x / vp.width) * 100,
        top: (it.y / vp.height) * 100,
        width: (w / vp.width) * 100,
        height: (it.h / vp.height) * 100,
      });
    }
    return mergeLines(rects);
  }

  /** Evidenzia la frase; restituisce l'elemento su cui centrare lo scorrimento. */
  highlight(chapter, sentence) {
    this.pages.forEach((p) => p.overlay.replaceChildren());
    const range = this.ranges[chapter]?.[sentence];
    if (!range) return null;
    let first = null;
    for (const r of this.#rects(range[0], range[1])) {
      const mark = document.createElement('div');
      mark.className = 'doc-mark';
      Object.assign(mark.style, { left: `${r.left}%`, top: `${r.top}%`, width: `${r.width}%`, height: `${r.height}%` });
      this.pages[r.page].overlay.appendChild(mark);
      first ??= mark;
    }
    return first;
  }

  #onClick(e) {
    const pageEl = e.target.closest('.pdf-page');
    if (!pageEl) return;
    const p = this.pages[+pageEl.dataset.page];
    const box = pageEl.getBoundingClientRect();
    const x = ((e.clientX - box.left) / box.width) * p.viewport.width;
    const y = ((e.clientY - box.top) / box.height) * p.viewport.height;
    // pezzo di testo più vicino al punto toccato
    let best = -1;
    let bestDist = Infinity;
    const base = this.items.indexOf(p.items[0]);
    p.items.forEach((it, k) => {
      const dx = x < it.x ? it.x - x : x > it.x + it.w ? x - it.x - it.w : 0;
      const dy = y < it.y ? it.y - y : y > it.y + it.h ? y - it.y - it.h : 0;
      const d = dx * dx + dy * dy * 4;
      if (d < bestDist) { bestDist = d; best = base + k; }
    });
    if (best < 0 || bestDist > 2500) return;
    const pos = this.stream.piece.indexOf(best);
    if (pos < 0) return;
    const hit = sentenceAtPosition(this.ranges, pos);
    if (hit) this.onSentenceClick?.(hit);
  }

  destroy() {
    this.destroyed = true;
    this.observer?.disconnect();
    this.pages.forEach((p) => p.task?.cancel());
    this.doc?.destroy();
    this.container.replaceChildren();
  }
}
