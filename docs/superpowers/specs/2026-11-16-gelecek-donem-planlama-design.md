# Gelecek dönemi planla (2027-2028) — tasarım

## Amaç

Asbaşkan bir sonraki dönemi (1 Temmuz 2027 – 30 Haziran 2028) önceden planlayabilsin:
yönetim kurulunu yerleştirsin, takvim/projeleri, aidat taksitlerini ve kasa bütçesini girsin.
Planlama **taslak** olarak kalır; dönem gelince kulüp elle "aktif dönem" yapar ve girilen her şey olduğu gibi devam eder.

## Kim görür

- Menüde "Gelecek dönemi planla" ve planlama ekranları **yalnızca asbaşkan ve site sahibi (Can)** görür.
- Başkan, geçmiş dönem başkanları ve diğer herkes görmez (bugün "her şeyi gören" `can_view_all` kişileri de dahil).
- Veritabanı da aynı kuralı uygular: aktif olmayan döneme ait kayıtları yalnızca bu iki kişi okur ve yazar.

## Hedefler

1. **Yönetim** bölümünde (asbaşkan ve sahip için) "Gelecek dönemi planla" menü öğesi.
2. Tıklanınca panel **planlama moduna** geçer: üstte belirgin bir şerit "2027-2028 dönemi planlama · taslak" ve "Planlamadan çık" düğmesi; menü yalnızca planlama sayfalarını gösterir:
   1. **Yönetim kurulu planlama** (en üstte)
   2. **Takvim**
   3. **Kulüp projeleri**
   4. **Aidat**
   5. **Kulüp kasası**
3. Takvim, Kulüp projeleri, Aidat, Kulüp kasası mevcut ekranların **aynısıdır**, ama 2027-28 dönemine bağlı verilerle çalışır. Planlama modunda planlayıcı bu ekranlarda düzenleme yapabilir (normalde asbaşkan bunları yalnız görür).
4. **Yönetim kurulu planlama** ekranı:
   - Sol/orta alan: üstte **Yönetim Kurulu**, altında **Genişletilmiş Yönetim Kurulu** başlıkları altında anasayfadaki gibi **portre çerçeveleri**.
     - YK çerçeveleri: Başkan, Asbaşkan, Sekreter, Sayman, ve "Yönetim Kurulu Üyesi" (+ ekle düğmesiyle birden fazla).
     - GYK çerçeveleri: 9 komite (Hizmet Projeleri, Üyelik ve Üyeliği Geliştirme, Uluslararası Hizmetler, Halkla İlişkiler ve Tanıtım, Kulüp Hizmetleri, Meslek Hizmetleri, Afet, Hobi, Interact) — etiketler `ROLE_LABELS` ile aynı.
     - Boş çerçeve: gri portre silueti + görev adı. Dolu çerçeve: kişinin yuvarlak fotoğrafı (yoksa baş harfleri), adı, görev adı ve küçük "kaldır" (×) düğmesi.
   - **Çerçeveye tıklama** → seçici pencere açılır: üstte **Üyeler**, altında **Misafirler**, fotoğraflarıyla (misafirlerde baş harf), arama kutusuyla. Seçilen kişi o çerçeveye yerleşir.
   - **Sağ sütun**: tüm aktif üyeler ve ardından misafirler, **3 sütunlu ızgara**: yuvarlak fotoğraf ve altında yalnızca isim. Bir kişi tutulup sürüklenerek bir çerçeveye bırakılınca o çerçeveye yerleşir. Dolu çerçeveye bırakmak eskisini değiştirir. Çerçeveden çerçeveye sürüklemek taşır.
   - Bir kişi birden fazla çerçevede olabilir (engellenmez); sağ listede bir yere yerleşmiş kişiler soluk görünür.
   - Her değişiklik otomatik kaydedilir.
   - Bu yerleşim **kimseye görev/yetki vermez**; yalnızca taslaktır.
5. Kayıtların bugünkü panelde hiçbir yerde görünmemesi: taslak projeler bugünkü takvimde/Kulüp projelerinde, taslak aidatlar üyelerin "Aidat durumu"nda, taslak kasa kayıtları bugünkü kasada çıkmaz.

## Hedef dışı

- Dönemi panelden aktif yapma düğmesi (elle yapılacak; aşağıda adımlar).
- 2027-28 toplantılarının otomatik oluşturulması ve yoklama planlaması.
- Planlanan YK'nın 1 Temmuz'da otomatik görev alması.
- Mobilde sürükle-bırak (mobilde çerçeveye dokun → seçici yeterli).

## Kaçınılacaklar (başarısızlık sayılır)

- Taslak verinin bugünkü üyelere, başkana veya anasayfaya sızması.
- Taslak aidat taksitinin üyelere borç (charge) olarak yazılması.
- Bugünkü dönemin ekranlarının, planlama moduna girip çıkınca yanlış dönemi göstermesi.

## Yaklaşımlar

- **A. Gerçek ama pasif dönem kaydı (seçilen).** `terms` tablosuna `2027-28` satırı (`is_current=false`). Aidat/kasa/kasa grupları zaten `term_id` taşıyor; `projects` tablosuna `term_id` eklenir. Panel planlama modunda store'un "dönem" bilgisini bu satıra çevirir. Aktifleştirme tek adımdır, veri aktarımı gerekmez. Bedeli: dönem bilgisini dikkate almayan sorgular ve görünürlük kuralları elden geçmeli.
- B. Tamamen ayrı taslak belge: en risksiz ama ekranlar birebir aynı olmaz ve aktifleştirmede aktarım gerekir.
- C. Karma: iki farklı mantık bir arada; reddedildi.

Kullanıcı A'yı seçti.

## Kurgu (A)

### Veritabanı (v36)

- `public.is_planner()` → `has_role('asbaskan') or is_owner()` (security definer, authenticated'a execute).
- `public.term_is_current(uuid)` → verilen term_id null ise ya da `is_current` ise true.
- Plan dönemi satırı: `name='2027-28', start_date='2027-07-01', is_current=false`, `meeting_count=24`, `club_meeting_offset` = mevcut dönemin offset + meeting_count, `opening_balance=0`. Planlayıcı ilk girişte yoksa oluşturulur (RPC `ensure_plan_term()` ya da SQL'de bir kez eklenir — builder'ın kararı; tek satır, idempotent olmalı).
- `projects.term_id uuid null references terms(id)`; mevcut satırlar null kalır (= aktif dönem).
- Her dönem bağlı tabloda (`dues`, `charges` (dues üzerinden), `transactions`, `kasa_groups`, `projects`) **restrictive** RLS politikası: `for all using (term_is_current(term_id) or is_planner()) with check (term_is_current(term_id) or is_planner())`. Böylece mevcut izin verici politikalar aynen kalır, taslak satırlar yalnızca planlayıcıya açılır.
- Planlayıcının taslak dönemde yazabilmesi: ilgili tablolara izin verici politika `for insert/update/delete using/with check (not term_is_current(term_id) and is_planner())`.
- `term_board_plans(term_id uuid primary key references terms, slots jsonb not null default '{}', updated_at, updated_by)` — RLS: yalnızca `is_planner()` okur/yazar. `slots` biçimi: `{ "baskan": {"kind":"member","id":"…"}, "ykuye": [{…},{…}], "hizmet": {"kind":"guest","id":"…"}, … }`.
- `terms` select'i bugün herkese açıksa plan satırının adı görünür — kabul edilebilir (veri değil); istenirse restrictive ile gizlenebilir (builder: gizle).

### Panel

- `store.js`: `term()` yerine "görünüm dönemi" kavramı: `store.setPlanMode(true|false)`; plan modunda `term()` plan satırını döndürür. Dönem filtresi olmayan çağrılar (projeler listesi, takvim projeleri) plan modunda `term_id = plan.id`, normalde `term_id is null or term_id = current.id` ile filtrelenir. Yeni proje eklenirken plan modunda `term_id` plan dönemi olur.
- Plan modunda **aidat taksiti eklemek charge üretmez** (aktif üyelere borç yazılmaz).
- `app.js`: `PAGES` içinde Yönetim'e `{ id: "plan", label: "Gelecek dönemi planla", show: me => hasRole(me,"asbaskan") || me.is_owner }` (başkanın sahipliğe bağlı `hasRole` dönüşüne dikkat: sahip olmayan başkan görmemeli — `hasRole(me,"asbaskan")` sahip için de true döner, başkan için false; doğru).
- Plan modu durumu `sessionStorage` + URL hash öneki (`#plan/…`) ile tutulur; yenilemede korunur. Çıkınca normal panele döner ve dönem önbelleği temizlenir.
- Plan modunda yetki: `can(me, panel, "edit")` planlayıcı için takvim/projeler/aidat/kasa'da true.
- "Başkasının gözüyle gör" önizlemesinde plan sayfası listelenmez.
- Demo modu (`?demo`) da aynı davranışı desteklemeli (demo verisinde plan dönemi oluşturulur).

### Aktifleştirme (elle, 1 Temmuz 2027)

1. `update terms set is_current=false where is_current; update terms set is_current=true where name='2027-28';` (tek transaction).
2. Aktif üyeler için 2027-28 aidat taksitlerine charge üret (SQL verilecek).
3. Toplantıları oluştur.
4. YK planına bakıp görevleri panelden ata.

Bu adımlar `backend/schema.sql` içinde yorum olarak bırakılır.

## Builder'a kalanlar

- Görsel ayrıntılar mevcut panel stiline uyar (cranberry, `--bg-2`, yuvarlak portre). Portre boyutu, ızgara aralıkları.
- Sürükle-bırak HTML5 drag&drop ile; klavye erişimi için çerçeveye Enter = seçici.
- Testler: store plan modu ve RLS görünürlüğü (demo + canlıda planlayıcı olmayan hesapla okunmadığı doğrulanmalı).

## Gözden geçirme sonrası kararlar (Claude'un kararları)

1. **Türetilmiş veri sızıntısı:** Taslak dönemin kasa kaydı "Bağış" ise `tx_to_donation` tetikleyicisi bağışlar listesine **kopyalamaz** (aktif olmayan dönem satırı atlanır). Dönem tablolarını okuyan tüm `security definer` fonksiyonlar (ör. `convert_guest` — `dues.due_date >= p_joined` ile taksit borcu yazar) aktif dönemle sınırlanır. Builder `schema.sql` içinde `dues`, `charges`, `transactions`, `kasa_groups`, `projects` okuyan her fonksiyonu tarar.
2. **Borç üretimi:** Taksit borçları istemcide `createDue({ member_ids })` ile yazılıyor. Plan modunda `member_ids` boş gönderilir; ayrıca veritabanında `charges` için restrictive politika (bağlı `dues` aktif dönemde değilse yalnızca planlayıcı) ikinci emniyettir.
3. **`term_id` boş satırlar:** Mevcut boş satırlar aktif döneme aittir (`term_is_current(null)=true`). v36 bunları aktif dönemin id'siyle **doldurur** (backfill); plan modunda tüm tablolar `term_id = plan.id` ile süzülür.
4. **Takvim plan modunda:** yalnızca 2027-28 dönemine ait projeler (ve varsa o dönemin toplantıları). Diğer kulüplerin etkinlikleri ve doğum günleri planlama takviminde gösterilmez.
5. **Yazma yetkisi:** Taslak dönem satırlarında `is_planner()` mevcut rol kısıtlarının (sayman, hizmet vb.) yerine geçer; UI'da plan modunda bu dört ekran planlayıcı için düzenlenebilir.
6. **Misafirler:** `guests_select` `can_view_all` içeriyor, asbaşkan okuyabiliyor. Çerçevedeki kişi sonradan silinir/pasifleşirse çerçeve boş görünür ve "kişi artık listede değil" notu düşer.
