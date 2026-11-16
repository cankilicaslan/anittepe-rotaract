// Başkan Mektubu sayfa çizici testleri — node --test tests/letter-render.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LAYOUTS, renderPage, renderLetter, esc, nl2br } from '../assets/js/letter-render.js';

const opts = (editable = false) => ({
  photoUrl: (ref) => 'https://ornek.test/' + (typeof ref === 'string' ? ref : ref.path),
  editable,
  logoUrl: '/assets/logo-beyaz.webp',
});

test('her düzen bir section üretir', () => {
  for (const k of Object.keys(LAYOUTS)) {
    const html = renderPage({ layout: k, fields: {} }, opts());
    assert.ok(html.includes(`class="lt-page lt-${k}"`), k);
  }
});

test('metin kaçışlanır', () => {
  const html = renderPage(
    { layout: 'baskan', fields: { body: '<script>x</script>\nikinci' } },
    opts(),
  );
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('<br>'));
  assert.ok(!html.includes('<script>'));
  assert.equal(esc(`<a href="x">'&`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
  assert.equal(nl2br('a\nb'), 'a<br>b');
});

test('boş fotoğraf yalnızca düzenleyicide yer tutucu', () => {
  const page = { layout: 'neler-1', fields: { label: 'Etiket', body: 'Metin' } };
  assert.ok(renderPage(page, opts(true)).includes('lt-slot-empty'));
  assert.ok(!renderPage(page, opts(false)).includes('lt-slot-empty'));
});

test('içindekiler sayfalardan türetilir', () => {
  const html = renderLetter(
    {
      period: 'Temmuz - Ağustos 2026',
      issue_no: 1,
      pages: [
        { layout: 'icindekiler', fields: {} },
        { layout: 'baskan', fields: {} },
        { layout: 'mesaj-2', fields: {} },
        { layout: 'neler-2', fields: {} },
      ],
    },
    opts(),
  );
  const toc = html.slice(html.indexOf('lt-icindekiler'), html.indexOf('lt-baskan'));
  const a = toc.indexOf('Başkan Mektubu');
  const b = toc.indexOf('Yönetim Kurulu Mesajları');
  const c = toc.indexOf('Neler Yaptık?');
  assert.ok(a > -1 && b > a && c > b, `${a} ${b} ${c}`);
});

test('fotoğraf konumu 0–1 kesirden object-position yüzdesine çevrilir', () => {
  const html = renderPage(
    { layout: 'neler-1', fields: { photo: { path: 'a.jpg', pos: { x: 0.25, y: 1 }, zoom: 1.5 } } },
    opts(),
  );
  assert.ok(html.includes('object-position:25% 100%'), html);
  assert.ok(html.includes('scale(1.5)'));
});

test('neler-tam en fazla 4 fotoğraf çizer', () => {
  const photos = ['1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg', '6.jpg'];
  const html = renderPage({ layout: 'neler-tam', fields: { label: 'x', body: 'y', photos } }, opts());
  assert.equal((html.match(/<img/g) || []).length, 4);
});
