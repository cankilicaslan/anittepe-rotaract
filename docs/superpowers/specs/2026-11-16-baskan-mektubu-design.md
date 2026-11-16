# Başkan Mektubu oluşturucu: tasarım

Tarih: 16 Kasım 2026 · Durum: onay bekliyor (okuyucu kontrolü yapıldı, kullanıcı soruları cevaplandı)

## Amaç ve neden

Kulüp iki ayda bir "Başkan Mektubu" yayımlıyor (örnek: *Temmuz - Ağustos 2026, Sayı 1*, 11 sayfa, 4:5 dikey, pembe gradyan tasarım). Bugün bu mektup elle, bir tasarım programında hazırlanıyor. Amaç, mektubu üye panelinden hazırlamak, PDF olarak indirmek ve aynı mektubu sitede yayımlamak. Proje ve etkinlik anlatımlarını yazmak için yapay zekâ desteği de olacak.

## Kimler kullanır

- **Düzenleyebilenler:** Başkan, Sekreter ve Kulüp Hizmetleri Komitesi Başkanı (Edin Eren Çimciler).
  - Panelde bu rol yok. Yeni bir rol eklenecek: `kulup`, etiketi "Kulüp Hizmetleri".
  - Rolü Başkan, üye yönetiminden işaretleyerek verir.
  - Edin Eren şu an misafir listesinde. Panel hesabı yoksa önce davet edilmesi gerekir; bu, kurulum adımında kontrol edilir.
- **Görüntüleyebilenler:** Asbaşkan, yönetim panellerinde olduğu gibi yalnızca görüntüleyebilir.
- **Okuyucular:** Yayımlanan mektubu sitede herkes okur.

## Hedefler

1. **Elle oluştur**
   - "Sayfa ekle" denince sayfa düzeni şablonlarından biri seçilir.
   - Fotoğraflar alanlara sürükle-bırakla (ya da tıklayıp seçerek) yerleşir.
   - Yazılar ilgili kutulara yazılır.
   - Sayfalar sıralanabilir, silinebilir ve çoğaltılabilir.
2. **Yapay zekâ ile oluştur**
   - Mektubun bölümleri için başlıkları net klasörler vardır.
   - Proje ve etkinlik klasörleri yeniden adlandırılabilir; içlerinde görseller ve kısa açıklama alanı bulunur.
   - Hepsi dolduğunda "Yapay zekâ ile oluştur" düğmesi, örnek mektubun düzeninde sayfaları kurar.
   - Sonuç, elle düzenleyiciye açılır ve orada düzeltilebilir.
3. **Yapay zekânın kapsamı:** Yalnızca proje, etkinlik ve toplantı anlatımlarında ("Neler Yaptık?") kullanılır. Elle düzenleyicide de bu sayfalardaki metin kutularında "Yapay zekâ ile yaz" düğmesi bulunur.
4. **PDF indirme:** Sayfalar keskin ve yazıları seçilebilir biçimde PDF olur. Tarayıcının yazdırma penceresinden "PDF olarak kaydet" seçilir.
5. **Sitede yayın:** `anitteperotaract.org/mektup/` adresinde yayımlanmış sayılar listelenir ve okunur. Anasayfadan bağlantı verilir.

## Hedef dışı

- Kişisel bölümlerde (Başkan Mektubu, Yönetim Kurulu Mesajları, Anıttepeliler Köşesi) yapay zekâ yoktur. Bu yazılar kişinin kendi metnidir ve yalnızca elle girilir.
- Sunucuda PDF üretilmez.
- Birden fazla kişinin aynı anda canlı düzenlemesi desteklenmez.
  - Son kaydeden kazanır.
  - Kaydetmeden önce başka biri kaydetmişse uyarı gösterilir.
- İngilizce site sürümü için mektup yoktur. Mektup Türkçedir; İngilizce sitede yalnızca bağlantı bulunur.

## Başarısızlık sayılacak durumlar

- Yapay zekânın notlarda olmayan kişi, sayı veya olay uydurması.
- Yapay zekânın birinin ağzından kişisel yazı yazması.
- PDF'te Türkçe karakterlerin bozulması, sayfaların bölünmesi ya da renklerin solması.
- Taslak bir mektubun sitede görünmesi.
- Kişisel veri (telefon, e-posta) içeren bir şeyin herkese açık depoya düşmesi.

## Yaklaşımlar

| Yaklaşım | Artısı | Eksisi |
|---|---|---|
| **A. Sayfalar HTML ve CSS ile çizilir, PDF tarayıcının yazdırma özelliğiyle alınır (seçilen)** | Tek kaynak: panel önizlemesi, site ve PDF aynı şablondan çıkar. PDF'te yazılar keskin ve seçilebilir, dosya küçük. Sitede metin olarak durur, aranır ve okunur. | PDF için yazdırma penceresinde bir adım fazladan. |
| B. Sayfalar canvas üzerinde resim olarak çizilir, PDF jsPDF ile tek tıkla iner | Her cihazda birebir aynı görünür. | Yazılar resim olur: seçilemez, aranmaz, mobilde zor okunur. Dosya büyük olur. |
| C. PDF sunucuda üretilir | Tek tıkla iner. | Türkçe yazı tipi gömme ve düzen motoru yazmak gerekir; çok emek ister. |

Kullanıcı A'yı seçti.

## Örnek mektuptan çıkarılan yapı (sayfa düzenleri)

Sayfa ölçüsü 810×1012'dir (4:5), zemin pembe-kırmızı gradyandır. Sağ altta küçük beyaz logo, sayfaların çoğunda da ince dekoratif şekiller vardır. Düzenler şunlardır:

| Kod | Düzen | Alanlar |
|---|---|---|
| `kapak` | Kapak | sayı ("Sayı 1"), dönem ("Temmuz - Ağustos 2026"), başlık ("Başkan Mektubu"), isteğe bağlı kapak fotoğrafı, logo |
| `kunye` | Künye | unvan ve isim satırları listesi (Rotary yöneticileri ve kulüp yönetim kurulu). Varsayılan liste panelden doldurulur ve düzenlenebilir. |
| `icindekiler` | Sayı'da Neler Var? | mektuptaki bölüm başlıklarından otomatik oluşur |
| `baskan` | Başkan Mektubu | portre fotoğrafı, uzun metin, imza (isim, kulüp, unvan) |
| `mesaj-2` | Yönetim Kurulu Mesajları ×2 | iki metin, ikişer imza bloğu |
| `mesaj-1` | Yönetim Kurulu Mesajı ×1 ve görsel | bir metin, bir imza, bir büyük görsel (çizim ya da fotoğraf) |
| `kose` | Anıttepeliler Köşesi | iki sütun; her sütunda metin, imza ve yuvarlak fotoğraf |
| `neler-2` | Neler Yaptık? ×2 | iki madde; her birinde polaroid fotoğraf, fotoğraf altı etiketi ("600 / 1. Toplantımız"), metin. Fotoğraflar sırayla solda ve sağda. |
| `neler-1` | Neler Yaptık? ×1 | tek madde, büyük fotoğraf ve metin |
| `neler-tam` | Neler Yaptık? tam sayfa | uzun metinli tek madde; etiket, metin, 2 ile 4 fotoğraflık kolaj |
| `serbest` | Serbest sayfa | başlık, metin ve 1 ile 4 fotoğraflık ızgara |

Yazı tipi olarak sitenin yazı tipi Open Sans kullanılır. Örnek mektuptaki tipografiye en yakın seçenek budur.

## Elle oluştur ekranı

```
┌ Başkan Mektubu ─ Sayı 2 · Eylül - Ekim 2026 ─ [Taslak ▾] [Kaydet] [PDF indir] [Yayınla] ┐
│ Sayfalar (küçük resimler, sürükleyerek sıralama)  │  Seçili sayfanın büyük önizlemesi     │
│ [1 Kapak] [2 Künye] [3 İçindekiler] …            │  ┌──────────────┐  Alanlar:          │
│ [+ Sayfa ekle] → düzen seçici (küçük resimlerle)  │  │ fotoğraf alanı│  • Metin kutuları  │
│                                                   │  │ (bırak/seç)   │  • ✦ Yapay zekâ    │
│                                                   │  └──────────────┘    ile yaz         │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

- Önizlemede alanlara doğrudan yazılabilir ve fotoğraf doğrudan bırakılabilir. Yanda da aynı alanları gösteren bir form vardır; mobilde form tercih edilir.
- Fotoğraf alanında, Instagram ekranındaki gibi sürükleyerek konumlandırma ve yakınlaştırma yapılır.
- Metin sayfaya sığmazsa sayfada uyarı rozeti çıkar. Yazı otomatik küçültülmez.

## Yapay zekâ ile oluştur ekranı

Klasör listesi şöyledir:

1. **Kapak ve Künye:** sayı numarası, ay aralığı, isteğe bağlı kapak fotoğrafı, künye listesi (hazır gelir).
2. **Başkan Mektubu:** fotoğraf ve metin (elle).
3. **Yönetim Kurulu Mesajları:** kişi ekle; her biri için kişi seçimi, metin (elle) ve isteğe bağlı görsel.
4. **Anıttepeliler Köşesi:** kişi ekle; her biri için kişi seçimi (üye veya misafir), metin (elle) ve fotoğraf.
5. **Neler Yaptık?:** Ay aralığındaki toplantılar, toplantı listesinden hazır klasör olarak gelir.
   - Toplantı klasörünün adı "600 / 1. Toplantımız" biçiminde, toplantı listesindeki numarayla otomatik oluşur.
   - "Proje ekle" ve "Etkinlik ekle" ile yeni klasör açılır; bunların adı yeniden adlandırılabilir.
   - Her klasörde: görseller (sürükle-bırak, birden çok), kısa açıklama (notlar) ve isteğe bağlı fotoğraf altı etiketi.

"Yapay zekâ ile oluştur" düğmesi:
- Klasörlerin eksiklerini listeler. Örneğin fotoğrafı olmayan proje bu listede çıkar.
- Neler Yaptık? klasörleri için metinleri yapay zekâya yazdırır.
- Sayfaları şu sırayla kurar: kapak, künye, içindekiler, başkan, mesajlar, köşe, neler yaptık. Neler Yaptık? maddeleri sayfa başına iki tane, toplantı sırasıyla yerleşir.
- Sonucu elle düzenleyiciye açar.
- Klasörlere sonradan dönülüp yeniden oluşturulursa düzenleyicide elle yapılan değişikliklerin silineceği uyarısı gösterilir.

## Yapay zekâ

- Supabase'te yeni bir edge fonksiyonu olur: `letter-ai`. Yapısı mevcut `caption` fonksiyonuyla aynıdır: Claude, `claude-opus-5-5`, düşük effort.
- **Girdi:** madde listesi. Her maddede tür (toplantı, proje, etkinlik, ocakbaşı), başlık, toplantı numaraları, tarih ve notlar bulunur.
- **Çıktı:** her madde için tek paragraf, 50 ile 80 kelime. Örnek mektuptaki dil kullanılır: "Kulübümüzün 603., dönemimizin 4. toplantısında…" biçiminde başlar, sıcak ve kurumsal bir ton taşır, birinci çoğul şahısla yazılır.
- **Kurallar:**
  - Notlarda olmayan bilgi eklenmez.
  - Ocakbaşı gerçek bir ocakbaşı gibi anlatılmaz; ev sahibi "…'nın ev sahipliğinde" kalıbıyla anılır.
  - Uzun tire kullanılmaz.
- **Yetki:** Fonksiyonu Başkan, Sekreter ve `kulup` rolündekiler çağırabilir.

## Veri

**Tablo `letters`:**

| Alan | Açıklama |
|---|---|
| `id` | kimlik |
| `term_id` | dönem |
| `issue_no` | sayı numarası |
| `period` | metin, ör. "Temmuz - Ağustos 2026" |
| `status` | `taslak` veya `yayinda` |
| `pages` | jsonb: `[{id, layout, fields:{…}, photos:{slot:{path, pos, zoom}}}]` |
| `folders` | jsonb: yapay zekâ modunun girdileri |
| `published_at` | yayın zamanı |
| `updated_at` | son değişiklik zamanı |
| `updated_by` | son değiştiren |

**Erişim kuralları (RLS):**
- Yayındaki mektupları herkes okuyabilir (anon dahil).
- Taslakları yalnızca düzenleyiciler ve görüntüleme yetkisi olanlar okuyabilir.
- Yazma yetkisi Başkan, Sekreter ve `kulup` rolündedir.

**Depo:**
- Mektup görselleri için herkese açık yeni bir depo kovası açılır: `letters`.
  - Yol: `<letter_id>/<uuid>.jpg`.
  - Okuma herkese açık; yazma ve silme yalnızca düzenleyicilere.
- Görseller yüklenmeden önce tarayıcıda en fazla 1600 piksele küçültülüp JPEG'e çevrilir.

**Rol:** `profiles_roles_chk` kısıtına `kulup` eklenir. Panelde `ROLE_LABELS` içine "Kulüp Hizmetleri" eklenir ve `OWNER.mektup = ["kulup", "sekreter"]` tanımlanır. Başkan zaten her panele erişebiliyor.

## Sitede yayın

- Yeni statik sayfa `site/mektup/index.html`. Veriyi Supabase'ten anonim anahtarla çeker.
  - **Liste görünümü:** yayımlanmış sayılar, kapak küçük resimleriyle.
  - **Okuma görünümü:** `?sayi=N` parametresiyle açılır, sayfalar alt alta dizilir. Ekran genişliğine göre ölçeklenir; telefonda tam genişlikte gösterilir.
  - Okuma görünümünde "PDF indir" düğmesi de bulunur.
- Sayfaları çizen tek ortak modül `site/assets/js/letter-render.js` olur. Panel ve site bu modülü birlikte kullanır.
- Anasayfadaki "Haberler" bölümüne "Başkan Mektupları" bağlantısı eklenir. Ayrıca `sitemap.xml` dosyasına `/mektup/` adresi eklenir.

## PDF

- `@page { size: 810px 1012px; margin: 0 }` kullanılır. Her sayfa `break-after: page` ile ayrılır, gradyanlar `print-color-adjust: exact` ile korunur.
- "PDF indir" düğmesi, yazdırmaya hazır bir görünüm açıp `window.print()` çağırır. Kullanıcıya "Hedef: PDF olarak kaydet" ipucu gösterilir.
- Chrome, Edge ve Safari'de doğrulanır.

## Kısıtlar

- Statik site GitHub Pages'te çalışır. Derleme adımı yoktur; ES modülleri kullanılır.
- Panel mevcut yapıya eklenir: `app.js` içinde PAGES girişi, `store.js` içinde demo ve Supabase metodları.
- Önbellek kırma için mevcut `?v=` düzeni kullanılır.
- Kişisel veri depoya ve herkese açık repoya girmez. İsimler mektup içeriğinin parçasıdır ve yalnızca yayımlanınca herkese açılır.
- Demo modu (`?demo`) bu bölümü de örnek verilerle göstermelidir.

## Kullanıcının kararları

- **Yayınlama:** Mektubu yalnızca Başkan yayınlayabilir ve yayından kaldırabilir. Sekreter ve Kulüp Hizmetleri hazırlar ve kaydeder. Bu kural veritabanında da uygulanır: yayın işlemi, başkan rolünü kontrol eden bir `publish_letter` / `unpublish_letter` fonksiyonuyla yapılır. Diğer düzenleyiciler `published_pages` ve `status` alanlarını değiştiremez.
- **Uzun metinli projeler ve etkinlikler:** Metni uzun olan madde kendi sayfasına çıkar ve klasördeki fotoğraflardan daha fazlası kullanılır. Bunun için yeni bir düzen eklenir:
  - **`neler-tam` düzeni:** tek madde için tam sayfa; başlık etiketi, metin ve 2 ile 4 fotoğraflık bir kolaj içerir.
  - **Uzun metin eşiği (Claude'un kararı):** 90 kelimeyi aşan metin uzun sayılır. Bu, iki maddeli sayfaya sığan yaklaşık sınırdır.
  - **Kısa metinli maddeler:** İkişer ikişer `neler-2` sayfalarına yerleşir. Bu maddelerde klasördeki fotoğraflardan biri yıldızla seçilir; seçim yoksa ilk fotoğraf kullanılır.
  - **Elle düzenleyicide:** Metin uzarsa sayfada "Bu madde tam sayfaya taşınsın mı?" önerisi çıkar.

## Okuyucu kontrolünden sonra verilen kararlar (Claude'un kararı, onayda kontrol edilecek)

- **Yayındaki mektubu düzenlemek:** Sitede, en son "Yayınla"ya basılan sürüm görünür. Tabloya bu sürüm için ayrıca `published_pages` eklenir; anonim okuma yalnızca bu alanı ve yayın bilgilerini görür. Kaydetmek taslağı günceller. Yarım kalmış düzeltmeler siteye çıkmaz. "Yayından kaldır" düğmesi de vardır.
- **Sayı numarası:** Her dönem 1'den başlar. Benzersizlik `(term_id, issue_no)` üzerindedir. Site adresi `?donem=2026-27&sayi=1` biçimindedir.
- **Proje ve etkinlik klasörleri:** Toplantılar, toplantı listesinden otomatik gelir. Projeler, etkinlikler ve ocakbaşları "ekle" düğmeleriyle elle açılır. Klasör türü seçilebilir: proje, etkinlik ya da ocakbaşı. Mevcut proje tablosundan otomatik çekme bu sürümde yoktur.
- **Kişi fotoğrafları:** Kişi seçildiğinde profil fotoğrafı varsayılan olarak gelir ve `letters` deposuna kopyalanır. Fotoğraf değiştirilebilir.
- **Misafirler:** Misafir isimleri, yalnızca isim döndüren `guest_names()` fonksiyonundan gelir. Bu fonksiyon `kulup` rolüne de açılır. Telefon ve e-posta hiçbir zaman okunmaz.

## Kurucuya bırakılanlar

- Dekoratif şekillerin tam çizimi. Yön: örnek mektuptaki gradyan ve hafif geometrik şekiller.
- Düzen seçicideki küçük resimlerin görünümü.
- Metin taşma eşikleri.
- Künye listesinin varsayılan içeriği. Kulüp yönetimi panelden gelir; Rotary yöneticileri bir ayar olarak tutulur ve düzenlenebilir.
