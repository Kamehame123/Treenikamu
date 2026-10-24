import test from 'node:test';
import assert from 'node:assert/strict';
import { CHEERS, RECORD_CHEERS, cheerChance, pickCheer, pickRecordCheer } from '../cheers.js';

const all = [...CHEERS.early, ...CHEERS.middle, ...CHEERS.late];

test('there are 50 distinct Swedish cheers', () => {
  assert.equal(all.length, 50);
  assert.equal(new Set(all).size, 50);
  for (const c of all) assert.ok(c.trim().length > 10 && c === c.trim(), c);
});

test('cheers become more likely as the workout progresses', () => {
  assert.ok(cheerChance(1, 20) < cheerChance(10, 20));
  assert.ok(cheerChance(10, 20) < cheerChance(19, 20));
  assert.equal(cheerChance(0, 0), 0);
});

test('a cheer is shown only when the roll is under the chance and the workout is unfinished', () => {
  assert.equal(pickCheer(5, 10, '', () => 0.99), '');
  assert.ok(all.includes(pickCheer(5, 10, '', () => 0)));
  assert.equal(pickCheer(10, 10, '', () => 0), '');
  assert.equal(pickCheer(1, 0, '', () => 0), '');
});

test('the cheer matches workout progress and never repeats the previous one', () => {
  assert.ok(CHEERS.early.includes(pickCheer(1, 12, '', () => 0)));
  assert.ok(CHEERS.middle.includes(pickCheer(6, 12, '', () => 0)));
  assert.ok(CHEERS.late.includes(pickCheer(10, 12, '', () => 0)));
  for (let i = 0; i < 200; i++) assert.notEqual(pickCheer(10, 12, CHEERS.late[0], () => Math.random() * 0.1), CHEERS.late[0]);
});

test('a personal record always gets its own cheer, never the previous one again', () => {
  assert.equal(new Set(RECORD_CHEERS).size, RECORD_CHEERS.length);
  for (const c of RECORD_CHEERS) assert.ok(!all.includes(c) && c.trim().length > 10 && c === c.trim(), c);
  assert.equal(pickRecordCheer('', () => 0), RECORD_CHEERS[0]);
  assert.equal(pickRecordCheer('', () => 0.999), RECORD_CHEERS.at(-1));
  for (let i = 0; i < 200; i++) {
    const c = pickRecordCheer(RECORD_CHEERS[1]);
    assert.ok(RECORD_CHEERS.includes(c) && c !== RECORD_CHEERS[1], c);
  }
});
