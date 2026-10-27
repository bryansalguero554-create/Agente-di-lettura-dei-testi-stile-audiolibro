import { Player } from './player.js';
import { SleepTimer } from './sleep-timer.js';
import { loadSettings, saveSettings } from './settings.js';
import { books, files, progress, bookmarks, fileId } from './storage.js';
import { openFile, loadPdfjs } from './parsers/index.js';
import { globalIndex, totalSentences, remainingChars } from './book.js';
import { WebSpeechEngine, isSupported as webSpeechSupported, listItalianVoices } from './engines/webspeech.js';
import { PiperEngine, PIPER_VOICES } from './engines/piper.js';
import { OpenAIEngine, ElevenLabsEngine, GeminiEngine, ELEVEN_MODELS, GEMINI_MODELS } from './engines/cloud.js';
import { normalizeForSpeech } from './text/normalize-it.js';

const $ = (sel) => document.querySelector(sel);
const CHARS_PER_MINUTE = 950; // ritmo medio di un narratore italiano a 1×

// ------------------------------------------------------------------ stato

const settings = loadSettings();
const persist = () => saveSettings(settings);

const engines = {
  device: new WebSpeechEngine(),
  piper: new PiperEngine(),
  openai: new OpenAIEngine(() => settings.keys.openai),
  elevenlabs: new ElevenLabsEngine(() => settings.keys.elevenlabs, () => settings.elevenModel),
  gemini: new GeminiEngine(() => settings.keys.gemini, () => settings.geminiModel),
};
engines.gemini.onModelFallback = (model) => {
  const label = GEMINI_MODELS.find(([id]) => id === model)?.[1] || model;
  toast(`Il modello scelto non è incluso nella tua chiave Gemini: uso ${label}.`, 6000);
};

const ENGINE_INFO = {
  piper: {
    title: 'Paola · voce neurale gratuita',
    tags: [['Gratis'], ['Offline']],
    text: 'Voce neurale italiana che funziona nel browser, senza account. Si scarica una sola volta (circa 64 MB), poi funziona anche senza internet.',
  },
  device: {
    title: 'Voci del dispositivo',
    tags: [['Gratis'], ['Immediata']],
    text: 'Usa le voci italiane del sistema. Le più naturali: «Natural» su Microsoft Edge, «Premium/Migliorata» su iPhone e Mac (Impostazioni › Accessibilità › Contenuto letto ad alta voce › Voci).',
  },
  gemini: {
    title: 'Gemini',
    tags: [['La più naturale', 'best'], ['A consumo']],
    text: 'Le voci di Google Gemini, guidate come un regista: le chiediamo di leggere da narratore italiano madrelingua e di recitare i dialoghi. Legge un paragrafo alla volta per un\'intonazione continua.',
    key: 'gemini',
    keyHint: 'Crea la chiave su aistudio.google.com › Get API key. Gemini 3.8 richiede la fatturazione attiva (costo basso, a consumo); con una chiave gratuita l\'app usa da sola i modelli Gemini inclusi nel piano gratuito, se ce ne sono.',
  },
  elevenlabs: {
    title: 'ElevenLabs',
    tags: [['Qualità top', 'best'], ['A pagamento']],
    text: 'Le voci più realistiche ed espressive, come le app di audiolibri professionali. Serve una chiave API ElevenLabs.',
    key: 'elevenlabs',
    keyHint: 'Crea la chiave su elevenlabs.io › Developers › API Keys. Per l\'accento italiano scegli o aggiungi alla tua libreria una voce italiana (filtro lingua: Italiano).',
  },
  openai: {
    title: 'OpenAI',
    tags: [['Molto naturale'], ['A pagamento']],
    text: 'Voci neurali guidate da istruzioni: le chiediamo di leggere come un narratore italiano madrelingua, cambiando tono nei dialoghi.',
    key: 'openai',
    keyHint: 'Crea la chiave su platform.openai.com › API keys. Costo indicativo: pochi centesimi per capitolo.',
  },
};
// versione di prova ospitata dove la rete esterna è bloccata: solo voci del dispositivo
const LIMITED = import.meta.env.VITE_LIMITED === '1';
const ENGINE_ORDER = LIMITED ? ['device'] : ['gemini', 'piper', 'device', 'elevenlabs', 'openai'];

const player = new Player({ settings: () => settings });
const timer = new SleepTimer(player);
let book = null; // { id, ...book }
let marks = [];
let followPausedUntil = 0;

// ------------------------------------------------------------------ utilità UI

let toastTimer;
function toast(message, ms = 3500) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  el.classList.toggle('low', !$('#library-view').hidden);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), ms);
}

function confirmDialog(title, text, okLabel = 'Continua') {
  const dlg = $('#confirm-dialog');
  $('#confirm-title').textContent = title;
  $('#confirm-text').textContent = text;
  $('#confirm-ok').textContent = okLabel;
  dlg.showModal();
  return new Promise((resolve) => {
    $('#confirm-ok').onclick = () => { dlg.close(); resolve(true); };
    $('#confirm-cancel').onclick = () => { dlg.close(); resolve(false); };
    dlg.oncancel = () => resolve(false);
  });
}

const fmtRate = (r) => `${String(+r.toFixed(2)).replace('.', ',')}×`;

function fmtShort(minutes) {
  if (minutes < 1) return '<1 min';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
}

function fmtDuration(minutes) {
  if (minutes < 1) return 'meno di un minuto';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

function coverColor(title) {
  let h = 0;
  for (const c of title) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `linear-gradient(160deg, hsl(${h} 45% 42%), hsl(${(h + 30) % 360} 50% 28%))`;
}

function applyAppearance() {
  const theme = settings.theme === 'auto'
    ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : settings.theme;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.setProperty('--reading-size', `${settings.fontSize}px`);
  document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#15120f' : theme === 'sepia' ? '#efe2c8' : '#f6f1e7';
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyAppearance);

// ------------------------------------------------------------------ motore vocale

async function chooseDefaultEngine() {
  if (LIMITED) {
    settings.engine = 'device';
    return;
  }
  if (settings.engine) return;
  // le voci di sistema di alta qualità (Edge Natural, Apple Premium) sono la scelta più immediata
  const voices = webSpeechSupported() ? await listItalianVoices() : [];
  settings.engine = voices[0]?.score >= 40 ? 'device' : 'piper';
  persist();
}

function currentEngine() {
  return engines[settings.engine] || engines.piper;
}

async function engineVoiceLabel() {
  const engine = currentEngine();
  try {
    const voices = await engine.voices();
    const id = settings.voices[engine.id] || engine.bestVoiceId?.();
    const v = voices.find((x) => x.id === id) || voices[0];
    return v ? v.label : ENGINE_INFO[engine.id].title;
  } catch {
    return ENGINE_INFO[engine.id].title;
  }
}

async function refreshVoiceLabel() {
  $('#voice-label').textContent = await engineVoiceLabel();
}

/** Chiede il consenso prima di scaricare il modello neurale (decine di MB). */
async function ensurePiperConsent() {
  if (settings.engine !== 'piper' || settings.piperConsent) return true;
  const voice = PIPER_VOICES.find((v) => v.id === settings.voices.piper) || PIPER_VOICES[0];
  const ok = await confirmDialog(
    `Scaricare la voce ${voice.label}?`,
    `La voce neurale italiana ${voice.label} pesa circa ${Math.round(voice.size)} MB e si scarica una sola volta: poi funziona anche offline. Meglio usare il Wi-Fi.`,
    'Scarica',
  );
  if (ok) {
    settings.piperConsent = true;
    persist();
  }
  return ok;
}

engines.piper.onProgress = (fraction, loaded) => {
  if (player.state !== 'loading') return;
  const mb = (loaded / 1048576).toFixed(0);
  $('#pos-label').textContent = fraction ? `Scarico la voce… ${Math.round(fraction * 100)}%` : `Scarico la voce… ${mb} MB`;
};

// ------------------------------------------------------------------ libreria

async function renderLibrary() {
  const [all, prog] = await Promise.all([books.all(), progress.all()]);
  const progMap = new Map(prog.map((p) => [p.bookId, p]));
  all.sort((a, b) => (progMap.get(b.id)?.updatedAt || b.addedAt) - (progMap.get(a.id)?.updatedAt || a.addedAt));
  const list = $('#book-list');
  list.innerHTML = '';
  $('#empty-library').hidden = all.length > 0;
  for (const b of all) {
    const p = progMap.get(b.id);
    const pct = p ? Math.round(p.percent * 100) : 0;
    const minutes = b.chars / CHARS_PER_MINUTE;
    const li = document.createElement('li');
    li.className = 'book-card';
    li.innerHTML = `
      <div class="cover"></div>
      <div class="book-meta">
        <h3></h3>
        <p></p>
        <div class="bar"><i style="width:${pct}%"></i></div>
      </div>
      <button class="icon-btn" aria-label="Elimina dalla libreria"><svg><use href="#i-trash"/></svg></button>`;
    li.querySelector('.cover').style.background = coverColor(b.title);
    li.querySelector('.cover').textContent = b.title.trim()[0]?.toUpperCase() || '·';
    li.querySelector('h3').textContent = b.title;
    li.querySelector('p').textContent = [
      b.author,
      `${b.chapters.length} ${b.chapters.length === 1 ? 'capitolo' : 'capitoli'}`,
      `≈ ${fmtDuration(minutes)}`,
      pct ? `${pct}% ascoltato` : b.format?.toUpperCase(),
    ].filter(Boolean).join(' · ');
    li.addEventListener('click', () => openBook(b.id));
    li.querySelector('button').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (await confirmDialog('Eliminare il libro?', `«${b.title}» verrà rimosso dalla libreria insieme a posizione e segnalibri.`, 'Elimina')) {
        await books.remove(b.id);
        renderLibrary();
      }
    });
    list.appendChild(li);
  }
}

async function importFile(file) {
  const status = $('#import-status');
  status.hidden = false;
  $('#import-label').textContent = `Preparo «${file.name}»…`;
  try {
    const { book: parsed, data, format } = await openFile(file, (p) => {
      $('#import-label').textContent = `Leggo le pagine… ${Math.round(p * 100)}%`;
    });
    const id = await fileId(data);
    const existing = await books.get(id);
    if (!existing) await books.put({ id, ...parsed, fileName: file.name, format, addedAt: Date.now() });
    await files.put(id, data);
    status.hidden = true;
    await openBook(id);
    if (!existing) toast(`Pronto: ${parsed.chapters.length} ${parsed.chapters.length === 1 ? 'capitolo' : 'capitoli'}, circa ${fmtDuration(parsed.chars / CHARS_PER_MINUTE)} di ascolto.`);
  } catch (err) {
    console.error(err);
    status.hidden = true;
    toast(err.message || 'Impossibile aprire il file.', 6000);
  }
}

// ------------------------------------------------------------------ lettore

async function openBook(id) {
  const data = await books.get(id);
  if (!data) return;
  book = data;
  marks = await bookmarks.list(id);
  const pos = (await progress.get(id)) || { chapter: 0, sentence: 0 };
  $('#library-view').hidden = true;
  $('#reader-view').hidden = false;
  $('#book-title').textContent = book.title;
  document.title = `${book.title} · Narratore`;
  player.load(book, pos);
  renderChapter(player.chapter);
  updatePosition();
  scrollToActive('auto');
  history.pushState({ book: id }, '');
  await showOriginal(settings.viewMode !== 'text');
}

// ------------------------------------------------------------------ documento originale

let docView = null; // vista PDF o Word con l'evidenziazione sul documento
let docMark = null; // elemento (o Range) della frase evidenziata

const scroller = () => (docView ? $('#doc-view') : $('#text'));
const activeTarget = () => (docView ? docMark : document.querySelector('.s.active'));

function updateViewButton(original) {
  const btn = $('#view-btn');
  btn.querySelector('use').setAttribute('href', original ? '#i-text' : '#i-doc');
  btn.setAttribute('aria-label', original ? 'Mostra il testo semplice' : 'Mostra il documento originale');
  btn.title = btn.getAttribute('aria-label');
}

async function showOriginal(on) {
  docView?.destroy();
  docView = null;
  docMark = null;
  const current = book;
  let data = null;
  if (on && current) data = await files.get(current.id);
  if (on && !data) {
    if (settings.viewMode !== 'text') toast('Per vedere il documento originale apri di nuovo il file: i libri aggiunti prima di questa versione hanno solo il testo.', 6000);
    on = false;
  }
  $('#doc-view').hidden = !on;
  $('#text').hidden = on;
  updateViewButton(on);
  if (!on) {
    scrollToActive('auto');
    return;
  }
  $('#doc-view').innerHTML = '<p class="doc-loading">Preparo il documento…</p>';
  try {
    const view = current.format === 'pdf'
      ? new (await import('./views/pdf-view.js')).PdfView($('#doc-view'), data, await loadPdfjs())
      : new (await import('./views/docx-view.js')).DocxView($('#doc-view'), data);
    view.onSentenceClick = ({ chapter, sentence }) => {
      followPausedUntil = 0;
      player.seek(chapter, sentence);
      if (player.state !== 'playing' && player.state !== 'loading') togglePlay();
    };
    docView = view;
    await view.init(current);
    if (docView !== view || book !== current) return;
    updatePosition();
    scrollToActive('auto');
  } catch (err) {
    console.error(err);
    toast('Non riesco a mostrare il documento originale: uso il testo semplice.', 5000);
    docView = null;
    $('#doc-view').hidden = true;
    $('#text').hidden = false;
    updateViewButton(false);
  }
}

function closeBook() {
  docView?.destroy();
  docView = null;
  player.stop();
  saveProgress(true);
  book = null;
  $('#reader-view').hidden = true;
  $('#library-view').hidden = false;
  document.title = 'Narratore · audiolibri dai tuoi file';
  renderLibrary();
}

let renderedChapter = -1;
function renderChapter(index) {
  const chapter = book.chapters[index];
  const root = $('#text');
  const frag = document.createDocumentFragment();
  for (const para of chapter.paragraphs) {
    const el = document.createElement(para.heading ? 'h2' : 'p');
    para.sentences.forEach((si, k) => {
      const span = document.createElement('span');
      span.className = 's';
      span.dataset.i = si;
      span.textContent = chapter.sentences[si].text;
      el.appendChild(span);
      if (k < para.sentences.length - 1) el.appendChild(document.createTextNode(' '));
    });
    frag.appendChild(el);
  }
  const end = document.createElement('div');
  end.className = 'chapter-end';
  if (index + 1 < book.chapters.length) {
    end.innerHTML = '<div>Fine del capitolo</div><button class="btn secondary">Capitolo successivo</button>';
    end.querySelector('button').onclick = () => player.seek(index + 1, 0);
  } else {
    end.textContent = 'Fine del libro';
  }
  frag.appendChild(end);
  root.replaceChildren(frag);
  root.scrollTop = 0;
  renderedChapter = index;
  $('#chapter-title').textContent = chapter.title;
  $('#seek').max = Math.max(0, chapter.sentences.length - 1);
  markBookmarks();
}

function markBookmarks() {
  document.querySelectorAll('.s.marked').forEach((el) => el.classList.remove('marked'));
  marks.filter((m) => m.chapter === renderedChapter).forEach((m) => {
    document.querySelector(`.s[data-i="${m.sentence}"]`)?.classList.add('marked');
  });
}

function scrollToActive(behavior = 'smooth') {
  const el = activeTarget();
  if (!el) return;
  const root = scroller();
  const r = el.getBoundingClientRect();
  const rr = root.getBoundingClientRect();
  const target = root.scrollTop + r.top - rr.top - rr.height * 0.32;
  root.scrollTo({ top: Math.max(0, target), behavior });
  $('#follow-btn').hidden = true;
}

function isActiveVisible() {
  const el = activeTarget();
  if (!el) return true;
  const r = el.getBoundingClientRect();
  const rr = scroller().getBoundingClientRect();
  return r.bottom > rr.top && r.top < rr.bottom;
}

function updatePosition() {
  if (!book) return;
  const { chapter, sentence } = player;
  if (chapter !== renderedChapter) renderChapter(chapter);
  const prev = document.querySelector('.s.active');
  prev?.classList.remove('active');
  document.querySelectorAll('#text .s').forEach((el) => {
    el.classList.toggle('read', +el.dataset.i < sentence);
  });
  document.querySelector(`.s[data-i="${sentence}"]`)?.classList.add('active');
  if (docView) docMark = docView.highlight(chapter, sentence);

  const ch = book.chapters[chapter];
  $('#seek').value = sentence;
  const pct = Math.round(((globalIndex(book, chapter, sentence)) / Math.max(1, totalSentences(book) - 1)) * 100);
  if (player.state !== 'loading' || !$('#pos-label').textContent.startsWith('Scarico')) {
    $('#pos-label').textContent = `Cap. ${chapter + 1} di ${book.chapters.length} · ${pct}%`;
  }
  const leftChapter = ch.sentences.slice(sentence).reduce((n, s) => n + s.text.length, 0) / CHARS_PER_MINUTE / player.rate;
  const leftBook = remainingChars(book, chapter, sentence) / CHARS_PER_MINUTE / player.rate;
  $('#remaining-label').textContent = `capitolo ${fmtShort(leftChapter)} · libro ${fmtShort(leftBook)}`;
  $('#remaining-label').title = `Mancano ${fmtDuration(leftChapter)} alla fine del capitolo e ${fmtDuration(leftBook)} alla fine del libro`;

  if (settings.follow && Date.now() > followPausedUntil) scrollToActive();
  else if (!isActiveVisible()) $('#follow-btn').hidden = false;

  updateMediaSession();
  saveProgress();
}

let saveTimer = null;
function saveProgress(now = false) {
  if (!book) return;
  const { chapter, sentence } = player;
  const data = { chapter, sentence, percent: globalIndex(book, chapter, sentence) / Math.max(1, totalSentences(book) - 1) };
  const id = book.id;
  clearTimeout(saveTimer);
  if (now) progress.set(id, data);
  else saveTimer = setTimeout(() => progress.set(id, data), 800);
}

function updatePlayButton() {
  const btn = $('#play-btn');
  const playing = player.state === 'playing' || player.state === 'loading';
  btn.querySelector('use').setAttribute('href', playing ? '#i-pause' : '#i-play');
  btn.setAttribute('aria-label', playing ? 'Pausa' : 'Leggi');
  btn.classList.toggle('loading', player.state === 'loading');
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
  if (player.state !== 'loading') updatePosition();
}

async function togglePlay() {
  if (player.state === 'playing' || player.state === 'loading') {
    player.pause();
    return;
  }
  if (!(await ensurePiperConsent())) {
    openSettings();
    return;
  }
  player.play();
}

// ------------------------------------------------------------------ media session (schermata di blocco, cuffie)

function updateMediaSession() {
  if (!('mediaSession' in navigator) || !book) return;
  const chapter = book.chapters[player.chapter];
  navigator.mediaSession.metadata = new MediaMetadata({
    title: chapter.title,
    artist: book.author || 'Narratore',
    album: book.title,
    artwork: [{ src: new URL('icon-512.png', document.baseURI).href, sizes: '512x512', type: 'image/png' }],
  });
}

if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  const set = (action, fn) => { try { ms.setActionHandler(action, fn); } catch { /* azione non supportata */ } };
  set('play', () => player.play());
  set('pause', () => player.pause());
  set('stop', () => player.pause());
  set('nexttrack', () => player.nextChapter());
  set('previoustrack', () => player.prevChapter());
  set('seekforward', () => player.nextSentence());
  set('seekbackward', () => player.prevSentence());
}

// ------------------------------------------------------------------ indice e segnalibri

function openToc() {
  const list = $('#toc-list');
  list.innerHTML = '';
  book.chapters.forEach((c, i) => {
    const li = document.createElement('li');
    if (i === player.chapter) li.className = 'current';
    const chars = c.sentences.reduce((n, s) => n + s.text.length, 0);
    li.innerHTML = '<button><span class="num"></span><span class="t"></span><span class="d"></span></button>';
    li.querySelector('.num').textContent = i + 1;
    li.querySelector('.t').textContent = c.title;
    li.querySelector('.d').textContent = fmtDuration(chars / CHARS_PER_MINUTE / player.rate);
    li.querySelector('button').onclick = () => {
      $('#toc-dialog').close();
      player.seek(i, 0);
      followPausedUntil = 0;
    };
    list.appendChild(li);
  });
  $('#toc-dialog').showModal();
  list.querySelector('.current')?.scrollIntoView({ block: 'center' });
}

async function addBookmark() {
  const s = player.current;
  if (!s) return;
  if (marks.some((m) => m.chapter === player.chapter && m.sentence === player.sentence)) {
    toast('Questo punto è già tra i segnalibri.');
    return;
  }
  await bookmarks.add({ bookId: book.id, chapter: player.chapter, sentence: player.sentence, text: s.text.slice(0, 160) });
  marks = await bookmarks.list(book.id);
  markBookmarks();
  toast('Segnalibro aggiunto');
}

function openBookmarks() {
  const list = $('#bookmark-list');
  list.innerHTML = '';
  $('#no-bookmarks').hidden = marks.length > 0;
  [...marks].sort((a, b) => a.chapter - b.chapter || a.sentence - b.sentence).forEach((m) => {
    const li = document.createElement('li');
    li.innerHTML = `<button><span class="bm-ch"></span><span class="bm-text"></span></button>
      <button class="icon-btn" aria-label="Elimina segnalibro"><svg><use href="#i-trash"/></svg></button>`;
    const date = new Date(m.createdAt).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
    li.querySelector('.bm-ch').textContent = `${book.chapters[m.chapter]?.title || `Capitolo ${m.chapter + 1}`} · ${date}`;
    li.querySelector('.bm-text').textContent = m.text;
    li.querySelector('button').onclick = () => {
      $('#bookmarks-dialog').close();
      player.seek(m.chapter, m.sentence);
      followPausedUntil = 0;
    };
    li.querySelector('.icon-btn').onclick = async () => {
      await bookmarks.remove(m.id);
      marks = await bookmarks.list(book.id);
      markBookmarks();
      openBookmarks();
    };
    list.appendChild(li);
  });
  if (!$('#bookmarks-dialog').open) $('#bookmarks-dialog').showModal();
}

// ------------------------------------------------------------------ velocità e timer

function setRate(rate) {
  rate = Math.round(rate * 100) / 100;
  settings.rate = rate;
  persist();
  player.setRate(rate);
  $('#speed-btn').textContent = fmtRate(rate);
  $('#speed-value').textContent = fmtRate(rate);
  $('#speed-range').value = rate;
  document.querySelectorAll('#speed-presets button').forEach((b) => b.classList.toggle('on', +b.dataset.rate === rate));
  if (book) updatePosition();
}

timer.addEventListener('change', ({ detail }) => {
  const btn = $('#timer-btn');
  btn.classList.toggle('on', !!detail.mode);
  const label = detail.mode === 'chapter' ? 'Fine cap.' : detail.mode === 'time'
    ? `${Math.floor(detail.remainingMs / 60000)}:${String(Math.floor((detail.remainingMs % 60000) / 1000)).padStart(2, '0')}`
    : 'Timer';
  $('#timer-label').textContent = label;
  $('#timer-active').hidden = !detail.mode;
  $('#timer-remaining').textContent = detail.mode === 'chapter' ? 'Si ferma a fine capitolo' : `Si ferma tra ${label}`;
});
timer.addEventListener('finished', () => toast('Buonanotte! Lettura in pausa: riprendi quando vuoi.', 5000));

// ------------------------------------------------------------------ impostazioni

async function openSettings() {
  renderEngines();
  await renderVoiceControls();
  $('#pace-select').value = settings.pace;
  $('#announce-toggle').checked = settings.announceChapters;
  $('#dialogue-toggle').checked = settings.dialogueVoiceEnabled;
  $('#font-range').value = settings.fontSize;
  $('#theme-select').value = settings.theme;
  $('#follow-toggle').checked = settings.follow;
  if (!$('#settings-dialog').open) $('#settings-dialog').showModal();
}

function renderEngines() {
  const list = $('#engine-list');
  list.innerHTML = '';
  for (const id of ENGINE_ORDER) {
    if (id === 'device' && !webSpeechSupported()) continue;
    const info = ENGINE_INFO[id];
    const label = document.createElement('label');
    label.className = 'engine';
    label.innerHTML = `<input type="radio" name="engine" /><div><strong></strong></div><p></p>`;
    const input = label.querySelector('input');
    input.value = id;
    input.checked = settings.engine === id;
    label.querySelector('strong').textContent = info.title;
    for (const [t, cls] of info.tags) {
      const tag = document.createElement('span');
      tag.className = `tag ${cls || ''}`;
      tag.textContent = t;
      label.querySelector('div').appendChild(tag);
    }
    if (info.key && settings.keys[info.key]) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = 'Chiave salvata';
      label.querySelector('div').appendChild(tag);
    }
    label.querySelector('p').textContent = info.text;
    input.addEventListener('change', () => selectEngine(id));
    list.appendChild(label);
  }
}

async function selectEngine(id) {
  settings.engine = id;
  persist();
  player.setEngine(currentEngine());
  await renderVoiceControls();
  refreshVoiceLabel();
}

function fillVoiceSelect(select, voices, selected) {
  select.innerHTML = '';
  for (const v of voices) {
    const opt = document.createElement('option');
    opt.value = v.id;
    opt.textContent = v.badge && v.badge !== 'Standard' ? `${v.label} · ${v.badge}` : v.label;
    if (v.id === selected) opt.selected = true;
    select.appendChild(opt);
  }
}

async function renderVoiceControls() {
  const engine = currentEngine();
  const info = ENGINE_INFO[engine.id];
  $('#key-section').hidden = !info.key;
  if (info.key) {
    $('#key-title').textContent = `Chiave API ${info.title}`;
    $('#key-hint').textContent = info.keyHint;
    $('#api-key').value = settings.keys[info.key] || '';
  }
  const models = { elevenlabs: [ELEVEN_MODELS, 'elevenModel'], gemini: [GEMINI_MODELS, 'geminiModel'] }[engine.id];
  $('#eleven-model-field').hidden = !models;
  if (models) {
    const sel = $('#eleven-model');
    sel.innerHTML = models[0].map(([id, label]) => `<option value="${id}">${label}</option>`).join('');
    sel.value = settings[models[1]] || models[0][0][0];
  }

  let voices = [];
  try {
    voices = await engine.voices();
  } catch (err) {
    toast(err.message, 6000);
  }
  const voiceSel = $('#voice-select');
  const dlgSel = $('#dialogue-voice-select');
  if (!voices.length) {
    voiceSel.innerHTML = `<option>${info.key && !settings.keys[info.key] ? 'Inserisci prima la chiave API' : 'Nessuna voce italiana trovata'}</option>`;
    dlgSel.innerHTML = voiceSel.innerHTML;
    $('#voice-hint').textContent = '';
    return;
  }
  const selected = settings.voices[engine.id] && voices.some((v) => v.id === settings.voices[engine.id])
    ? settings.voices[engine.id]
    : engine.bestVoiceId?.() || voices[0].id;
  fillVoiceSelect(voiceSel, voices, selected);
  const dialogueDefault = settings.dialogueVoices[engine.id] || voices.find((v) => v.id !== selected)?.id || selected;
  fillVoiceSelect(dlgSel, voices, dialogueDefault);
  $('#voice-hint').textContent = voices.find((v) => v.id === selected)?.hint || '';
  $('#dialogue-row').hidden = !settings.dialogueVoiceEnabled;
}

async function testVoice(dialogue = false) {
  const engine = currentEngine();
  const voice = dialogue ? $('#dialogue-voice-select').value : $('#voice-select').value;
  const sample = dialogue
    ? '«Non posso crederci!» esclamò lei. «Sei davvero tornato, dopo tutti questi anni?»'
    : 'C\'era una volta, in un piccolo borgo tra le colline toscane, una biblioteca che di notte prendeva vita.';
  try {
    if (engine.id === 'piper' && !(await ensurePiperConsent())) return;
    toast('Preparo un\'anteprima della voce…', 2000);
    await engine.prepare(voice);
    const text = normalizeForSpeech(sample);
    if (engine.kind === 'speech') {
      engine.stop();
      await engine.speak(text, { voice, rate: settings.rate, dialogue });
    } else {
      const blob = await engine.synthesize(text, { voice, dialogue, mood: dialogue ? 'question' : 'statement' });
      const audio = new Audio(URL.createObjectURL(blob));
      audio.playbackRate = settings.rate;
      await audio.play();
    }
  } catch (err) {
    toast(err.message, 6000);
  }
}

// ------------------------------------------------------------------ eventi

player.addEventListener('position', updatePosition);
player.addEventListener('state', updatePlayButton);
player.addEventListener('error', ({ detail }) => toast(detail.message, 7000));
player.addEventListener('bookend', () => toast('Fine del libro. Grazie per l\'ascolto!', 5000));

document.addEventListener('click', (e) => {
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (e.target.closest('[data-close]')) e.target.closest('dialog').close();
  if (!action) return;
  const actions = {
    'open-settings': openSettings,
    'open-voice': openSettings,
    'close-book': () => history.back(),
    'open-toc': openToc,
    'toggle-view': () => {
      settings.viewMode = docView ? 'text' : 'original';
      persist();
      showOriginal(settings.viewMode === 'original');
    },
    'open-bookmarks': openBookmarks,
    toggle: togglePlay,
    'prev-chapter': () => { followPausedUntil = 0; player.prevChapter(); },
    'next-chapter': () => { followPausedUntil = 0; player.nextChapter(); },
    'prev-sentence': () => { followPausedUntil = 0; player.prevSentence(); },
    'next-sentence': () => { followPausedUntil = 0; player.nextSentence(); },
    'open-speed': () => $('#speed-dialog').showModal(),
    'open-timer': () => $('#timer-dialog').showModal(),
    'add-bookmark': addBookmark,
    'timer-extend': () => timer.extend(5),
    'timer-cancel': () => timer.cancel(),
    'test-voice': () => testVoice(false),
    'test-dialogue': () => testVoice(true),
    'save-key': async () => {
      const info = ENGINE_INFO[settings.engine];
      settings.keys[info.key] = $('#api-key').value.trim();
      persist();
      currentEngine().resetVoices?.();
      toast(settings.keys[info.key] ? 'Chiave salvata su questo dispositivo' : 'Chiave rimossa');
      renderEngines();
      await renderVoiceControls();
      refreshVoiceLabel();
    },
    'clear-piper': async () => {
      if (!(await confirmDialog('Eliminare le voci scaricate?', 'Lo spazio verrà liberato. Se userai di nuovo la voce neurale gratuita verrà riscaricata.', 'Elimina'))) return;
      player.pause();
      await engines.piper.clearCache();
      settings.piperConsent = false;
      persist();
      toast('Voci neurali eliminate');
    },
  };
  actions[action]?.();
});

$('#text').addEventListener('click', (e) => {
  const span = e.target.closest('.s');
  if (!span || window.getSelection()?.toString()) return;
  followPausedUntil = 0;
  player.seek(renderedChapter, +span.dataset.i);
  if (player.state !== 'playing' && player.state !== 'loading') togglePlay();
});

// se l'utente scorre il testo, sospendiamo l'auto-scorrimento per qualche secondo
for (const el of [$('#text'), $('#doc-view')]) {
  ['wheel', 'touchmove'].forEach((ev) => el.addEventListener(ev, () => {
    followPausedUntil = Date.now() + 6000;
  }, { passive: true }));
  el.addEventListener('scroll', () => {
    if (Date.now() < followPausedUntil) $('#follow-btn').hidden = isActiveVisible();
  }, { passive: true });
}
$('#follow-btn').addEventListener('click', () => { followPausedUntil = 0; scrollToActive(); });

$('#seek').addEventListener('input', (e) => {
  followPausedUntil = 0;
  player.seek(player.chapter, +e.target.value);
});

$('#speed-range').addEventListener('input', (e) => setRate(+e.target.value));
$('#speed-presets').addEventListener('click', (e) => { if (e.target.dataset.rate) setRate(+e.target.dataset.rate); });
$('#timer-options').addEventListener('click', (e) => {
  const v = e.target.dataset.min;
  if (!v) return;
  if (v === 'chapter') timer.untilChapterEnd();
  else timer.start(+v);
  $('#timer-dialog').close();
  toast(v === 'chapter' ? 'La lettura si fermerà a fine capitolo' : `Timer impostato: ${v} minuti`);
});

$('#voice-select').addEventListener('change', (e) => {
  settings.voices[settings.engine] = e.target.value;
  persist();
  player.clearCache();
  refreshVoiceLabel();
  renderVoiceControls();
  if (settings.engine === 'piper') {
    settings.piperConsent = false; // ogni voce neurale ha il suo download
    persist();
  }
});
$('#dialogue-voice-select').addEventListener('change', (e) => {
  settings.dialogueVoices[settings.engine] = e.target.value;
  persist();
  player.clearCache();
});
$('#dialogue-toggle').addEventListener('change', (e) => {
  settings.dialogueVoiceEnabled = e.target.checked;
  if (e.target.checked && !settings.dialogueVoices[settings.engine]) {
    settings.dialogueVoices[settings.engine] = $('#dialogue-voice-select').value;
  }
  persist();
  player.clearCache();
  $('#dialogue-row').hidden = !e.target.checked;
  if (e.target.checked && settings.engine === 'piper') toast('Con la voce gratuita offline la seconda voce richiede un secondo download.', 5000);
});
$('#eleven-model').addEventListener('change', (e) => {
  settings[settings.engine === 'gemini' ? 'geminiModel' : 'elevenModel'] = e.target.value;
  engines.gemini.resetModel();
  persist();
  player.clearCache();
});
$('#pace-select').addEventListener('change', (e) => { settings.pace = e.target.value; persist(); });
$('#announce-toggle').addEventListener('change', (e) => { settings.announceChapters = e.target.checked; persist(); });
$('#follow-toggle').addEventListener('change', (e) => { settings.follow = e.target.checked; persist(); });
$('#font-range').addEventListener('input', (e) => { settings.fontSize = +e.target.value; persist(); applyAppearance(); });
$('#theme-select').addEventListener('change', (e) => { settings.theme = e.target.value; persist(); applyAppearance(); });

// i dialoghi si chiudono toccando lo sfondo
document.querySelectorAll('dialog').forEach((dlg) => {
  dlg.addEventListener('click', (e) => { if (e.target === dlg && dlg.id !== 'confirm-dialog') dlg.close(); });
});

// apertura file: selettore e trascinamento
$('#file-input').addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (file) importFile(file);
});
const dz = $('#dropzone');
['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, () => dz.classList.remove('drag')));
dz.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (file) importFile(file);
});
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (file && !$('#library-view').hidden && !dz.contains(e.target)) importFile(file);
});

// scorciatoie da tastiera
document.addEventListener('keydown', (e) => {
  if (!book || $('#reader-view').hidden || document.querySelector('dialog[open]')) return;
  if (/input|select|textarea/i.test(e.target.tagName)) return;
  const keys = {
    ' ': togglePlay,
    k: togglePlay,
    ArrowRight: () => (e.shiftKey ? player.nextChapter() : player.nextSentence()),
    ArrowLeft: () => (e.shiftKey ? player.prevChapter() : player.prevSentence()),
    b: addBookmark,
    '+': () => setRate(Math.min(2, settings.rate + 0.05)),
    '-': () => setRate(Math.max(0.5, settings.rate - 0.05)),
  };
  const fn = keys[e.key];
  if (fn) {
    e.preventDefault();
    followPausedUntil = 0;
    fn();
  }
});

window.addEventListener('popstate', () => { if (book) closeBook(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) saveProgress(true); });
window.addEventListener('pagehide', () => saveProgress(true));

// ------------------------------------------------------------------ avvio

async function start() {
  if (LIMITED) {
    $('#limited-note').hidden = false;
    $('[data-action="clear-piper"]').hidden = true;
  }
  applyAppearance();
  setRate(settings.rate);
  await chooseDefaultEngine();
  player.setEngine(currentEngine());
  refreshVoiceLabel();
  try {
    await renderLibrary();
  } catch (err) {
    toast(err.message || 'Non riesco ad aprire la libreria salvata.', 8000);
  }
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  // file condivisi verso l'app installata (File Handling API)
  if ('launchQueue' in window) {
    window.launchQueue.setConsumer(async (params) => {
      const handle = params.files?.[0];
      if (handle) importFile(await handle.getFile());
    });
  }
}

start();

// esposto per i test automatici
window.__narratore = { player, settings, engines, timer, get docView() { return docView; } };
