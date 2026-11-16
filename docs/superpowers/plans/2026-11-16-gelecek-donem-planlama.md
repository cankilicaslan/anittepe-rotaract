# Gelecek Dönemi Planla Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Asbaşkan ve site sahibi için 2027-28 dönemini taslak olarak planlayan "Gelecek dönemi planla" modu (YK planlama + Takvim, Kulüp projeleri, Aidat, Kulüp kasası).

**Architecture:** `terms` tablosunda pasif `2027-28` satırı; dönem tablolarına restrictive RLS ile "aktif dönem ya da planlayıcı" kuralı. Store'da "görünüm dönemi" (`setViewTerm`) — plan modunda tüm dönem sorguları plan dönemine yönelir. YK yerleşimi `term_board_plans.slots` (jsonb); saf mantık `uye/js/board-plan.js`'de.

**Tech Stack:** Vanilla ES modules, Supabase (Postgres RLS, supabase-js), node:test.

**Spec:** `docs/superpowers/specs/2026-11-16-gelecek-donem-planlama-design.md`

## Global Constraints

- Plan dönemi: `name='2027-28'`, `start_date='2027-07-01'`, bitiş 2028-06-30, `is_current=false`.
- Planlayıcı = `asbaskan` rolü ya da site sahibi (`is_owner`). Başkan, GDB, `can_view_all` sahipleri **planlayıcı değildir**.
- Ekran başlığı: "2027-2028 dönemi planlama". Menü öğesi: "Gelecek dönemi planla". Plan menüsü sırası: Yönetim kurulu planlama, Takvim, Kulüp projeleri, Aidat, Kulüp kasası.
- YK çerçeveleri: `baskan, asbaskan, sekreter, sayman` + `ykuye` (çoklu). GYK: `ROLE_GROUPS[1][1]` (9 komite), etiket `ROLE_LABELS`.
- Taslak aidat taksiti asla `charges` üretmez.
- Kişisel veri (isim) içeren SQL repoya yazılmaz.
- Önbellek damgası: `?v=YYYYMMDDHHMM` sed komutu; her yayında.

## Review Focus

1. Planlayıcı olmayan (başkan, GDB, üye) hesap taslak dönem satırlarını okuyamamalı — Task 1 SQL kimlik taklidiyle test.
2. Asbaşkan normal moddayken bugünkü Aidat/Kasa/Takvim ekranlarında taslak satır görmemeli — Task 2 testi (store süzgeci).
3. Plan modundan çıkınca bugünkü dönem önbelleği geri gelmeli (yanlış dönem göstermemeli) — Task 2/4.
4. Aynı kişiyi iki çerçeveye koymak ve çerçeveden çerçeveye taşımak — Task 3 testleri.
5. Silinmiş/pasif kişi çerçevede: boş + not — Task 3 testi (`resolveSlot`).

---

### Task 1: Veritabanı v36

**Files:**
- Modify: `backend/schema.sql` (sona v36 bloğu)

**Interfaces:**
- Produces: `public.is_planner() returns boolean`, `public.term_is_current(uuid) returns boolean`, `public.ensure_plan_term() returns public.terms` (planlayıcı değilse hata; idempotent; `club_meeting_offset` = aktif offset + aktif meeting_count, `meeting_count=24`, `opening_balance=0`), `projects.term_id uuid`, tablo `public.term_board_plans(term_id uuid pk → terms on delete cascade, slots jsonb not null default '{}', updated_at timestamptz default now(), updated_by uuid)`.

- [ ] **Step 1:** v36 SQL'i yaz:
  - Fonksiyonlar (security definer, `search_path=public`, authenticated'a execute).
  - `projects.term_id` ekle + index.
  - Backfill: `dues`, `transactions`, `kasa_groups`, `projects`'te `term_id is null` → aktif dönem id.
  - Restrictive politikalar `<tablo>_term_gate` (`as restrictive for all to authenticated using (term_is_current(term_id) or is_planner()) with check (aynı)`): dues, transactions, kasa_groups, projects. `charges` için `exists (select 1 from dues d where d.id = due_id and (term_is_current(d.term_id) or is_planner()))`.
  - Planlayıcı yazma: dues, transactions, kasa_groups, projects için permissive `<tablo>_planner_write` (insert/update/delete) `not term_is_current(term_id) and is_planner()`.
  - `projects_select_public` (anon) restrictive kapıdan etkilenmez; anon için ek restrictive `projects_anon_gate`: `term_is_current(term_id)`.
  - `term_board_plans` RLS: yalnızca `is_planner()` (select/insert/update).
  - `terms` için restrictive select: `is_current or is_planner()`.
  - `tx_to_donation` tetikleyicisi: `not term_is_current(new.term_id)` ise kopyalama.
  - `convert_guest`: taksit borcu sorgusuna `and public.term_is_current(d.term_id)` ekle.
  - Diğer `security definer` fonksiyonları tara (`grep -n "security definer" backend/schema.sql`); `dues|transactions|kasa_groups|projects` okuyan her birine aynı süzgeç.
  - Aktifleştirme adımlarını yorum olarak ekle.
- [ ] **Step 2:** Supabase SQL editöründe çalıştır (Potential issue → Run query).
- [ ] **Step 3: Doğrula** (SQL editörü, isim içermeyen sorgular):
  - `select is_current, count(*) from terms group by 1` → yalnızca 1 aktif.
  - Kimlik taklidiyle (`set local role authenticated; select set_config('request.jwt.claims', json_build_object('sub', <başkan id>)::text, true);` — id'yi sorguyla al, ekrana yazma) `ensure_plan_term()` → hata; asbaşkan id'siyle → satır döner.
  - Asbaşkan olarak plan dönemine bir `dues` satırı ekle; başkan kimliğiyle `select count(*) from dues where term_id = <plan>` → 0; asbaşkan → 1; sonra test satırını sil.
- [ ] **Step 4:** Commit `v36: gelecek dönem planlama (pasif dönem, planlayıcı RLS)`.

### Task 2: Store — görünüm dönemi ve YK planı

**Files:**
- Modify: `uye/js/store.js`

**Interfaces:**
- Produces (her iki store'da): `setViewTerm(t|null)`, `getViewTerm() → term|null`, `ensurePlanTerm() → term`, `getBoardPlan() → {slots}`, `saveBoardPlan(slots) → void`.
- Davranış: `term()` = `viewTerm || aktif`. `listDues`, `listCharges` (dues'u o döneme ait olanlar), `listTransactions`, `listKasaGroups`, `listProjects`, `listCalendarProjects`, `saveProject` (yeni kayıtta `term_id`), `createDue` (plan modunda `member_ids` yok sayılır) görünüm dönemine göre süzer. Supabase: `.eq("term_id", t.id)`; demo: `S.planTerm` + aynı süzgeç (eski demo kayıtlarına `term_id` yoksa aktif sayılır).
- Demo `need()` kontrolü: plan modunda planlayıcı için bu dört panelde geçer.

- [ ] **Step 1:** Demo store'da plan modunu `node` ile çalıştıran test yaz: `tests/plan-store.test.mjs` — localStorage/`location` sahtesiyle `createStore()` demo; asbaşkan girişi; `ensurePlanTerm()` → `name==="2027-28"`; `setViewTerm(plan)` → `createDue({label:"x",amount:1,due_date:"2027-07-15",member_ids:[id]})` sonrası `listCharges()` bu due için 0; `setViewTerm(null)` → `listDues()` "x"i içermez; başkan girişiyle `ensurePlanTerm()` hata.
- [ ] **Step 2:** Testi çalıştır, başarısız olsun: `node --test tests/plan-store.test.mjs`.
- [ ] **Step 3:** Uygula.
- [ ] **Step 4:** Test + mevcut testler geçsin: `node --test tests/`.
- [ ] **Step 5:** Commit.

### Task 3: YK planı saf mantığı

**Files:**
- Create: `uye/js/board-plan.js`, `tests/board-plan.test.mjs`

**Interfaces:**
- Produces:
  - `BOARD_SLOTS = ["baskan","asbaskan","sekreter","sayman"]`, `MULTI = "ykuye"`
  - `place(slots, key, person, index?) → slots` (yeni nesne; `person = {kind:"member"|"guest", id}`; `ykuye` dizi, `index` yoksa sona ekler)
  - `clear(slots, key, index?) → slots`
  - `move(slots, from:{key,index?}, to:{key,index?}) → slots` (hedef doluysa kaynakla yer değiştirir)
  - `placedIds(slots) → Set<string>` (`kind:id`)
  - `resolveSlot(ref, members, guests) → {person}|{missing:true}|null` (pasif/silinmiş üye ya da silinmiş misafir → `missing`)

- [ ] **Step 1:** Testler: tek çerçeveye yerleştir; dolu çerçeveye yerleştir → değişir; `ykuye`'ye iki kişi; aynı kişi iki çerçevede (izinli); `move` boş hedefe taşır, dolu hedefle yer değiştirir; `clear` ykuye index; `placedIds` iki çerçevedeki kişiyi bir kez sayar; `resolveSlot` pasif üye → `{missing:true}`.
- [ ] **Step 2–4:** Kırmızı → uygula → yeşil (`node --test tests/board-plan.test.mjs`).
- [ ] **Step 5:** Commit.

### Task 4: Panel — plan modu, menü, yetki

**Files:**
- Modify: `uye/js/app.js`, `uye/js/roles.js`, `uye/css/panel.css`

**Interfaces:**
- Consumes: Task 2 store API.
- Produces: `isPlanner(me) → boolean` (roles.js: `hasRole(me,"asbaskan")` — sahip için de true, başkan için false), plan modu durum değişkeni `plan` (`null | term`), hash rotaları `#plan/yk`, `#plan/takvim`, `#plan/kulup-projeleri`, `#plan/aidat`, `#plan/kasa`.

- [ ] **Step 1:** `PAGES` Yönetim'e `{ id: "plan", label: "Gelecek dönemi planla", show: me => isPlanner(me) }` (önizleme listesinde çıkmasın).
- [ ] **Step 2:** `#plan…` rotası: planlayıcı değilse `#profil`'e at. Girişte `store.ensurePlanTerm()` → `store.setViewTerm(t)`; menü yalnızca plan sayfaları + "Planlamadan çık"; üst şerit "2027-2028 dönemi planlama · taslak". Plan dışı rotaya gidince `setViewTerm(null)`.
- [ ] **Step 3:** Mevcut `viewCalendar`, `viewClubProjects`, `viewDues`, `viewTreasury` plan modunda yeniden kullanılır; `can(...,"edit")` plan modunda planlayıcı için bu panellerde true (`can` çağrılarını sarmalayan `canEdit(panel)` ya da `me`'nin plan modunda geçici `planEdit` bayrağı — tek yerde). Takvim plan modunda diğer kulüp etkinliklerini ve doğum günlerini göstermez; yeni proje/takvim kaydı formunun tarih alanı `min=2027-07-01 max=2028-06-30`.
- [ ] **Step 4:** Demo'da doğrula (`?demo`, asbaşkan): menüde öğe var; başkan girişinde yok; plan modunda aidat ekle → bugünkü Aidat'ta görünmez; çık → bugünkü veriler.
- [ ] **Step 5:** Commit.

### Task 5: Yönetim kurulu planlama ekranı

**Files:**
- Modify: `uye/js/app.js` (`viewBoardPlan(v)`), `uye/css/panel.css` (`.bp-*`)

**Interfaces:**
- Consumes: Task 3 fonksiyonları, `store.getBoardPlan/saveBoardPlan`, `store.listMembers`, `store.listGuests`, `avatar()`.

- [ ] **Step 1:** Yerleşim: solda başlık "Yönetim Kurulu" + 4 çerçeve + ykuye çerçeveleri ve "+ Üye ekle"; "Genişletilmiş Yönetim Kurulu" + 9 komite çerçevesi. Sağda yapışkan (`position:sticky`) 3 sütunlu kişi ızgarası: önce aktif üyeler, sonra "Misafirler" başlığıyla misafirler; yuvarlak fotoğraf + yalnızca isim; yerleşmiş kişi `opacity:.45`. Mobilde (≤860px) sağ sütun gizlenir.
- [ ] **Step 2:** Etkileşim: çerçeve tıkla/Enter → seçici `<dialog>` (arama + Üyeler + Misafirler, fotoğraflı); seçim `place`. HTML5 sürükle-bırak: kişi kartı `draggable`, çerçeve `dragover/drop`; çerçeveden çerçeveye `move`; × → `clear`. Her değişiklikte `saveBoardPlan` (300 ms debounce) ve "Kaydedildi" durumu.
- [ ] **Step 3:** Demo'da doğrula: sürükle-bırak (JS ile `DragEvent` gönder), seçici, yenileyince yerleşim duruyor; ekran görüntüsü.
- [ ] **Step 4:** Commit.

### Task 6: Yayın ve canlı doğrulama

- [ ] **Step 1:** Önbellek damgası, `node --check`, `node --test tests/`.
- [ ] **Step 2:** Push (dal + main, hızlı ileri kontrolü).
- [ ] **Step 3:** Canlı: yeni kod yayında (curl); SQL ile `term_board_plans`/plan dönemi var; başkan kimliği taklidiyle plan satırı görünmüyor.
