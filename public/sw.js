// Service worker: rende l'app disponibile anche offline dopo la prima visita.
const CACHE = 'narratore-v4';
// impostazioni lette dal service worker (scritte dall'app)
const FLAGS = 'narratore-flags';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      // solo le vecchie versioni dell'app: le voci scaricate e le impostazioni restano
      .then((keys) => Promise.all(keys.filter((k) => /^narratore-v\d+$/.test(k) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Con le voci offline la pagina viene "isolata" (COOP/COEP): così il motore neurale può
// usare più processori insieme. Non è sempre attivo perché impedisce i popup di accesso
// di Puter.
let isolate = null;
async function isolated() {
  if (isolate === null) {
    const hit = await (await caches.open(FLAGS)).match('coi').catch(() => null);
    isolate = (await hit?.text()) === '1';
  }
  return isolate;
}

self.addEventListener('message', (event) => {
  if (event.data?.type === 'coi') isolate = !!event.data.on;
});

async function withHeaders(res) {
  if (!res || res.type === 'opaque' || res.status === 0 || !(await isolated())) return res;
  const headers = new Headers(res.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  // i campioni audio cambiano a ogni pubblicazione: sempre dalla rete
  if (url.pathname.includes('/campioni/')) return;

  // pagina: prima la rete (aggiornamenti), poi la cache
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('./')))
        .then(withHeaders),
    );
    return;
  }

  // risorse con hash e file WebAssembly: prima la cache
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    })).then(withHeaders),
  );
});
