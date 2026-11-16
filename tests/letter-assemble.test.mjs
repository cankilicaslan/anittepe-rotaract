// Başkan Mektubu sayfa kurma testleri — node --test tests/letter-assemble.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LAYOUTS } from '../assets/js/letter-render.js';
import { wordCount, meetingLabel, defaultFolders, assemblePages, missingFor } from '../assets/js/letter-assemble.js';

const words = (n) => Array.from({ length: n }, (_, i) => 'kelime' + i).join(' ');
const base = (over = {}) => defaultFolders({
  issue_no: 1, period: '2026-2027', from: '2026-09-01', to: '2026-09-30',
  meetings: [], kunye: [], board: [], ...over,
});
const item = (over = {}) => ({
  id: 'x' + Math.random(), kind: 'toplanti', title: 'T', label: 'T', date: '2026-09-05',
  photos: [], star: null, notes: 'kısa not', text: '', ...over,
});

test('meetingLabel', () => {
  assert.equal(meetingLabel({ club_no: 600, term_no: 1 }), '600 / 1. Toplantımız');
});

test('wordCount', () => {
  assert.equal(wordCount('  bir iki   üç '), 3);
  assert.equal(wordCount(''), 0);
  assert.equal(wordCount(null), 0);
});

test('aralıktaki toplantılar klasör olur', () => {
  const f = base({
    meetings: [
      { date: '2026-09-20', club_no: 600, term_no: 3 },
      { date: '2026-08-10', club_no: 600, term_no: 1 },
      { date: '2026-09-05', club_no: 600, term_no: 2 },
    ],
  });
  assert.equal(f.items.length, 2);
  assert.deepEqual(f.items.map((i) => i.date), ['2026-09-05', '2026-09-20']);
  assert.equal(f.items[0].title, '600 / 2. Toplantımız');
  assert.equal(f.items[0].kind, 'toplanti');
  assert.ok(f.items[0].id);
});

test('toplantı yoksa boş items', () => {
  assert.deepEqual(base({ meetings: [] }).items, []);
  assert.deepEqual(base({ meetings: undefined }).items, []);
});

test('künye ve yönetim kurulu birleşir', () => {
  const f = base({ kunye: [{ title: 'Sahibi', name: 'A' }], board: [{ title: 'Başkan', name: 'B' }] });
  assert.deepEqual(f.kunye.rows, [{ title: 'Sahibi', name: 'A' }, { title: 'Başkan', name: 'B' }]);
  assert.deepEqual(base({ kunye: null }).kunye.rows, []);
});

test('91 kelime neler-tam olur', () => {
  const f = base();
  f.items = [item({ text: words(91), photos: ['a', 'b', 'c', 'd', 'e', 'f'] }), item({ text: words(10) })];
  const pages = assemblePages(f);
  const full = pages.filter((p) => p.layout === 'neler-tam');
  assert.equal(full.length, 1);
  assert.ok(full[0].fields.photos.length <= 4);
  assert.equal(pages.filter((p) => p.layout === 'neler-1').length, 1);
});

test('90 kelime uzun sayılmaz; text yoksa notes kullanılır', () => {
  const f = base();
  f.items = [item({ text: '', notes: words(90) })];
  assert.equal(assemblePages(f).filter((p) => p.layout === 'neler-tam').length, 0);
  f.items = [item({ text: '', notes: words(91) })];
  assert.equal(assemblePages(f).filter((p) => p.layout === 'neler-tam').length, 1);
});

test('kısa maddeler ikişer, tek kalan neler-1', () => {
  const f = base();
  f.items = [item(), item(), item()];
  const layouts = assemblePages(f).filter((p) => p.layout.startsWith('neler')).map((p) => p.layout);
  assert.deepEqual(layouts, ['neler-2', 'neler-1']);
});

test('yıldızlı fotoğraf seçilir', () => {
  const f = base();
  f.items = [item({ photos: ['a', 'b'], star: 'b' }), item({ photos: [{ path: 'p1' }, { path: 'p2' }], star: 'p2' })];
  const p = assemblePages(f).find((x) => x.layout === 'neler-2');
  assert.equal(p.fields.photo1, 'b');
  assert.deepEqual(p.fields.photo2, { path: 'p2' });
});

test('yıldız yoksa ilk fotoğraf', () => {
  const f = base();
  f.items = [item({ photos: ['a', 'b'] })];
  assert.equal(assemblePages(f).find((x) => x.layout === 'neler-1').fields.photo, 'a');
});

test('3 yönetim kurulu mesajı', () => {
  const f = base();
  f.board = [1, 2, 3].map((n) => ({ name: 'N' + n, role: 'R' + n, body: 'b' + n }));
  const layouts = assemblePages(f).filter((p) => p.layout.startsWith('mesaj')).map((p) => p.layout);
  assert.deepEqual(layouts, ['mesaj-2', 'mesaj-1']);
});

test('köşe ikişer sayfa olur', () => {
  const f = base();
  f.corner = [1, 2, 3].map((n) => ({ name: 'N' + n, role: 'R', body: 'b', photo: 'p' + n }));
  const pages = assemblePages(f).filter((p) => p.layout === 'kose');
  assert.equal(pages.length, 2);
  assert.equal(pages[0].fields.name2, 'N2');
  assert.equal(pages[1].fields.body2, '');
});

test('sıra ve kapak', () => {
  const pages = assemblePages(base());
  assert.deepEqual(pages.slice(0, 4).map((p) => p.layout), ['kapak', 'kunye', 'icindekiler', 'baskan']);
  assert.equal(pages[0].fields.issue, 'Sayı 1');
  assert.equal(pages[0].fields.title, 'Başkan Mektubu');
  assert.equal(new Set(pages.map((p) => p.id)).size, pages.length);
});

test('missingFor fotoğrafsız maddeyi bildirir', () => {
  const f = base();
  f.items = [item({ title: 'Kitap Bağışı', photos: [] }), item({ title: 'Dolu', photos: ['a'], notes: '', text: '' })];
  const m = missingFor(f);
  assert.ok(m.includes('«Kitap Bağışı»: fotoğraf yok'));
  assert.ok(m.includes('«Dolu»: açıklama yok'));
  assert.ok(m.includes('Başkan Mektubu: metin yok'));
});

test('boş klasör nesnesi hata vermez', () => {
  const pages = assemblePages({});
  const ls = pages.map((p) => p.layout);
  for (const l of ['kapak', 'kunye', 'icindekiler']) assert.ok(ls.includes(l));
  assert.ok(Array.isArray(missingFor({})));
});

test('üretilen düzen ve alan anahtarları LAYOUTS ile uyumlu', () => {
  const f = base();
  f.board = [1, 2, 3].map((n) => ({ name: 'N', role: 'R', body: 'b', photo: 'p' }));
  f.corner = [1, 2, 3].map(() => ({ name: 'N', role: 'R', body: 'b', photo: 'p' }));
  f.items = [item({ photos: ['a'] }), item(), item(), item({ text: words(100), photos: ['a', 'b'] })];
  for (const p of assemblePages(f)) {
    assert.ok(LAYOUTS[p.layout], p.layout);
    const keys = LAYOUTS[p.layout].fields.map((x) => x.key);
    for (const k of Object.keys(p.fields)) assert.ok(keys.includes(k), `${p.layout}.${k}`);
  }
});
