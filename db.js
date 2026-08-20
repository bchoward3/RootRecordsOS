// ══════════════════════════════════════════
// RootRecords — IndexedDB offline queue
// Stores records captured without connectivity
// and syncs them to Supabase when back online
// ══════════════════════════════════════════

const DB_NAME = 'rootrecords-offline';
const DB_VERSION = 1;
const STORE_QUEUE = 'sync_queue';
const STORE_MEDIA = 'media_blobs';

let db = null;

// ── Open / create database ──
function openDB() {
  return new Promise((resolve, reject) => {
    if (db) return resolve(db);
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const database = e.target.result;

      // Queue of pending record operations
      if (!database.objectStoreNames.contains(STORE_QUEUE)) {
        const store = database.createObjectStore(STORE_QUEUE, {
          keyPath: 'id',
          autoIncrement: true
        });
        store.createIndex('synced', 'synced', { unique: false });
        store.createIndex('created_at', 'created_at', { unique: false });
      }

      // Photo / audio blobs waiting to upload
      if (!database.objectStoreNames.contains(STORE_MEDIA)) {
        database.createObjectStore(STORE_MEDIA, {
          keyPath: 'id',
          autoIncrement: true
        });
      }
    };

    req.onsuccess = (e) => { db = e.target.result; resolve(db); };
    req.onerror = (e) => reject(e.target.error);
  });
}

// ── Queue a record for later sync ──
async function queueRecord(payload, photoBlob, audioBlob) {
  const database = await openDB();

  // Store media blobs separately (IndexedDB handles Blobs natively)
  let photoId = null, audioId = null;

  if (photoBlob || audioBlob) {
    const mediaTx = database.transaction(STORE_MEDIA, 'readwrite');
    const mediaStore = mediaTx.objectStore(STORE_MEDIA);
    if (photoBlob) {
      photoId = await new Promise((res, rej) => {
        const r = mediaStore.add({ blob: photoBlob, type: 'photo' });
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    }
    if (audioBlob) {
      audioId = await new Promise((res, rej) => {
        const r = mediaStore.add({ blob: audioBlob, type: 'audio' });
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    }
  }

  // Queue the record with references to media
  const tx = database.transaction(STORE_QUEUE, 'readwrite');
  const store = tx.objectStore(STORE_QUEUE);
  return new Promise((resolve, reject) => {
    const req = store.add({
      payload,
      photoId,
      audioId,
      synced: 0,
      created_at: new Date().toISOString()
    });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ── Get all unsynced records ──
async function getPendingRecords() {
  const database = await openDB();
  const tx = database.transaction(STORE_QUEUE, 'readonly');
  const store = tx.objectStore(STORE_QUEUE);
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result || []).filter(r => r.synced === 0));
    req.onerror = () => reject(req.error);
  });
}

// ── Get a media blob by id ──
async function getMediaBlob(id) {
  if (!id) return null;
  const database = await openDB();
  const tx = database.transaction(STORE_MEDIA, 'readonly');
  const store = tx.objectStore(STORE_MEDIA);
  return new Promise((resolve, reject) => {
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result?.blob || null);
    req.onerror = () => reject(req.error);
  });
}

// ── Mark record as synced and clean up ──
async function markSynced(queueId, photoId, audioId) {
  const database = await openDB();

  // Delete the queue entry
  const tx = database.transaction(STORE_QUEUE, 'readwrite');
  tx.objectStore(STORE_QUEUE).delete(queueId);

  // Delete associated media blobs
  if (photoId || audioId) {
    const mediaTx = database.transaction(STORE_MEDIA, 'readwrite');
    const mediaStore = mediaTx.objectStore(STORE_MEDIA);
    if (photoId) mediaStore.delete(photoId);
    if (audioId) mediaStore.delete(audioId);
  }
}

// ── Count pending records ──
async function getPendingCount() {
  const pending = await getPendingRecords();
  return pending.length;
}

// ── Clear all queued records (use with caution) ──
async function clearQueue() {
  const database = await openDB();
  const tx = database.transaction([STORE_QUEUE, STORE_MEDIA], 'readwrite');
  tx.objectStore(STORE_QUEUE).clear();
  tx.objectStore(STORE_MEDIA).clear();
}

// Expose globally
window.RRDb = {
  openDB,
  queueRecord,
  getPendingRecords,
  getMediaBlob,
  markSynced,
  getPendingCount,
  clearQueue
};
