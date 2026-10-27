// Conversione di numeri in parole italiane (cardinali e ordinali) e numeri romani.

const UNITS = [
  'zero', 'uno', 'due', 'tre', 'quattro', 'cinque', 'sei', 'sette', 'otto', 'nove',
  'dieci', 'undici', 'dodici', 'tredici', 'quattordici', 'quindici', 'sedici',
  'diciassette', 'diciotto', 'diciannove',
];
const TENS = ['', '', 'venti', 'trenta', 'quaranta', 'cinquanta', 'sessanta', 'settanta', 'ottanta', 'novanta'];

function under100(n) {
  if (n < 20) return UNITS[n];
  const t = Math.floor(n / 10);
  const u = n % 10;
  let word = TENS[t];
  if (u === 0) return word;
  // ventuno, ventotto: la vocale finale cade davanti a "uno" e "otto"
  if (u === 1 || u === 8) word = word.slice(0, -1);
  return word + (u === 3 ? 'tré' : UNITS[u]);
}

function under1000(n) {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  let word = h === 0 ? '' : h === 1 ? 'cento' : UNITS[h] + 'cento';
  if (rest === 0) return word;
  let tail = under100(rest);
  // centotto, centottanta
  if (h > 0 && (Math.floor(rest / 10) === 8 || rest === 8)) word = word.slice(0, -1);
  if (h > 0 && rest === 3) tail = 'tré';
  return word + tail;
}

/** Numero intero (0 ≤ n < 10^12) in parole italiane. */
export function cardinal(n) {
  n = Math.floor(Math.abs(Number(n)));
  if (!Number.isFinite(n)) return String(n);
  if (n === 0) return 'zero';
  if (n >= 1e12) return String(n).split('').map((d) => UNITS[+d]).join(' ');

  const parts = [];
  const billions = Math.floor(n / 1e9);
  const millions = Math.floor((n % 1e9) / 1e6);
  const thousands = Math.floor((n % 1e6) / 1000);
  const rest = n % 1000;

  if (billions) parts.push(billions === 1 ? 'un miliardo' : under1000Full(billions) + ' miliardi');
  if (millions) parts.push(millions === 1 ? 'un milione' : under1000Full(millions) + ' milioni');

  let low = '';
  if (thousands) low += thousands === 1 ? 'mille' : under1000Full(thousands) + 'mila';
  if (rest) low += under1000(rest);
  if (low) parts.push(low);
  return parts.join(' ');
}

// come under1000 ma con le forme corrette per i multipli (ventunmila, ventun milioni)
function under1000Full(n) {
  const w = under1000(n).replace(/tré$/, 'tre');
  return w.endsWith('uno') && n > 1 ? w.slice(0, -1) : w;
}

const ORDINALS = ['', 'primo', 'secondo', 'terzo', 'quarto', 'quinto', 'sesto', 'settimo', 'ottavo', 'nono', 'decimo'];

/** Ordinale italiano: 1 → primo, 23 → ventitreesimo. gender: 'm' | 'f'. */
export function ordinal(n, gender = 'm') {
  n = Math.floor(Number(n));
  let word;
  if (n >= 1 && n <= 10) {
    word = ORDINALS[n];
  } else {
    const c = cardinal(n).replace(/\s+/g, '');
    if (c.endsWith('tré')) word = c.slice(0, -3) + 'treesimo';
    else if (c.endsWith('sei')) word = c + 'esimo';
    else if (c.endsWith('mila')) word = c.slice(0, -4) + 'millesimo';
    else word = c.slice(0, -1) + 'esimo';
  }
  return gender === 'f' ? word.slice(0, -1) + 'a' : word;
}

const ROMAN = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
const ROMAN_RE = /^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/;

/** Restituisce il valore di un numero romano valido, altrimenti null. */
export function romanToInt(s) {
  if (!s || !ROMAN_RE.test(s)) return null;
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const v = ROMAN[s[i]];
    const next = ROMAN[s[i + 1]] || 0;
    total += v < next ? -v : v;
  }
  return total || null;
}

/** Legge un numero decimale scritto all'italiana ("3,5" → "tre virgola cinque"). */
export function decimal(intPart, decPart) {
  const head = cardinal(intPart);
  if (!decPart) return head;
  // i decimali con zeri iniziali si leggono cifra per cifra: 0,05 → zero virgola zero cinque
  const tail = /^0/.test(decPart) || decPart.length > 3
    ? decPart.split('').map((d) => UNITS[+d]).join(' ')
    : cardinal(decPart);
  return `${head} virgola ${tail}`;
}

export const MONTHS = [
  'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre',
];
