// Lettura dei documenti Word (.docx) tramite mammoth.

import mammoth from 'mammoth';
import JSZip from 'jszip';

const STYLE_MAP = [
  "p[style-name='Title'] => h1:fresh",
  "p[style-name='Titolo'] => h1:fresh",
  "p[style-name='Subtitle'] => h3:fresh",
  "p[style-name='Sottotitolo'] => h3:fresh",
  "p[style-name='Titolo 1'] => h1:fresh",
  "p[style-name='Titolo 2'] => h2:fresh",
  "p[style-name='Titolo 3'] => h3:fresh",
  "p[style-name='Titolo 4'] => h4:fresh",
];

/**
 * Converte l'HTML di mammoth in blocchi.
 * @param {string} html
 * @param {(html: string) => Document} parse
 */
export function htmlToBlocks(html, parse) {
  const doc = parse(`<body>${html}</body>`);
  const blocks = [];
  const walk = (node) => {
    for (const el of node.children) {
      const tag = el.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag)) {
        blocks.push({ type: 'heading', level: Math.min(+tag[1], 4), text: el.textContent });
      } else if (tag === 'p' || tag === 'li' || tag === 'blockquote' || tag === 'dt' || tag === 'dd') {
        // le note a piè di pagina di mammoth sono link <sup>: le togliamo dal testo letto
        el.querySelectorAll('sup').forEach((s) => s.remove());
        const text = el.textContent;
        if (tag === 'li' && el.querySelector('p, li')) walk(el);
        else blocks.push({ type: 'p', text });
      } else if (tag === 'tr') {
        const cells = [...el.children].map((c) => c.textContent.trim()).filter(Boolean);
        if (cells.length) blocks.push({ type: 'p', text: cells.join('; ') + '.' });
      } else if (tag === 'img') {
        continue;
      } else {
        walk(el);
      }
    }
  };
  walk(doc.body);
  return blocks;
}

async function readCoreProps(arrayBuffer) {
  try {
    const zip = await JSZip.loadAsync(arrayBuffer);
    const xml = await zip.file('docProps/core.xml')?.async('string');
    if (!xml) return {};
    const pick = (tag) => (xml.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`)) || [])[1]?.trim();
    return { title: pick('dc:title'), author: pick('dc:creator') };
  } catch {
    return {};
  }
}

/**
 * @param {ArrayBuffer} arrayBuffer
 * @param {(html: string) => Document} [parse]
 */
export async function parseDocx(arrayBuffer, parse = (h) => new DOMParser().parseFromString(h, 'text/html')) {
  const [{ value: html }, props] = await Promise.all([
    // nel browser mammoth accetta arrayBuffer, in Node (test) un Buffer
    mammoth.convertToHtml(typeof Buffer !== 'undefined' ? { buffer: Buffer.from(arrayBuffer) } : { arrayBuffer }, { styleMap: STYLE_MAP, ignoreEmptyParagraphs: true }),
    readCoreProps(arrayBuffer),
  ]);
  return { title: props.title, author: props.author, blocks: htmlToBlocks(html, parse) };
}
