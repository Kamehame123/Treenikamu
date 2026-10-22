import test from 'node:test';
import assert from 'node:assert/strict';
import { KEEP_DAYS, LATEST_NAME, dailyName, isDailyName, staleDailyNames, supported, writeBackup } from '../autobackup.js';

// Minimal in-memory directory with the parts of the File System Access API the writer uses.
function memoryDir(initial = {}) {
  const files = new Map(Object.entries(initial));
  const notFound = () => Object.assign(new Error('missing'), { name: 'NotFoundError' });
  return {
    files,
    async getFileHandle(name, { create = false } = {}) {
      if (!files.has(name) && !create) throw notFound();
      if (!files.has(name)) files.set(name, '');
      return {
        async getFile() { return { text: async () => files.get(name) }; },
        async createWritable() {
          let text = '';
          return { write: async (s) => { text += s; }, close: async () => { files.set(name, text); } };
        },
      };
    },
    async removeEntry(name) { if (!files.delete(name)) throw notFound(); },
    async *entries() { for (const name of files.keys()) yield [name, { kind: 'file' }]; },
  };
}
const ok = () => true;

test('file names follow the documented pattern and only our own daily files match', () => {
  assert.equal(LATEST_NAME, 'gym-tracker-auto-uusin.json');
  assert.equal(dailyName('2026-10-22'), 'gym-tracker-auto-2026-10-22.json');
  assert.ok(isDailyName('gym-tracker-auto-2026-10-22.json'));
  for (const name of [LATEST_NAME, 'gym-tracker-2026-10-22.json', 'gym-tracker-auto-2026-10-22.json.bak', 'notes.txt', 'gym-tracker-auto-26-1-2.json']) assert.equal(isDailyName(name), false, name);
});

test('pruning keeps the newest daily copies and never selects foreign files', () => {
  const days = Array.from({ length: 20 }, (_, i) => dailyName(`2026-09-${String(i + 1).padStart(2, '0')}`));
  const stale = staleDailyNames([...days, LATEST_NAME, 'notes.txt', 'gym-tracker-2020-01-01.json']);
  assert.equal(KEEP_DAYS, 14);
  assert.deepEqual(stale.sort(), days.slice(0, 6));
  assert.deepEqual(staleDailyNames(days.slice(0, 14)), []);
});

test('unsupported without the directory picker', () => {
  assert.equal(supported(), false);
});

test('a write creates the latest and the day copy, and replaces only the latest later', async () => {
  const dir = memoryDir();
  await writeBackup(dir, 'one', '2026-10-22', ok);
  assert.equal(dir.files.get(LATEST_NAME), 'one');
  assert.equal(dir.files.get(dailyName('2026-10-22')), 'one');
  await writeBackup(dir, 'two', '2026-10-22', ok);
  assert.equal(dir.files.get(LATEST_NAME), 'two');
  assert.equal(dir.files.get(dailyName('2026-10-22')), 'one', 'the day copy is never overwritten');
  await writeBackup(dir, 'three', '2026-10-23', ok);
  assert.equal(dir.files.get(dailyName('2026-10-23')), 'three');
});

test('old copies are pruned only after a verified write and foreign files stay', async () => {
  const initial = { 'notes.txt': 'keep' };
  for (let i = 1; i <= 16; i++) initial[dailyName(`2026-10-${String(i).padStart(2, '0')}`)] = 'old';
  const failing = memoryDir(initial);
  await assert.rejects(writeBackup(failing, 'new', '2026-10-17', () => false));
  assert.equal([...failing.files.keys()].filter(isDailyName).length, 16, 'nothing is pruned when verification fails');
  const dir = memoryDir(initial);
  await writeBackup(dir, 'new', '2026-10-17', ok);
  const daily = [...dir.files.keys()].filter(isDailyName).sort();
  assert.equal(daily.length, 14);
  assert.equal(daily[0], dailyName('2026-10-04'));
  assert.equal(dir.files.get('notes.txt'), 'keep');
});
