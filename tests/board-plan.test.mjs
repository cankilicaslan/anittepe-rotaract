// YK planlama yerleşim mantığı — node --test tests/board-plan.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { place, clear, move, placedIds, resolveSlot, MULTI } from '../uye/js/board-plan.js';

const A = { kind: 'member', id: 'a' }, B = { kind: 'member', id: 'b' }, G = { kind: 'guest', id: 'g' };

test('tek çerçeveye yerleştirir, girdiyi değiştirmez', () => {
  const s0 = {};
  const s1 = place(s0, 'baskan', A);
  assert.deepEqual(s1, { baskan: A });
  assert.deepEqual(s0, {});
});

test('dolu çerçeveye yerleştirmek eskisini değiştirir', () => {
  assert.deepEqual(place({ baskan: A }, 'baskan', B), { baskan: B });
});

test('ykuye çoklu: sona ekler, index ile değiştirir', () => {
  let s = place({}, MULTI, A);
  s = place(s, MULTI, B);
  assert.deepEqual(s[MULTI], [A, B]);
  s = place(s, MULTI, G, 0);
  assert.deepEqual(s[MULTI], [G, B]);
});

test('aynı kişi iki çerçevede olabilir', () => {
  const s = place(place({}, 'baskan', A), 'hizmet', A);
  assert.deepEqual(s, { baskan: A, hizmet: A });
});

test('move: boş hedefe taşır, dolu hedefle yer değiştirir', () => {
  assert.deepEqual(move({ baskan: A }, { key: 'baskan' }, { key: 'sayman' }), { sayman: A });
  assert.deepEqual(move({ baskan: A, sayman: B }, { key: 'baskan' }, { key: 'sayman' }), { baskan: B, sayman: A });
  assert.deepEqual(move({ [MULTI]: [A, B] }, { key: MULTI, index: 0 }, { key: 'pr' }), { [MULTI]: [B], pr: A });
});

test('clear: tekli ve ykuye index', () => {
  assert.deepEqual(clear({ baskan: A, sayman: B }, 'baskan'), { sayman: B });
  assert.deepEqual(clear({ [MULTI]: [A, B] }, MULTI, 0), { [MULTI]: [B] });
});

test('placedIds kişiyi bir kez sayar', () => {
  const ids = placedIds({ baskan: A, hizmet: A, [MULTI]: [G] });
  assert.deepEqual([...ids].sort(), ['guest:g', 'member:a']);
});

test('resolveSlot: aktif üye, pasif üye eksik, silinmiş misafir eksik', () => {
  const members = [{ id: 'a', status: 'active', full_name: 'A' }, { id: 'p', status: 'passive', full_name: 'P' }];
  const guests = [{ id: 'g', full_name: 'G' }];
  assert.equal(resolveSlot(A, members, guests).person.full_name, 'A');
  assert.deepEqual(resolveSlot({ kind: 'member', id: 'p' }, members, guests), { missing: true });
  assert.deepEqual(resolveSlot({ kind: 'guest', id: 'x' }, members, guests), { missing: true });
  assert.equal(resolveSlot(G, members, guests).person.full_name, 'G');
  assert.equal(resolveSlot(undefined, members, guests), null);
});

// --- İki kişilik görev (eş başkanlık vb.)
import { addSecond, removeOne } from '../uye/js/board-plan.js';

test('addSecond: dolu çerçeveye ikinci kişi, ikinci varsa değiştirir', () => {
  let s = addSecond({ hizmet: A }, 'hizmet', B);
  assert.deepEqual(s, { hizmet: [A, B] });
  s = addSecond(s, 'hizmet', G);
  assert.deepEqual(s, { hizmet: [A, G] });
  assert.deepEqual(addSecond({}, 'hizmet', A), { hizmet: A });
});

test('removeOne: çiftten birini çıkarınca tekliye döner', () => {
  assert.deepEqual(removeOne({ hizmet: [A, B] }, 'hizmet', 0), { hizmet: B });
  assert.deepEqual(removeOne({ hizmet: [A, B] }, 'hizmet', 1), { hizmet: A });
});

test('çift: placedIds ikisini sayar, move ikisini birden taşır, resolveSlot ikisini çözer', () => {
  const s = { hizmet: [A, G] };
  assert.deepEqual([...placedIds(s)].sort(), ['guest:g', 'member:a']);
  assert.deepEqual(move(s, { key: 'hizmet' }, { key: 'pr' }), { pr: [A, G] });
  const members = [{ id: 'a', status: 'active', full_name: 'A' }], guests = [{ id: 'g', full_name: 'G' }];
  const r = resolveSlot([A, G], members, guests);
  assert.deepEqual(r.pair.map(x => x.person.full_name), ['A', 'G']);
});
