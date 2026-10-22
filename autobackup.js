// Automatic backup files in a folder the user picks (File System Access API). The folder handle and
// the on/off flag live in IndexedDB, never in the training data, so they are not part of backups.
export const LATEST_NAME = 'gym-tracker-auto-uusin.json';
export const KEEP_DAYS = 14;
const DAILY = /^gym-tracker-auto-\d{4}-\d{2}-\d{2}\.json$/;
const DB = 'gym-tracker-autobackup';
const STORE = 'config';
const KEY = 'folder';

export const dailyName = (dateKey) => `gym-tracker-auto-${dateKey}.json`;
export const isDailyName = (name) => DAILY.test(name);
export const supported = () => typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function' && typeof indexedDB !== 'undefined';

// Names of daily copies beyond the newest `keep`. Only our own file names are ever returned.
export function staleDailyNames(names, keep = KEEP_DAYS) {
  return names.filter(isDailyName).sort().reverse().slice(keep);
}

function open() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function run(mode, work) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = work(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
export const loadConfig = () => run('readonly', (store) => store.get(KEY)).then((value) => value ?? null).catch(() => null);
export const saveConfig = (config) => run('readwrite', (store) => store.put(config, KEY));
export const clearConfig = () => run('readwrite', (store) => store.delete(KEY));

export const pickFolder = () => window.showDirectoryPicker({ id: 'gym-tracker-backups', mode: 'readwrite', startIn: 'documents' });

// Never throws: an unreadable handle simply reports as denied.
export async function permission(handle, request = false) {
  const options = { mode: 'readwrite' };
  try {
    let state = await handle.queryPermission(options);
    if (state !== 'granted' && request) state = await handle.requestPermission(options);
    return state;
  } catch { return 'denied'; }
}

async function writeFile(dir, name, text) {
  const file = await dir.getFileHandle(name, { create: true });
  const writable = await file.createWritable();
  await writable.write(text);
  await writable.close();
}
const readFile = async (dir, name) => (await (await dir.getFileHandle(name)).getFile()).text();

// The latest copy is replaced each time; a day's copy is written once and never overwritten, so a bad
// restore later the same day cannot destroy it. Old copies are pruned only after a verified write.
export async function writeBackup(dir, text, dateKey, verify) {
  await writeFile(dir, LATEST_NAME, text);
  if (!verify(await readFile(dir, LATEST_NAME))) throw new Error('Backup verification failed');
  const daily = dailyName(dateKey);
  let exists = true;
  try { await dir.getFileHandle(daily); } catch (error) { if (error?.name !== 'NotFoundError') throw error; exists = false; }
  if (!exists) {
    await writeFile(dir, daily, text);
    if (!verify(await readFile(dir, daily))) throw new Error('Backup verification failed');
  }
  const names = [];
  for await (const [name, entry] of dir.entries()) if (entry.kind === 'file' && isDailyName(name)) names.push(name);
  for (const name of staleDailyNames(names)) await dir.removeEntry(name);
}
