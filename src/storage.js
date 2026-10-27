// Libreria personale salvata nel browser (IndexedDB): libri, posizione di lettura e segnalibri.

const DB_NAME = 'narratore';
const DB_VERSION = 1;
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('books')) db.createObjectStore('books', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('progress')) db.createObjectStore('progress', { keyPath: 'bookId' });
      if (!db.objectStoreNames.contains('bookmarks')) {
        const s = db.createObjectStore('bookmarks', { keyPath: 'id', autoIncrement: true });
        s.createIndex('bookId', 'bookId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    const req = fn(s);
    if (req) req.onsuccess = () => { result = req.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Spazio di archiviazione insufficiente'));
  });
}

/** Identificativo stabile di un file: hash SHA-256 del contenuto. */
export async function fileId(arrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', arrayBuffer);
  return [...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const books = {
  put: (book) => tx('books', 'readwrite', (s) => s.put(book)),
  get: (id) => tx('books', 'readonly', (s) => s.get(id)),
  all: () => tx('books', 'readonly', (s) => s.getAll()),
  async remove(id) {
    await tx('books', 'readwrite', (s) => s.delete(id));
    await tx('progress', 'readwrite', (s) => s.delete(id));
    const marks = await bookmarks.list(id);
    await Promise.all(marks.map((m) => bookmarks.remove(m.id)));
  },
};

export const progress = {
  get: (bookId) => tx('progress', 'readonly', (s) => s.get(bookId)),
  all: () => tx('progress', 'readonly', (s) => s.getAll()),
  set: (bookId, data) => tx('progress', 'readwrite', (s) => s.put({ bookId, ...data, updatedAt: Date.now() })),
};

export const bookmarks = {
  list: (bookId) => tx('bookmarks', 'readonly', (s) => s.index('bookId').getAll(bookId)),
  add: (mark) => tx('bookmarks', 'readwrite', (s) => s.add({ ...mark, createdAt: Date.now() })),
  update: (mark) => tx('bookmarks', 'readwrite', (s) => s.put(mark)),
  remove: (id) => tx('bookmarks', 'readwrite', (s) => s.delete(id)),
};
