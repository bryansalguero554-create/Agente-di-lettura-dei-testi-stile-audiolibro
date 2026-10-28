// Test end-to-end nel browser: importazione di PDF e Word, lettura con voce simulata,
// evidenziazione, velocità, segnalibri, timer, ripresa della posizione, motore premium.
// Uso: npm run build && npm run test:e2e
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeDocx } from '../fixtures/make-docx.js';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch {
  playwright = require(join(execSync('npm root -g').toString().trim(), 'playwright'));
}
const { chromium } = playwright;

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = join(root, 'test-results');
mkdirSync(out, { recursive: true });

let failures = 0;
let passed = 0;
async function step(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.log(`  ✗ ${name}\n      ${err.message.split('\n').join('\n      ')}`);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

// --- voce di sistema simulata: registra cosa viene detto e con quali parametri
const speechMock = () => {
  const spoken = [];
  window.__spoken = spoken;
  const voices = [
    { name: 'Alice', lang: 'it-IT', voiceURI: 'com.apple.speech.synthesis.voice.alice', localService: true },
    { name: 'Google italiano', lang: 'it-IT', voiceURI: 'Google italiano', localService: false },
    { name: 'Microsoft Isabella Online (Natural) - Italian (Italy)', lang: 'it-IT', voiceURI: 'Microsoft Isabella Online (Natural) - Italian (Italy)', localService: false },
    { name: 'Microsoft Diego Online (Natural) - Italian (Italy)', lang: 'it-IT', voiceURI: 'Microsoft Diego Online (Natural) - Italian (Italy)', localService: false },
    { name: 'Samantha', lang: 'en-US', voiceURI: 'samantha', localService: true },
  ];
  let current = null;
  let timer = null;
  const synth = {
    paused: false,
    speaking: false,
    getVoices: () => voices,
    addEventListener() {},
    speak(u) {
      current = u;
      spoken.push({ text: u.text, voice: u.voice?.name, rate: u.rate, pitch: u.pitch, volume: u.volume });
      this.speaking = true;
      timer = setTimeout(() => { this.speaking = false; current = null; u.onend?.({}); }, 40);
    },
    cancel() {
      clearTimeout(timer);
      if (current) { const u = current; current = null; u.onerror?.({ error: 'interrupted' }); }
      this.speaking = false;
    },
    pause() {}, resume() {},
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth });
  window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
};

function silentWav(seconds = 0.15) {
  const rate = 8000; const n = Math.floor(rate * seconds);
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  return b;
}

async function main() {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

  // fixture PDF generato da Chromium (con indice e numeri di pagina)
  const pdfPath = join(out, 'la-casa-sul-lago.pdf');
  {
    const page = await browser.newPage();
    await page.setContent(readFileSync(join(root, 'tests/fixtures/book.html'), 'utf8'));
    await page.pdf({
      path: pdfPath, format: 'A5', outline: true, tagged: true,
      margin: { top: '50px', bottom: '60px', left: '50px', right: '50px' },
      displayHeaderFooter: true,
      headerTemplate: '<div style="font-size:8px;width:100%;text-align:center">La casa sul lago</div>',
      footerTemplate: '<div style="font-size:9px;width:100%;text-align:center"><span class="pageNumber"></span></div>',
    });
    await page.close();
  }
  // stesso libro senza indice: i capitoli vanno riconosciuti dalla dimensione del carattere
  const pdfNoOutline = join(out, 'senza-indice.pdf');
  {
    const page = await browser.newPage();
    await page.setContent(readFileSync(join(root, 'tests/fixtures/book.html'), 'utf8'));
    await page.pdf({ path: pdfNoOutline, format: 'A5', outline: false, margin: { top: '40px', bottom: '40px', left: '40px', right: '40px' } });
    await page.close();
  }
  const docxPath = join(out, 'il-faro.docx');
  writeFileSync(docxPath, await makeDocx());

  const server = spawn('npx', ['vite', 'preview', '--port', '4317', '--strictPort'], { cwd: root, stdio: 'pipe' });
  await new Promise((resolve, reject) => {
    server.stdout.on('data', (d) => d.toString().includes('4317') && resolve());
    server.on('exit', () => reject(new Error('vite preview non è partito')));
    setTimeout(() => reject(new Error('timeout avvio server')), 20000);
  });
  const url = 'http://localhost:4317/';

  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await context.addInitScript(speechMock);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  console.log('\nLibreria');
  await page.goto(url);
  await step('mostra la libreria vuota', async () => {
    await page.getByText('Apri un file da ascoltare').waitFor();
    assert(await page.locator('#empty-library').isVisible(), 'messaggio libreria vuota assente');
  });
  await page.screenshot({ path: join(out, '01-libreria.png') });

  await step('sceglie automaticamente la voce più naturale del dispositivo', async () => {
    const s = await page.evaluate(() => window.__narratore.settings.engine);
    assert(s === 'device', `motore iniziale: ${s}`);
  });

  console.log('\nPDF');
  await page.setInputFiles('#file-input', pdfPath);
  await page.locator('#reader-view').waitFor({ state: 'visible' });
  await step('importa il PDF e riconosce i capitoli dall\'indice', async () => {
    const book = await page.evaluate(() => window.__narratore.player.book);
    const titles = book.chapters.map((c) => c.title);
    assert(titles.length === 3, `capitoli trovati: ${JSON.stringify(titles)}`);
    assert(titles[0].startsWith('Capitolo primo') && titles[2].startsWith('Capitolo terzo'), JSON.stringify(titles));
  });
  await step('il testo del PDF è pulito (niente intestazioni né numeri di pagina)', async () => {
    const text = await page.locator('#text').innerText();
    assert(!/La casa sul lago/.test(text), 'intestazione ripetuta rimasta nel testo');
    assert(!/^\s*\d+\s*$/m.test(text), 'numero di pagina rimasto nel testo');
    assert(text.includes('i tergicristalli disegnavano archi regolari nel buio.'), 'frase spezzata male:\n' + text.slice(0, 400));
  });
  await step('mostra le pagine originali del PDF', async () => {
    await page.locator('.pdf-page canvas').first().waitFor();
    await page.waitForFunction(() => window.__narratore.docView?.ranges?.length > 0, null, { timeout: 15000 });
    const pages = await page.locator('.pdf-page').count();
    assert(pages >= 3, `pagine: ${pages}`);
    const coverage = await page.evaluate(() => {
      const r = window.__narratore.docView.ranges.flat();
      return r.filter(Boolean).length / r.length;
    });
    assert(coverage > 0.9, `frasi ritrovate nel PDF: ${Math.round(coverage * 100)}%`);
  });
  await page.screenshot({ path: join(out, '02-lettore.png') });

  await step('legge con la voce Natural, normalizza ed evidenzia la frase', async () => {
    await page.click('#play-btn');
    await page.waitForFunction(() => window.__spoken.length >= 4, null, { timeout: 15000 });
    const spoken = await page.evaluate(() => window.__spoken);
    assert(spoken[0].voice.includes('Isabella'), `voce usata: ${spoken[0].voice}`);
    assert(spoken[0].text === 'Capitolo primo.', `prima frase: ${spoken[0].text}`);
    assert(spoken[1].text.startsWith('Nel millenovecentottantaquattro la famiglia'), `numero non normalizzato: ${spoken[1].text}`);
    assert(spoken.some((s) => s.text.includes('Il Dottor Rossi')), 'abbreviazione non espansa');
    const active = await page.locator('.s.active').innerText();
    const last = spoken[spoken.length - 1].text;
    assert(active.length > 0, 'nessuna frase evidenziata');
    const read = await page.locator('.s.read').count();
    assert(read >= 2, `frasi già lette non marcate: ${read} (ultima detta: ${last})`);
    const marks = await page.locator('.pdf-overlay .doc-mark').count();
    assert(marks > 0, 'nessuna evidenziazione sulla pagina del PDF');
  });
  await page.screenshot({ path: join(out, '03b-pdf-evidenziato.png') });
  await step('i dialoghi hanno un\'intonazione diversa', async () => {
    await page.waitForFunction(() => window.__spoken.some((s) => s.text.startsWith('"Quasi"')), null, { timeout: 15000 });
    const spoken = await page.evaluate(() => window.__spoken);
    const narr = spoken.find((s) => s.text.startsWith('Dentro'));
    const dial = spoken.find((s) => s.text.startsWith('"Siamo arrivati?"'));
    assert(dial && dial.pitch > 1, `pitch dialogo: ${dial?.pitch}`);
    assert(!narr || narr.pitch === 1, 'pitch narrazione');
  });
  await page.screenshot({ path: join(out, '03-in-lettura.png') });

  await step('cambia velocità a 1,5×', async () => {
    await page.click('#speed-btn');
    await page.click('#speed-presets button[data-rate="1.5"]');
    await page.keyboard.press('Escape');
    const n = await page.evaluate(() => window.__spoken.length);
    await page.waitForFunction((k) => window.__spoken.length > k, n, { timeout: 15000 });
    const last = await page.evaluate(() => window.__spoken.at(-1));
    assert(Math.abs(last.rate - 1.5) < 0.2, `rate: ${last.rate}`);
    assert((await page.locator('#speed-btn').innerText()) === '1,5×', 'etichetta velocità');
  });

  await step('aggiunge e mostra un segnalibro', async () => {
    await page.click('[data-action="add-bookmark"]');
    await page.getByText('Segnalibro aggiunto').waitFor();
    await page.click('[aria-label="Segnalibri"]');
    assert((await page.locator('#bookmark-list li').count()) === 1, 'segnalibro non in elenco');
    await page.keyboard.press('Escape');
  });

  await step('il timer "fine capitolo" mette in pausa alla fine del capitolo', async () => {
    await page.evaluate(() => window.__narratore.player.seek(0, 2));
    await page.click('#timer-btn');
    await page.click('#timer-options button[data-min="chapter"]');
    await page.waitForFunction(() => window.__narratore.player.state === 'paused', null, { timeout: 30000 });
    const pos = await page.evaluate(() => [window.__narratore.player.chapter, window.__narratore.player.sentence]);
    assert(pos[0] === 1 && pos[1] === 0, `posizione dopo il timer: ${pos}`);
    const spoken = await page.evaluate(() => window.__spoken.map((s) => s.text));
    assert(!spoken.includes('Capitolo secondo.'), 'ha continuato nel capitolo successivo');
  });

  await step('si passa al testo semplice e ritorno', async () => {
    await page.click('#view-btn');
    await page.locator('#text').waitFor({ state: 'visible' });
    assert(await page.locator('#doc-view').isHidden(), 'vista originale ancora visibile');
  });
  await step('il clic su una frase fa partire la lettura da lì', async () => {
    const before = await page.evaluate(() => window.__spoken.length);
    await page.locator('.s', { hasText: 'Lucia annuì.' }).click();
    await page.waitForFunction((n) => window.__spoken.length > n, before, { timeout: 10000 }).catch(() => {});
    const first = await page.evaluate((n) => [window.__spoken[n]?.text, window.__narratore.player.state, window.__narratore.player.chapter, window.__narratore.player.sentence], before);
    assert(first[0] === 'Lucia annuì.', `prima frase letta dopo il clic: ${JSON.stringify(first)}`);
    await page.evaluate(() => window.__narratore.player.pause());
  });

  await step('indice dei capitoli e salto al capitolo', async () => {
    await page.click('[aria-label="Capitoli"]');
    assert((await page.locator('#toc-list li').count()) === 3, 'voci indice');
    await page.locator('#toc-list li').nth(2).click();
    const ch = await page.evaluate(() => window.__narratore.player.chapter);
    assert(ch === 2, `capitolo dopo il salto: ${ch}`);
    assert((await page.locator('#chapter-title').innerText()).startsWith('Capitolo terzo'), 'titolo capitolo nell\'intestazione');
  });

  await step('dopo il ricaricamento riprende dallo stesso punto', async () => {
    await page.waitForTimeout(1000);
    await page.reload();
    await page.locator('.book-card').first().waitFor();
    const meta = await page.locator('.book-card p').first().innerText();
    assert(/ascoltato/.test(meta), `progresso non mostrato: ${meta}`);
    await page.locator('.book-card').first().click();
    await page.locator('#reader-view').waitFor({ state: 'visible' });
    const pos = await page.evaluate(() => [window.__narratore.player.chapter, window.__narratore.player.sentence]);
    assert(pos[0] === 2, `posizione ripresa: ${pos}`);
    assert((await page.locator('#speed-btn').innerText()) === '1,5×', 'velocità non ricordata');
  });

  console.log('\nPDF senza indice');
  await page.goBack();
  await page.locator('#library-view').waitFor({ state: 'visible' });
  await page.setInputFiles('#file-input', pdfNoOutline);
  await page.locator('#reader-view').waitFor({ state: 'visible' });
  await step('riconosce i capitoli dai titoli in grande', async () => {
    const titles = await page.evaluate(() => window.__narratore.player.book.chapters.map((c) => c.title));
    assert(JSON.stringify(titles) === '["Capitolo primo","Capitolo secondo","Capitolo terzo"]', JSON.stringify(titles));
    const paras = await page.evaluate(() => window.__narratore.player.book.chapters[0].paragraphs.length);
    assert(paras === 5, `paragrafi nel capitolo 1: ${paras}`);
  });

  console.log('\nWord e voce per i dialoghi');
  await page.goBack();
  await page.locator('#library-view').waitFor({ state: 'visible' });
  await page.screenshot({ path: join(out, '04-libreria-piena.png') });
  await page.setInputFiles('#file-input', docxPath);
  await page.locator('#reader-view').waitFor({ state: 'visible' });
  await step('importa il DOCX con titolo e capitoli', async () => {
    assert((await page.locator('#book-title').innerText()) === 'Il faro di Levante', 'titolo docx');
    const titles = await page.evaluate(() => window.__narratore.player.book.chapters.map((c) => c.title));
    assert(JSON.stringify(titles) === '["Capitolo 1","Capitolo 2"]', JSON.stringify(titles));
  });
  await step('mostra il Word originale con la frase evidenziata', async () => {
    await page.evaluate(() => { window.__narratore.settings.viewMode = 'original'; });
    await page.click('#view-btn');
    await page.locator('.docx-page').waitFor();
    await page.evaluate(() => window.__narratore.player.seek(0, 1));
    await page.waitForFunction(() => CSS.highlights.has('reading'));
    const txt = await page.evaluate(() => [...CSS.highlights.get('reading')][0].toString());
    assert(txt.startsWith('Il Sig. Bianchi arrivò al faro'), `testo evidenziato: ${txt}`);
    assert(await page.locator('.docx-page strong').count() >= 1, 'formattazione del Word persa');
    await page.screenshot({ path: join(out, '05b-docx-evidenziato.png') });
  });
  await step('le battute vengono lette da una seconda voce', async () => {
    await page.click('[aria-label="Impostazioni"] >> nth=1');
    await page.check('#dialogue-toggle');
    await page.selectOption('#dialogue-voice-select', { label: 'Diego · Neurale' }).catch(async () => {
      const opts = await page.locator('#dialogue-voice-select option').allInnerTexts();
      const diego = opts.find((o) => o.includes('Diego'));
      await page.selectOption('#dialogue-voice-select', { label: diego });
    });
    await page.screenshot({ path: join(out, '05-impostazioni.png') });
    await page.keyboard.press('Escape');
    await page.evaluate(() => { window.__spoken.length = 0; });
    await page.click('#play-btn');
    await page.waitForFunction(() => window.__spoken.some((s) => s.text.includes('gridò il guardiano')), null, { timeout: 20000 });
    await page.click('#play-btn');
    const spoken = await page.evaluate(() => window.__spoken);
    const q = spoken.find((s) => s.text === '"Chi va là?"');
    const n = spoken.find((s) => s.text === 'gridò il guardiano.');
    assert(q?.voice?.includes('Diego'), `voce battuta: ${q?.voice} — ${JSON.stringify(spoken.map((s) => s.text))}`);
    assert(n?.voice?.includes('Isabella'), `voce narrazione: ${n?.voice}`);
    const date = spoken.find((s) => s.text.startsWith('Il Signor Bianchi'));
    assert(date?.text.includes('dodici marzo millenovecentoventiquattro alle diciotto e trenta'), `data: ${date?.text}`);
  });

  console.log('\nMotore premium (OpenAI simulato)');
  const requests = [];
  await context.route('https://api.openai.com/**', async (route) => {
    requests.push(JSON.parse(route.request().postData()));
    await route.fulfill({ status: 200, contentType: 'audio/wav', body: silentWav(), headers: { 'access-control-allow-origin': '*' } });
  });
  await step('con la chiave OpenAI legge con istruzioni da narratore italiano', async () => {
    await page.click('[aria-label="Impostazioni"] >> nth=1');
    await page.locator('.engine:has(strong:text-is("OpenAI"))').click();
    await page.fill('#api-key', 'sk-test');
    await page.click('[data-action="save-key"]');
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.__narratore.player.seek(1, 0));
    await page.click('#play-btn');
    await page.waitForFunction(() => window.__narratore.player.sentence >= 2, null, { timeout: 20000 });
    await page.click('#play-btn');
    assert(requests.length >= 3, `richieste: ${requests.length}`);
    const r = requests.find((x) => x.input.startsWith('La notte'));
    assert(r && r.model === 'gpt-4o-mini-tts' && /italian/i.test(r.instructions), JSON.stringify(r));
  });
  await step('errore chiaro se la chiave non è valida', async () => {
    await context.unroute('https://api.openai.com/**');
    await context.route('https://api.openai.com/**', (route) => route.fulfill({
      status: 401, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Incorrect API key' } }),
      headers: { 'access-control-allow-origin': '*' },
    }));
    await page.evaluate(() => window.__narratore.player.clearCache());
    await page.click('#play-btn');
    await page.locator('#toast', { hasText: 'chiave API non valida' }).waitFor({ timeout: 10000 });
  });

  console.log('\nGemini con chiave gratuita');
  await step('se Gemini non è incluso nella chiave continua con una voce gratuita', async () => {
    await context.route('https://generativelanguage.googleapis.com/**', (route) => route.fulfill({
      status: 429, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ error: { code: 429, message: 'Quota exceeded for metric: generate_content_free_tier_requests, limit: 0' } }),
    }));
    await page.click('[aria-label="Impostazioni"] >> nth=1');
    await page.locator('.engine:has(strong:text-is("Gemini"))').click();
    await page.fill('#api-key', 'chiave-gratuita');
    await page.click('[data-action="save-key"]');
    await page.keyboard.press('Escape');
    await page.evaluate(() => { window.__spoken.length = 0; window.__narratore.player.seek(0, 0); });
    await page.click('#play-btn');
    await page.locator('#toast', { hasText: 'non sono incluse nella tua chiave' }).waitFor({ timeout: 15000 });
    await page.waitForFunction(() => window.__spoken.length > 0, null, { timeout: 15000 });
    const engine = await page.evaluate(() => window.__narratore.settings.engine);
    assert(engine === 'device', `motore dopo il ripiego: ${engine}`);
    await page.evaluate(() => window.__narratore.player.pause());
  });

  console.log('\nVoci premium gratis (Puter simulato)');
  await step('legge con le voci premium gratuite senza chiavi', async () => {
    const wavB64 = silentWav(0.1).toString('base64');
    await page.evaluate((b64) => {
      window.__puterCalls = [];
      window.puter = { ai: { txt2speech: async (text, opts) => { window.__puterCalls.push({ text, opts }); return { src: `data:audio/wav;base64,${b64}` }; } } };
    }, wavB64);
    await page.click('[aria-label="Impostazioni"] >> nth=1');
    await page.locator('.engine:has(strong:text-is("Voci premium gratis"))').click();
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.__narratore.player.seek(1, 0));
    await page.click('#play-btn');
    await page.waitForFunction(() => window.__puterCalls.length >= 2, null, { timeout: 20000 });
    await page.evaluate(() => window.__narratore.player.pause());
    const calls = await page.evaluate(() => window.__puterCalls);
    assert(calls[0].opts.provider === 'openai' && calls[0].opts.voice === 'marin', JSON.stringify(calls[0].opts));
    assert(calls.some((c) => c.text.includes('La notte passò in silenzio')), JSON.stringify(calls.map((c) => c.text)));
  });

  console.log('\nVoce neurale offline (Piper)');
  await step('chiede il consenso al download e gestisce la rete non disponibile', async () => {
    await page.click('[aria-label="Impostazioni"] >> nth=1');
    await page.locator('.engine', { hasText: 'Paola' }).click();
    await page.keyboard.press('Escape');
    await page.click('#play-btn');
    await page.getByText('Scaricare la voce Paola?').waitFor();
    await page.screenshot({ path: join(out, '06-consenso-piper.png') });
    // simuliamo una rete assente verso il server dei modelli: deve comparire un errore leggibile
    await context.route('https://huggingface.co/**', (route) => route.abort('internetdisconnected'));
    await page.click('#confirm-ok');
    await page.locator('#toast', { hasText: /voce neurale|connessione/ }).waitFor({ timeout: 30000 });
    assert(await page.evaluate(() => window.__narratore.player.state) === 'paused', 'stato dopo errore');
  });

  await step('la voce neurale trasforma l\'italiano in fonemi nel browser', async () => {
    const ids = await page.evaluate(() => window.__narratore.engines.piper.phonemes('Che bella giornata, disse Lucia.'));
    assert(Array.isArray(ids) && ids.length > 20, `fonemi: ${JSON.stringify(ids)?.slice(0, 80)}`);
  });

  await step('i file WebAssembly della voce neurale sono serviti dall\'app', async () => {
    for (const f of ['vendor/ort/ort-wasm-simd-threaded.wasm', 'vendor/piper/piper_phonemize.wasm', 'vendor/piper/piper_phonemize.data', 'manifest.webmanifest', 'sw.js']) {
      const res = await page.request.get(url + f);
      assert(res.ok(), `${f}: ${res.status()}`);
    }
  });

  if (process.env.PAOLA_REALE) {
    console.log('\nPaola vera (modello scaricato)');
    const ctx2 = await browser.newContext();
    const p2 = await ctx2.newPage();
    await p2.goto(url);
    const text = 'La casa apparve all\'improvviso dietro una curva, scura e silenziosa. «Siamo arrivati?» chiese Lucia. Il padre sorrise, senza voltarsi.';
    const dir = process.env.CAMPIONI_DIR || out;
    mkdirSync(dir, { recursive: true });
    // per ogni voce: profilo naturale (nuovo) e standard (valori di fabbrica)
    for (const [voice, name, required] of [['it_IT-paola-medium', 'paola', true], ['it_IT-serena-high', 'serena', false]]) {
      await step(`${name}: voce vera, profilo naturale e standard`, async () => {
        const res = await p2.evaluate(async ({ t, v }) => {
          const { engines, settings } = window.__narratore;
          const toB64 = (blob) => new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(',')[1]); fr.readAsDataURL(blob); });
          const sentences = t.match(/[^.!?]+[.!?»]+/g).map((x) => x.trim());
          const outByProfile = {};
          for (const profile of ['naturale', 'standard']) {
            settings.piperProfile = profile;
            settings.piperStudio = false;
            const parts = [];
            let synthMs = 0;
            for (const s of sentences) {
              const t0 = performance.now();
              parts.push(await engines.piper.synthesize(s, { voice: v, mood: /\?/.test(s) ? 'question' : 'statement' }));
              synthMs += performance.now() - t0;
            }
            outByProfile[`${profile}-ms`] = Math.round(synthMs);
            // unisce le frasi con una pausa naturale di 0,45 s
            const ctx = new OfflineAudioContext(1, 1, 44100);
            const buffers = await Promise.all(parts.map(async (b) => ctx.decodeAudioData(await b.arrayBuffer())));
            const rate = buffers[0].sampleRate;
            const gap = Math.round(rate * 0.45);
            const total = buffers.reduce((n, b) => n + b.length + gap, 0);
            const pcm = new Float32Array(total);
            let o = 0;
            for (const b of buffers) { pcm.set(b.getChannelData(0), o); o += b.length + gap; }
            outByProfile[profile] = await toB64(window.__narratore.floatToWav(pcm, rate));
            outByProfile[`${profile}-audio`] = Math.round((total / rate) * 1000);
          }
          return outByProfile;
        }, { t: text, v: voice }).catch((err) => {
          if (required) throw err;
          console.log(`      (${name} non disponibile: ${String(err.message).split('\n')[0]})`);
          return null;
        });
        if (!res) return;
        // velocità: quanto tempo serve per generare un secondo di voce (sotto 1 = più veloce del parlato)
        // si misura il secondo giro ("standard"): il primo include il download del modello
        console.log(`      ${name}: generazione ${res['standard-ms']} ms per ${res['standard-audio']} ms di audio (fattore ${(res['standard-ms'] / res['standard-audio']).toFixed(2)})`);
        for (const [profile, b64] of Object.entries(res).filter(([k]) => !k.includes('-'))) {
          const buf = Buffer.from(b64, 'base64');
          assert(buf.length > 50000, `${name} ${profile}: ${buf.length} byte`);
          writeFileSync(join(dir, `${name}-${profile}.wav`), buf);
        }
      });
    }
    await ctx2.close();
  }

  console.log('\nDesktop');
  const desk = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await desk.addInitScript(speechMock);
  const dp = await desk.newPage();
  await dp.goto(url);
  await dp.setInputFiles('#file-input', pdfPath);
  await dp.locator('#reader-view').waitFor({ state: 'visible' });
  await dp.click('#play-btn');
  await dp.waitForTimeout(800);
  await dp.click('#play-btn');
  await dp.screenshot({ path: join(out, '07-desktop.png') });
  await step('tema notte', async () => {
    await dp.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await dp.screenshot({ path: join(out, '08-notte.png') });
  });

  await step('nessun errore JavaScript inatteso', async () => {
    const unexpected = errors.filter((e) => !/huggingface|Failed to fetch|ERR_|401|429|net::|voce neurale/i.test(e));
    assert(!unexpected.length, unexpected.join('\n'));
  });

  await browser.close();
  server.kill();
  console.log(`\n${passed} passati, ${failures} falliti. Screenshot in test-results/`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
