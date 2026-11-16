# Başkan Mektubu Oluşturucu: Uygulama Planı

> **Yapay zekâ ajanları için:** Bu plan görev görev uygulanmalı. Bunun için `superpowers:subagent-driven-development` (önerilen) ya da `superpowers:executing-plans` alt yeteneği kullanılır. Adımlar onay kutusu (`- [ ]`) sözdizimiyle takip edilir.

**Amaç:** Üye panelinde Başkan Mektubu hazırlanır (elle ve yapay zekâ ile), PDF olarak indirilir ve yalnızca Başkan'ın onayıyla sitede yayımlanır.

**Mimari:**
- Sayfaları çizen tek modül `site/assets/js/letter-render.js` olur. Saf bir modüldür: veriden HTML metni üretir. Panel önizlemesi, site okuyucusu ve PDF görünümü hep bu modülü kullanır.
- Yapay zekâ modunun klasörlerini sayfalara dönüştüren mantık `site/assets/js/letter-assemble.js` içinde, ayrı ve saf bir modül olarak durur.
- Veri Supabase'te tutulur:
  - `letters` tablosu.
  - `published_pages`: sitede görünen kopya.
  - Herkese açık `letters` depo kovası.
  - Yalnızca Başkan'ın çalıştırabildiği `publish_letter` / `unpublish_letter` fonksiyonları.
- Proje ve etkinlik metinlerini yeni bir `letter-ai` edge fonksiyonu yazar.

**Teknoloji:** Derleme adımı olmayan ES modülleri (vanilla JS), Supabase (Postgres, RLS, Storage, Edge Functions/Deno), Claude `claude-opus-5-5`. Saf modüller `node --test` ile test edilir (Node 24).

**Spec:** `docs/superpowers/specs/2026-11-16-baskan-mektubu-design.md`

## Genel kısıtlar

- Sayfa ölçüsü 810×1012 piksel (4:5), yazı tipi Open Sans, zemin pembe-kırmızı gradyan, sağ altta beyaz logo.
- Düzen kodları: `kapak`, `kunye`, `icindekiler`, `baskan`, `mesaj-2`, `mesaj-1`, `kose`, `neler-2`, `neler-1`, `neler-tam`, `serbest`.
- Uzun metin eşiği 90 kelimedir. Bunu aşan madde `neler-tam` sayfasına çıkar ve 2 ile 4 fotoğraf kullanılır. Kısa maddeler ikişer ikişer `neler-2` sayfalarına yerleşir; fotoğraf olarak yıldızlı olan, yoksa ilki kullanılır.
- Yapay zekâ yalnızca Neler Yaptık? metinlerini yazar. Başkan Mektubu, Yönetim Kurulu Mesajları ve Anıttepeliler Köşesi yalnızca elle girilir.
- Yapay zekâ kuralları:
  - Her madde için tek paragraf, 50 ile 80 kelime.
  - Notlarda olmayan bilgiyi eklemez.
  - Uzun tire kullanmaz.
  - Ocakbaşından "…'nın ev sahipliğinde" kalıbıyla söz eder; gerçek bir ocakbaşı gibi anlatmaz.
- Roller:
  - Düzenleyiciler: `baskan`, `sekreter` ve yeni `kulup` (etiketi "Kulüp Hizmetleri").
  - Yalnızca görüntüleyen: asbaşkan.
  - Yayınlama ve yayından kaldırma yalnızca `baskan` rolündedir.
- Yayın kuralları:
  - Site yalnızca `published_pages` alanını okur.
  - Kaydetmek taslağı günceller.
  - Sayı numarası her dönem 1'den başlar; benzersizlik `(term_id, issue_no)` üzerindedir.
  - Site adresi `/mektup/?donem=2026-27&sayi=1` biçimindedir.
- Görseller yüklenmeden önce tarayıcıda en fazla 1600 piksele küçültülüp JPEG'e çevrilir. Yol: `letters/<letter_id>/<uuid>.jpg`.
- Kişisel veri:
  - Misafirlerin yalnızca isimleri `guest_names()` üzerinden okunur.
  - Herkese açık depoya telefon ve e-posta girmez.
- PDF:
  - `@page { size: 810px 1012px; margin: 0 }` kullanılır.
  - Her sayfa `break-after: page` ile ayrılır.
  - Renkler `print-color-adjust: exact` ile korunur.
  - Çıktı `window.print()` ile alınır.
- Mevcut yapıya uyulur:
  - Panel sayfası `app.js` içindeki `PAGES` listesine eklenir.
  - Veri metodları `store.js` içine, hem demo hem Supabase için yazılır.
  - Önbellek kırma için `?v=YYYYMMDDHHMM` düzeni kullanılır.
  - Demo modu (`?demo`) örnek bir mektup gösterir.
- Commit kuralları:
  - Yazar: `cankilicaslan`.
  - Mesaj Türkçedir ve `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` satırıyla biter.
  - Push, terminal sekmesinden yapılır.

## İnceleme odağı

Hiçbir görevin testinin doğrudan kapsamadığı ama kullanıcıyı en çok etkileyebilecek durumlar, en olası olandan başlayarak:

1. **Uzun ya da boş metin, fotoğrafsız klasör:** Sayfa bozulmamalı. Boş fotoğraf alanı düzenleyicide yer tutucu olarak görünür, PDF'te ve sitede hiç çizilmez.
2. **Kullanıcı metninde HTML veya `<script>` olması:** Metin her yerde kaçışlanmalı ve satır sonları korunmalı. (Test: Görev 2)
3. **Aynı taslağı iki kişinin kaydetmesi:** İkinci kaydeden `updated_at` uyuşmazlığı yüzünden uyarı almalı ve hiçbir şey sessizce kaybolmamalı. (Test: Görev 3, SQL doğrulaması)
4. **Başkan dışındaki birinin yayınlamaya çalışması:** Veritabanı reddetmeli; sitede taslak görünmemeli. (Test: Görev 1, SQL doğrulaması)
5. **Dönemde hiç toplantı olmaması ya da ay aralığının boş kalması:** Yapay zekâ modu yine açılmalı. Toplantı klasörleri boş gelir; proje ve etkinlik klasörleri elle eklenebilir. (Test: Görev 4)

---

## Dosya yapısı

| Dosya | Sorumluluk |
|---|---|
| `backend/schema.sql` (ekleme: v26) | `letters` tablosu, RLS, `kulup` rolü, yayın fonksiyonları, `letters` depo kovası ve politikaları, `guest_names()` yetkisinin `kulup` rolüne açılması |
| `site/assets/js/letter-render.js` | `LAYOUTS` tanımları, `renderPage`, `renderLetter`, `esc` |
| `site/assets/css/letter.css` | Sayfa ve düzen stilleri ile yazdırma kuralları; panel ve site ortak kullanır |
| `site/assets/js/letter-assemble.js` | `wordCount`, `meetingLabel`, `defaultFolders`, `assemblePages` |
| `site/tests/letter-render.test.mjs`, `site/tests/letter-assemble.test.mjs` | `node --test` testleri |
| `backend/functions/letter-ai/index.ts` | Neler Yaptık? paragraflarını yazan Claude çağrısı |
| `site/uye/js/roles.js` | `kulup` rolü ve `OWNER.mektup` |
| `site/uye/js/store.js` | Mektup metodları (demo ve Supabase) |
| `site/uye/js/letter-editor.js` | Panel ekranı: liste, elle düzenleyici, yapay zekâ klasörleri, PDF, yayın |
| `site/uye/css/letter-editor.css` | Düzenleyici arayüzünün stilleri |
| `site/uye/js/app.js`, `site/uye/index.html` | Panele "Başkan Mektubu" sayfasının eklenmesi |
| `site/mektup/index.html` | Herkese açık liste ve okuma sayfası |
| `anittepe-rotaract-taslak.html`, `anittepe-rotaract-en.html`, `site/sitemap.xml` | Anasayfadan bağlantı ve site haritası |

---

### Görev 1: Veritabanı (v26)

**Dosyalar:** `backend/schema.sql` dosyasının sonuna ekleme yapılır.

**Bu görevin sağladıkları:**
- **Tablo `public.letters`:**
  - `id uuid pk`
  - `term_id uuid` (`terms` tablosuna bağlı)
  - `issue_no int`
  - `period text`
  - `status text`, değerleri `taslak` / `yayinda`, varsayılan `taslak`
  - `pages jsonb`, varsayılan `[]`
  - `folders jsonb`, varsayılan `{}`
  - `published_pages jsonb`
  - `published_at timestamptz`
  - `updated_at timestamptz`
  - `updated_by uuid`
  - Benzersizlik: `unique(term_id, issue_no)`
- **`public.letter_editor() returns boolean`:** `has_role('baskan') or has_role('sekreter') or has_role('kulup')`.
- **RLS:**
  - **select:** Anon ve authenticated kullanıcılar `status = 'yayinda'` olan satırları okuyabilir. Ayrıca `letter_editor() or can_view_all()` olanlar tüm satırları okuyabilir.
  - **insert / update:** `letter_editor()` olanlar yapabilir.
  - **Yayın alanlarının korunması:** Yayın alanlarını yalnızca yayın fonksiyonları değiştirir. Bunun için bir `before update` tetikleyicisi, oturum `security definer` fonksiyonundan gelmiyorsa `status`, `published_pages` ve `published_at` alanlarını eski değerlerinde tutar. Fonksiyonlar `set_config('app.letter_publish','1',true)` ayarını açar.
  - **delete:** `is_admin()` olanlar silebilir.
- **Anon için sütun izni:** `id, term_id, issue_no, period, status, published_pages, published_at`. Anon kullanıcıya `pages` ve `folders` verilmez; bunun için `revoke select` ve ardından sütun bazında `grant select` yapılır.
- **`public.publish_letter(p_id uuid)` ve `public.unpublish_letter(p_id uuid)`:** `security definer` fonksiyonlardır. `has_role('baskan')` değilse `raise exception 'Yalnızca Başkan yayınlayabilir'`.
  - **Yayınla:** `published_pages := pages`, `status := 'yayinda'`, `published_at := now()`.
  - **Kaldır:** `status := 'taslak'`, `published_pages := null`.
  - Yalnızca `authenticated` rolüne `grant execute` verilir.
- **`profiles_roles_chk`:** Kısıt bırakılıp `array['baskan','asbaskan','sayman','sekreter','pr','hizmet','kulup']` ile yeniden kurulur.
- **`guest_names()`:** Yetki koşuluna `or public.has_role('kulup')` eklenir.
- **Depo kovası `letters`:** `public = true`, `insert into storage.buckets … on conflict do nothing`.
  - Politikalar `storage.objects` üzerinde, `bucket_id = 'letters'` için kurulur.
  - Herkes okuyabilir.
  - insert, update ve delete yalnızca `letter_editor()` olanlara açıktır.
- **Künye varsayılanı:** `app_settings` tablosuna `letter_kunye` anahtarıyla bir değer eklenir (`on conflict do nothing`). Değer `[{title, name}]` dizisidir; içinde örnek mektuptaki 5 Rotary ve bölge satırı yer alır. Bu satırlar herkese açık görevlerdir. Kulüp yönetimi panelden okunur.
- **`app_settings` yazma politikası:** `letter_kunye` anahtarı için `letter_editor()` olanlar da yazabilir.

- [ ] **Adım 1:** v26 bloğunu `schema.sql` dosyasının sonuna yaz. Mevcut v19–v25 blokları gibi başlık yorumu taşısın.
- [ ] **Adım 2:** Bloğu Supabase SQL Editor'da çalıştır. Beklenen: hata yok.
- [ ] **Adım 3: Doğrulama (aynı SQL Editor'da):**
  - `select count(*) from letters;` → 0.
  - `select has_function_privilege('anon','public.publish_letter(uuid)','execute');` → false.
  - `select public from storage.buckets where id='letters';` → true.
  - `set local role anon;` sonrası `select pages from letters;` → izin hatası.
- [ ] **Adım 4:** Edin Eren Çimciler'in profilini kontrol et: `select id, status, roles from profiles where full_name ilike 'Edin Eren%';`.
  - Satır varsa: `roles` alanına `kulup` eklenir.
  - Satır yoksa: kullanıcıya davet gerektiğini raporla. Bu durum koddaki ilerlemeyi engellemez.
- [ ] **Adım 5:** Commit. Mesaj: "Başkan Mektubu: veritabanı (v26)".

### Görev 2: Sayfa çizici ve stiller

**Dosyalar:**
- Oluşturulacak: `site/assets/js/letter-render.js`, `site/assets/css/letter.css`, `site/tests/letter-render.test.mjs`

**Bu görevin sağladıkları:**
- **`LAYOUTS`:** Her düzen kodu için `{ label, fields: [{key, label, kind: 'text'|'long'|'photo'|'list', ai?: true}], group }` nesnesi. `ai: true` yalnızca `neler-*` düzenlerinin metin alanlarında bulunur. Alan anahtarları:
  - **kapak:** `issue`, `period`, `title`, `photo`
  - **kunye:** `rows`, liste `[{title, name}]`
  - **icindekiler:** `items`, liste; boşsa sayfalardan türetilir
  - **baskan:** `photo`, `body`, `name`, `club`, `role`
  - **mesaj-2:** `body1`, `name1`, `role1`, `body2`, `name2`, `role2`
  - **mesaj-1:** `body`, `name`, `role`, `photo`
  - **kose:** `body1`, `name1`, `role1`, `photo1`, `body2`, `name2`, `role2`, `photo2`
  - **neler-2:** `label1`, `photo1`, `body1`, `label2`, `photo2`, `body2`
  - **neler-1:** `label`, `photo`, `body`
  - **neler-tam:** `label`, `body`, `photos` (en fazla 4)
  - **serbest:** `title`, `body`, `photos` (en fazla 4)
- **`renderPage(page, { photoUrl:(ref)=>string, editable:boolean, logoUrl:string }) => string`:** `<section class="lt-page lt-{layout}">…</section>` döndürür. `editable` açıksa alanlara `data-field` niteliği eklenir ve boş fotoğraf alanına `.lt-slot-empty` yer tutucusu konur.
- **`renderLetter(letter:{pages, period, issue_no}, opts) => string`:** Tüm sayfaları sırayla birleştirir. `icindekiler` boşsa içeriği `LAYOUTS[...].group` sırasıyla doldurur.
- **`esc(s) => string`:** HTML kaçışlama yapar.
- **`nl2br`:** Satır sonlarını `<br>` yapar.
- **`letter.css`:**
  - `.lt-page` 810×1012 boyutundadır.
  - Ekranda kapsayıcı CSS değişkeni `--lt-scale` ile ölçeklenir.
  - `@media print` kuralları Genel kısıtlardaki PDF kurallarını uygular.

- [ ] **Adım 1: Başarısız testleri yaz (`site/tests/letter-render.test.mjs`):**
  - `test('her düzen bir section üretir')`: `Object.keys(LAYOUTS)` listesinin her elemanı için `renderPage({layout:k, fields:{}}, opts)` çıktısı `class="lt-page lt-${k}"` içerir.
  - `test('metin kaçışlanır')`: `body:'<script>x</script>\nikinci'` girdisinin çıktısı `&lt;script&gt;` ve `<br>` içerir, `<script>` içermez.
  - `test('boş fotoğraf yalnızca düzenleyicide yer tutucu')`: `editable:true` iken çıktı `lt-slot-empty` içerir, `editable:false` iken içermez.
  - `test('içindekiler sayfalardan türetilir')`: `[baskan, mesaj-2, neler-2]` sayfalarının çıktısı "Başkan Mektubu", "Yönetim Kurulu Mesajları" ve "Neler Yaptık?" metinlerini bu sırayla içerir.
  - `test('neler-tam en fazla 4 fotoğraf çizer')`: 6 fotoğraf verilir; çıktıda 4 adet `<img` bulunur.
- [ ] **Adım 2:** `node --test site/tests/letter-render.test.mjs` çalıştır. Beklenen: FAIL (modül yok).
- [ ] **Adım 3:** `letter-render.js` ve `letter.css` dosyalarını yaz. Görsel yön örnek mektuptan gelir:
  - Kapakta büyük başlık ve dekoratif üçgenler.
  - Künyede iki satırlık "unvan / isim" blokları.
  - "Neler Yaptık?" sayfalarında beyaz kenarlı, hafif dönük polaroid fotoğraf ve altında etiket.
  - Sağ altta logo (`assets/logo-beyaz.webp`).
- [ ] **Adım 4:** Testleri çalıştır. Beklenen: 5 test PASS.
- [ ] **Adım 5:** Görsel kontrol: geçici bir `site/tests/letter-preview.html` dosyası tüm düzenleri örnek verilerle çizer. Önizlemede örnek mektupla yan yana karşılaştır. Bu dosya commit'e girmez.
- [ ] **Adım 6:** Commit. Mesaj: "Başkan Mektubu: sayfa çizici".

### Görev 3: Store metodları ve roller

**Dosyalar:** `site/uye/js/store.js` (demo ve Supabase bölümleri), `site/uye/js/roles.js`

**Bu görevin sağladıkları (demo ve Supabase'te aynı imzalar):**
- **`listLetters() => [{id, issue_no, period, status, published_at, updated_at}]`:** Etkin dönemin mektuplarını, `issue_no` azalan sırayla döndürür.
- **`getLetter(id) => letter`:** Satırın tamamını döndürür.
- **`createLetter({issue_no, period}) => letter`**
- **`saveLetter(letter, prevUpdatedAt) => letter`:** `update … where id = $1 and updated_at = prevUpdatedAt`. Sıfır satır etkilenirse `throw new Error('Bu mektubu başka biri kaydetti. Sayfayı yenileyip tekrar deneyin.')`.
- **`publishLetter(id)` ve `unpublishLetter(id)`:** Supabase'te `sb.rpc('publish_letter', {p_id})` ve karşılığı çağrılır.
- **`uploadLetterPhoto(letterId, blob) => { path, url }`:** `letters` kovasına yükler; `url` herkese açık adrestir.
- **`copyAvatarToLetter(letterId, photoUrl) => { path, url }`:** Profil fotoğrafını kopyalar.
- **`letterAi(items) => { texts: string[] }`:** `fn('letter-ai', { items })` çağırır.
  - **Demo:** Her madde için notları içeren şablon bir paragraf döndürür.
  - **Supabase yedeği:** Hata olursa notlar olduğu gibi döner ve `{source:'sablon'}` eklenir.
- **`getSetting('letter_kunye')`:** Mevcut metod kullanılır, yeni metod yazılmaz.
- **`listGuestNames`:** Mevcut metod kullanılır.
- **`roles.js`:**
  - `ROLE_LABELS.kulup = "Kulüp Hizmetleri"`
  - `OWNER.mektup = ["kulup", "sekreter"]`
  - `SHORT.kulup = "Kulüp Hizmetleri"`
- **Demo:** `S.letters` içinde örnek veri olarak 1 yayında mektup bulunur (kapak, künye, başkan, neler-2).

- [ ] **Adım 1:** Demo metodlarını yaz ve `?demo` modunda tarayıcı konsolundan `await store.listLetters()` çalıştır. Beklenen: 1 kayıt.
- [ ] **Adım 2:** Supabase metodlarını yaz.
- [ ] **Adım 3: Çakışma doğrulaması (canlı, Görev 1 sonrasında):** SQL ile bir taslak oluştur. Paneldeki `saveLetter` çağrısını eski `updated_at` değeriyle iki kez yap. Beklenen: ikinci çağrı yukarıdaki hata mesajını verir. Sonra test kaydını sil.
- [ ] **Adım 4:** Commit. Mesaj: "Başkan Mektubu: store ve kulup rolü".

### Görev 4: Klasörlerden sayfa kurma

**Dosyalar:**
- Oluşturulacak: `site/assets/js/letter-assemble.js`, `site/tests/letter-assemble.test.mjs`

**Bu görevin sağladıkları:**
- **`LONG_WORDS = 90`**
- **`wordCount(s) => number`**
- **`meetingLabel(m:{club_no, term_no}) => string`:** Örnek: `"600 / 1. Toplantımız"`.
- **`defaultFolders({ issue_no, period, from, to, meetings, kunye, board }) => folders`:**
  - Döndürülen nesne: `{ cover:{issue, period, photo}, kunye:{rows}, president:{photo, body, name, role}, board:[], corner:[], items:[] }`.
  - `items`: `from` ile `to` arasındaki toplantılar, tarih sırasıyla, `{id, kind:'toplanti', title: meetingLabel(m), label: meetingLabel(m), date, photos:[], star:null, notes:'', text:''}` biçiminde.
  - `kunye.rows`: `kunye` ayarı ile `board` (yönetim kurulu) listelerinin birleşimi.
- **`assemblePages(folders) => pages[]`:**
  - Sıra: `kapak`, `kunye`, `icindekiler`, `baskan`, ardından yönetim kurulu mesajları, köşe ve Neler Yaptık?.
  - **Yönetim kurulu mesajları:** ikişer ikişer `mesaj-2`; tek kalırsa `mesaj-1`.
  - **Köşe:** ikişer ikişer `kose`.
  - **Neler Yaptık? maddeleri:**
    - `wordCount(text || notes) > 90` olan madde `neler-tam` sayfasına çıkar ve `photos.slice(0, 4)` kullanılır.
    - Diğerleri ikişer ikişer `neler-2`; tek kalırsa `neler-1`.
    - Fotoğraf: `star ?? photos[0]`.
  - Her sayfa `{ id, layout, fields }` biçimindedir.
- **`missingFor(folders) => string[]`:** Eksikler için Türkçe uyarılar üretir. Örnek: `"«Kitap Bağışı»: fotoğraf yok"`.

- [ ] **Adım 1: Başarısız testleri yaz:**
  - `test('meetingLabel')`: `meetingLabel({club_no:600, term_no:1})` sonucu `'600 / 1. Toplantımız'`.
  - `test('aralıktaki toplantılar klasör olur')`: 3 toplantının 2'si aralıkta; `items.length === 2` ve sıra tarihe göre.
  - `test('toplantı yoksa boş items')`: `meetings:[]` verildiğinde `items` boş dizi, hata yok.
  - `test('91 kelime neler-tam olur')`: `pages.filter(p => p.layout === 'neler-tam').length === 1` ve o sayfada `fields.photos.length <= 4`.
  - `test('kısa maddeler ikişer, tek kalan neler-1')`: 3 kısa madde verilir; düzenler `['neler-2', 'neler-1']`.
  - `test('yıldızlı fotoğraf seçilir')`: `star:'b'`, `photos:['a','b']` verilir; `fields.photo1 === 'b'`.
  - `test('3 yönetim kurulu mesajı')`: düzenler `['mesaj-2', 'mesaj-1']`.
  - `test('missingFor fotoğrafsız maddeyi bildirir')`.
- [ ] **Adım 2:** `node --test site/tests/letter-assemble.test.mjs` çalıştır. Beklenen: FAIL.
- [ ] **Adım 3:** Modülü yaz.
- [ ] **Adım 4:** Testleri çalıştır. Beklenen: hepsi PASS.
- [ ] **Adım 5:** Commit. Mesaj: "Başkan Mektubu: klasörlerden sayfa kurma".

### Görev 5: Yapay zekâ fonksiyonu `letter-ai`

**Dosyalar:** Oluşturulacak: `backend/functions/letter-ai/index.ts`

`backend/functions/caption/index.ts` dosyasındaki CORS, `HttpError`, JWT doğrulama ve Anthropic çağrı yapısı kopyalanır.

**Bu görevin sağladıkları:**
- **İstek:** `POST { items: [{kind, title, label, date, club_no?, term_no?, host?, notes}] }`. En fazla 20 madde.
- **Yanıt:** `{ texts: string[] }`. Sıra `items` ile aynıdır.
- **Yetki:** `has_role` denetimi `baskan`, `sekreter` ve `kulup` rollerini kabul eder.
- **Model çağrısı:** `claude-opus-5-5`, `output_config: { effort: "low" }`, tek istek.
- **İstem:** Modelden yanıtı `===1===` gibi ayraçlarla numaralı paragraflar olarak vermesi istenir. Yanıt bu ayraçlara göre bölünür.
- **Sistem istemi** Genel kısıtlardaki yapay zekâ kurallarını içerir:
  - 50 ile 80 kelime, tek paragraf.
  - Uydurma yok, uzun tire yok, ocakbaşı kuralı.
  - Örnek mektuptaki dil: "Kulübümüzün 603., dönemimizin 4. toplantısında…", birinci çoğul şahıs.
- **Ayrıştırma hatası:** Paragraf sayısı tutmazsa eksik olanlar için `notes` metni döner.

- [ ] **Adım 1:** Fonksiyonu yaz ve `node --experimental-strip-types` ile ayrıştırma yardımcısını yerelde test et. Örnek girdi: `"===1===\nA\n===2===\nB"` → `['A', 'B']`.
- [ ] **Adım 2:** Commit ve push et. Ardından Supabase panelinden "Deploy a new function" → "Via Editor" ile `letter-ai` adıyla yükle. Kodu, raw GitHub üzerinden commit sha'sıyla al.
- [ ] **Adım 3:** `curl -X OPTIONS …/functions/v1/letter-ai` çalıştır. Beklenen: 200. Kimlik olmadan POST at. Beklenen: 401.

### Görev 6: Panel ekranı

**Dosyalar:**
- Oluşturulacak: `site/uye/js/letter-editor.js`, `site/uye/css/letter-editor.css`
- Değiştirilecek: `site/uye/js/app.js` (`PAGES` listesine `{ id: "mektup", label: "Başkan Mektubu", panel: "mektup" }` ve `viewLetter`), `site/uye/index.html` (iki CSS bağlantısı)

**Bu görevin kullandıkları:** Görev 2, 3 ve 4'ün sağladıkları.

**Bu görevin sağladıkları:** `mountLetterEditor(root, { store, me, toast, readOnly }) => { destroy() }`.

**Ekran akışı:**
1. **Liste:** sayılar, durum etiketi (Taslak / Yayında) ve "Yeni sayı" düğmesi. Sayı numarası önerisi: en büyük `issue_no` + 1.
2. **Mektup içinde iki sekme:** "Yapay zekâ ile oluştur" ve "Elle düzenle".
   - **Yapay zekâ ile oluştur:**
     - Klasörler: Kapak ve Künye, Başkan Mektubu, Yönetim Kurulu Mesajları, Anıttepeliler Köşesi, Neler Yaptık?.
     - Başlıklarda, klasörün dolu ya da eksik olduğunu gösteren işaretler bulunur.
     - Neler Yaptık? altındaki klasörlerin adı yeniden adlandırılabilir. "Proje ekle", "Etkinlik ekle" ve "Ocakbaşı ekle" düğmeleri vardır.
     - Fotoğraflar sürükle-bırakla, birden çok seçilerek eklenebilir ve biri yıldızlanabilir.
     - Kişi seçici, üyeleri ve misafirleri (`listGuestNames`) gösterir. Profil fotoğrafı olan bir üye seçilince `copyAvatarToLetter` ile o fotoğraf varsayılan olarak gelir.
     - "Yapay zekâ ile oluştur" düğmesi `missingFor` uyarılarını gösterir. Ardından `letterAi` çağrılır, `assemblePages` çalışır ve sonuç elle düzenleyiciye açılır. Mevcut sayfalar varsa önce onay istenir.
   - **Elle düzenle:**
     - Solda sayfa küçük resimleri; sürükleyerek sıralama, çoğaltma ve silme.
     - Ortada `renderPage(editable:true)` önizlemesi.
     - Sağda alan formu: metin alanları, fotoğraf alanı (bırak, seç, konumlandır), `ai` alanlarında "✦ Yapay zekâ ile yaz" düğmesi.
     - "+ Sayfa ekle" düğmesi, `LAYOUTS` listesini küçük resimli bir seçici olarak açar.
     - `neler-2` veya `neler-1` sayfasındaki bir metin 90 kelimeyi geçerse, "Bu madde tam sayfaya taşınsın mı?" önerisi çıkar.
3. **Üst çubuk:**
   - "Kaydet": `saveLetter`; çakışmada hata mesajı gösterilir.
   - "PDF indir": aşağıdaki PDF görünümü.
   - "Yayınla" / "Yayından kaldır": yalnızca `hasRole(me, 'baskan')` için görünür.
   - Sayfa kaydedilmemiş değişiklik varken kapatılırsa `beforeunload` uyarısı çıkar.
4. **PDF görünümü:** `renderLetter` çıktısı yazdırma kapsayıcısına basılır ve `window.print()` çağrılır. Altında bir ipucu gösterilir: "Hedef: PDF olarak kaydet".
5. **Salt okunur görünüm (asbaşkan):** tüm girişler kapalıdır; PDF indirilebilir.

**Adımlar:**
- [ ] **Adım 1:** Ekranı yaz. `node --check` ile sözdizimini denetle. Önbellek sürümünü artır.
- [ ] **Adım 2: Demo tarayıcı doğrulaması** (önizleme sunucusu "panel", `?demo`, Başkan çipi):
  - Liste açılır.
  - Yeni sayı oluşturulur.
  - 2 proje klasörü eklenir; biri 100 kelime notlu.
  - "Yapay zekâ ile oluştur" çalıştırılır. Beklenen: sayfalarda `neler-tam` ×1 bulunur.
  - Elle düzenleyicide bir alan değiştirilir ve kaydedilir.
  - Sayfa yenilenir; değişiklik kalıcıdır.
- [ ] **Adım 3: Rol doğrulaması:**
  - Sekreter çipiyle "Yayınla" görünmez.
  - Asbaşkan çipiyle görünüm salt okunurdur.
- [ ] **Adım 4:** Mobil (375px) görünümde form sütunu altta durmalı ve yatay kaydırma olmamalı.
- [ ] **Adım 5:** Commit. Mesaj: "Başkan Mektubu: panel ekranı".

### Görev 7: Sitede yayın ve PDF

**Dosyalar:**
- Oluşturulacak: `site/mektup/index.html`
- Değiştirilecek: `anittepe-rotaract-taslak.html` ve `anittepe-rotaract-en.html` ("Haberler" bölümüne "Başkan Mektupları →" bağlantısı), `site/sitemap.xml`. Ardından derleme betiği çalıştırılır.

**`mektup/index.html`:**
- `uye/js/config.js` içindeki anonim anahtarla REST çağrısı yapılır: `letters?status=eq.yayinda&select=id,issue_no,period,published_at,published_pages,term_id`. Dönem etiketi için terms bilgisi de çekilir.
- **Parametresiz açılış:** kapak küçük resimleriyle sayı listesi.
- **`?donem=…&sayi=…` ile açılış:** `renderLetter(published_pages, { editable:false })` ile okuma görünümü.
  - Sayfalar ekran genişliğine ölçeklenir.
  - "PDF indir" düğmesi `window.print()` çağırır.
- Sitenin başlık ve altbilgi stiliyle uyumlu, sade bir çerçeve kullanılır. Ayrıca `<title>`, açıklama ve canonical etiketleri bulunur.

**Adımlar:**
- [ ] **Adım 1:** Sayfayı ve bağlantıları yaz, derlemeyi çalıştır (`build.sh`).
- [ ] **Adım 2: Yerel doğrulama:**
  - Demo verisi değil, gerçek Supabase'te yayında kayıt olmadığından liste görünümü "Henüz yayımlanmış sayı yok" mesajını göstermeli.
  - Ardından SQL ile geçici bir yayında kayıt ekle; okuma görünümü açılmalı.
  - 375px genişlikte yatay kaydırma olmamalı.
  - Sonra geçici kaydı sil.
- [ ] **Adım 3: PDF doğrulaması:** Chrome'da yazdırma önizlemesi açılır. Beklenen:
  - Sayfa sayısı mektup sayfasıyla aynı.
  - Gradyanlar görünür.
  - Türkçe karakterler doğru.
  - Sayfalar bölünmüyor.
- [ ] **Adım 4:** Commit, push ve canlı kontrol. `curl` döngüsüyle `/mektup/` adresinin 200 döndüğü ve anasayfada bağlantının bulunduğu doğrulanır.

### Görev 8: Son kontrol

- [ ] **Adım 1:** `node --test site/tests/` çalıştır. Beklenen: tüm testler PASS.
- [ ] **Adım 2:** Canlı panelde Sekreter dışı bir hesapla (kullanıcı) ve Başkan rolüyle uçtan uca deneme yapılır. Bu deneme kullanıcıya bırakılır; Claude yalnızca demo ve SQL doğrulaması yapar.
- [ ] **Adım 3:** Kullanıcıya rapor: ne bitti, Edin Eren hesabının durumu, nelerin canlı hesapla denenmesi gerektiği.
