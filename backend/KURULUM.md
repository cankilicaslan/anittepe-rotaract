# Üye Paneli Kurulum Rehberi

Bu rehber, Anıttepe Rotaract üye panelini (`/uye/`) gerçek verilerle, gerçek giriş sistemiyle çalıştırmak için gereken adımları anlatır. Yazılım bilgisi gerekmez; adımları sırayla izleyin.

Panel kurulum yapılmadan da açılır: bu durumda **demo modunda** çalışır, veriler yalnızca o tarayıcıda tutulur ve güvenli değildir. Gerçek kullanım için aşağıdaki adımlar gerekir.

## Ne kadar tutar?

| Hizmet | Ne için | Ücret |
|---|---|---|
| Supabase (Free plan) | Üye girişi, veritabanı, fotoğraflar, sunucu fonksiyonları | Ücretsiz. Not: 1 hafta hiç kullanılmayan ücretsiz projeler duraklatılır; panelden tek tıkla yeniden başlatılır. |
| GitHub Pages | Sitenin yayınlanması | Ücretsiz |
| Claude API (Anthropic) | "Yapay zekâ ile açıklama yaz" düğmesi | **Kullandıkça ücretli.** Her açıklama üretimi küçük bir ücret doğurur; önceden kredi yüklenir. İsteğe bağlıdır: kurulmazsa panel hazır şablonla açıklama üretir. |
| Instagram / Meta | Panelden doğrudan paylaşım | Ücretsiz |

---

## 1. Supabase projesi oluşturun

1. https://supabase.com adresine gidin, **Start your project** ile (GitHub hesabınızla veya e-postayla) üye olun.
2. **New project** deyin.
   - Name: `anittepe-rotaract`
   - Database Password: güçlü bir şifre üretin ve bir yere kaydedin (günlük kullanımda gerekmez).
   - Region: **Central EU (Frankfurt)** (Türkiye'ye en yakın).
   - Plan: **Free**.
3. Proje hazırlanırken 1-2 dakika bekleyin.

## 2. Veritabanını kurun (schema.sql)

1. Sol menüden **SQL Editor**'ı açın, **New query** deyin.
2. Bu klasördeki `schema.sql` dosyasını bir metin düzenleyiciyle (Not Defteri olur) açın, tamamını kopyalayıp SQL Editor'a yapıştırın.
3. Sağ alttaki **Run** düğmesine basın. "Success. No rows returned" görmelisiniz.

Bu adım tabloları, erişim kurallarını, fotoğraf klasörlerini (`avatars`, `posts`) ve 2026-27 dönemini (24 toplantı, ilki 2 Temmuz 2026, 14 günde bir) oluşturur. Dosyayı ileride tekrar çalıştırmak güvenlidir; mevcut veriler silinmez.

## 3. Giriş ayarları (Authentication)

1. Sol menü: **Authentication > Sign In / Providers**. **Email** açık olsun (varsayılan olarak açıktır).
2. **Confirm email** seçeneği:
   - Açık bırakırsanız yeni üyeler e-postalarındaki bağlantıya tıklayınca hesapları etkinleşir. Supabase'in ücretsiz e-posta servisi saatte çok az e-posta gönderebilir.
   - Kapatırsanız üyeler hemen giriş yapabilir. Zaten her yeni üye başkan onaylayana kadar "onay bekliyor" durumunda kalır, bu yüzden kapatmak güvenlidir ve önerilir.
3. **Authentication > URL Configuration**:
   - **Site URL**: `https://cankilicaslan.github.io/anittepe-rotaract/uye/`
   - **Redirect URLs** kısmına da aynı adresi ekleyin: `https://cankilicaslan.github.io/anittepe-rotaract/uye/**`

## 4. Paneli Supabase'e bağlayın (config.js)

1. Supabase'de **Project Settings > API** (veya **Project Settings > API Keys**) sayfasını açın.
2. İki değeri kopyalayın:
   - **Project URL** (ör. `https://abcdefgh.supabase.co`)
   - **anon public** anahtarı (uzun bir metin, `eyJ...` ile başlar)
3. Sitedeki `site/uye/js/config.js` dosyasını açıp doldurun:

```js
export const CONFIG = {
  SUPABASE_URL: "https://abcdefgh.supabase.co",
  SUPABASE_ANON_KEY: "eyJ..."
};
```

4. Değişikliği GitHub'a gönderin (commit + push). Birkaç dakika içinde site güncellenir.

> **Güvenlik:** `anon` anahtarının herkese açık olması sorun değildir; verileri asıl koruyan veritabanındaki erişim kurallarıdır (RLS). **`service_role` anahtarını ise asla** `config.js`'e, GitHub'a veya herhangi bir mesaja yazmayın; bu anahtar tüm kuralları aşar.

## 5. İlk başkanı atayın

1. Sitede `/uye/` sayfasını açın, **Kayıt ol** ile kendi hesabınızı oluşturun (ad soyad, telefon, e-posta, şifre).
2. Supabase **SQL Editor**'da yeni bir sorguya şu satırı yazın, e-postayı kendinizinkiyle değiştirip **Run** deyin:

```sql
update profiles set status='active', roles='{baskan}', title='Başkan' where email='sizin@epostaniz.com';
```

3. Panele tekrar giriş yapın. Artık başkansınız: yeni üyeleri **Üyeler** bölümünden onaylayabilir, diğer görevlere (sayman, sekreter, PR, hizmet) rol ve unvan atayabilirsiniz. Geçmiş dönem başkanlarına "geçmiş başkan" işaretini de buradan verebilirsiniz; onlar her paneli yalnızca görüntüler.

Bundan sonra SQL'e gerek kalmaz, her şey panelden yapılır.

## 6. Sunucu fonksiyonlarını yükleyin (yapay zekâ ve Instagram için)

Bu adım yalnızca "yapay zekâ ile açıklama" ve "Instagram'da paylaş" düğmeleri için gerekir. Atlarsanız panelin geri kalanı sorunsuz çalışır; PR paneli görseli indirip açıklamayı kopyalamanızı önerir.

### 6.1 Hazırlık (bir kez)

1. Bilgisayarınıza **Node.js** kurun: https://nodejs.org (LTS sürümü).
2. **Komut İstemi** (veya PowerShell) açın ve bu `backend` klasörüne gidin:

```
cd yol\site\backend
```

3. Supabase'e giriş yapın (tarayıcı açılır, onaylayın):

```
npx supabase login
```

4. Supabase CLI fonksiyonları `supabase\functions` klasöründe arar. Bir kez şunları çalıştırın:

```
npx supabase init
xcopy /E /I functions supabase\functions
```

   (`init` sorularına varsayılan cevapları verebilirsiniz. `functions` klasöründeki dosyaları güncellerseniz `xcopy` komutunu `/Y` ekleyerek tekrar çalıştırın.)

5. Projenize bağlanın. **Project ref**, Supabase proje adresinizdeki kısa koddur (`https://abcdefgh.supabase.co` için `abcdefgh`):

```
npx supabase link --project-ref abcdefgh
```

### 6.2 Fonksiyonları yükleyin

```
npx supabase functions deploy caption
npx supabase functions deploy instagram-publish
```

### 6.3 Gizli anahtarları (secrets) girin

Bu anahtarlar yalnızca Supabase sunucusunda saklanır, siteye veya GitHub'a gitmez.

```
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
npx supabase secrets set IG_USER_ID=1784...
npx supabase secrets set IG_ACCESS_TOKEN=EAAG...
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` ve `SUPABASE_SERVICE_ROLE_KEY` Supabase tarafından fonksiyonlara otomatik verilir; bunları girmenize gerek yoktur.

Secrets'ları Supabase panelinden de girebilirsiniz: **Edge Functions > Secrets**.

## 7. Claude API anahtarı (yapay zekâ açıklamaları)

1. https://console.anthropic.com adresinde hesap açın.
2. **Billing** bölümünden kredi yükleyin. Kullandıkça bu krediden düşülür. Beklenmedik harcamaya karşı **Limits** bölümünden aylık harcama sınırı koymanız önerilir.
3. **API Keys > Create Key** ile anahtar oluşturun (`sk-ant-` ile başlar) ve 6.3'teki komutla `ANTHROPIC_API_KEY` olarak girin.

Açıklamayı yalnızca PR ve Başkan rolündeki üyeler üretebilir.

## 8. Instagram'dan doğrudan paylaşım

### Gerekenler

- Kulübün Instagram hesabı **profesyonel hesap** (İşletme/Business veya İçerik Üreticisi/Creator) olmalı. Instagram uygulamasında: Ayarlar > Hesap türü ve araçlar > Profesyonel hesaba geç.
- Bu Instagram hesabı bir **Facebook Sayfası**na bağlı olmalı (Facebook Sayfası > Ayarlar > Bağlı hesaplar > Instagram, ya da Meta Business Suite üzerinden).
- Sayfada yönetici olan kişisel bir Facebook hesabı.

### Meta geliştirici uygulaması

1. https://developers.facebook.com adresine aynı Facebook hesabıyla girin, geliştirici olarak kaydolun.
2. **My Apps > Create App**. Kullanım amacı olarak Instagram API'yi / "Business" türünü seçin.
3. Uygulamaya **Instagram** (Facebook Login ile Instagram API) ürününü ekleyin.
4. Uygulama "Development" (geliştirme) modunda kalabilir: uygulamada rolü olan (yönetici/geliştirici/test kullanıcısı) kişilerin kendi hesaplarıyla paylaşım yapması için Meta'nın uygulama incelemesi (App Review) gerekmez.

### Erişim anahtarı (IG_ACCESS_TOKEN)

1. **Tools > Graph API Explorer** sayfasını açın, sağdan uygulamanızı seçin.
2. **Permissions** kısmına şu izinleri ekleyin: `instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement` (Sayfa bir Business Manager altındaysa `business_management` da).
3. **Generate Access Token** deyin, açılan pencerede kulübün Sayfasını ve Instagram hesabını seçip onaylayın.
4. Bu anahtar kısa ömürlüdür (yaklaşık 1 saat). **Uzun ömürlü (yaklaşık 60 gün)** anahtara çevirmek için **Tools > Access Token Debugger**'da anahtarı yapıştırıp alttaki **Extend Access Token** düğmesine basın. Çıkan yeni anahtarı `IG_ACCESS_TOKEN` olarak girin.

### Instagram kullanıcı kimliği (IG_USER_ID)

Graph API Explorer'da, az önceki anahtarla şu iki sorguyu sırayla çalıştırın:

1. `me/accounts` → listede kulüp Sayfasının `id` değerini bulun.
2. `SAYFA_ID?fields=instagram_business_account` → dönen `instagram_business_account.id` değeri (genellikle `1784...` ile başlar) sizin **IG_USER_ID**'nizdir.

### Bilinmesi gerekenler

- **Anahtar yenileme:** Uzun ömürlü anahtar yaklaşık **60 günde** bir sona erer. Takviminize hatırlatma koyun; süresi dolunca panel "Instagram erişim anahtarının süresi dolmuş" hatası verir. Yenilemek için yukarıdaki "Erişim anahtarı" adımlarını tekrarlayıp `npx supabase secrets set IG_ACCESS_TOKEN=...` ile yeni anahtarı girin.
- **Görsel biçimi:** Instagram API yalnızca **JPEG** kabul eder (en fazla 8 MB). Panelin ürettiği 1080x1350 (4:5) görsel uygundur. Kabul edilen en-boy oranı 4:5 (dikey) ile 1.91:1 (yatay) arasıdır.
- Paylaşımlar `posts` depolama klasörüne yüklenen herkese açık bir bağlantı üzerinden yapılır; Instagram görseli oradan çeker.
- API ile 24 saatte en fazla 100 gönderi paylaşılabilir (kulüp için fazlasıyla yeterli).
- Paylaşımı yalnızca PR ve Başkan rolündeki üyeler yapabilir.

## 9. Kontrol listesi

- [ ] `schema.sql` çalıştırıldı
- [ ] Site URL ve Redirect URL ayarlandı
- [ ] `config.js` dolduruldu ve GitHub'a gönderildi
- [ ] Kendi hesabınızla kayıt olup başkan yapıldınız
- [ ] (İsteğe bağlı) `caption` ve `instagram-publish` fonksiyonları yüklendi
- [ ] (İsteğe bağlı) `ANTHROPIC_API_KEY`, `IG_USER_ID`, `IG_ACCESS_TOKEN` girildi
- [ ] (İsteğe bağlı) 60 günlük Instagram anahtarı yenileme hatırlatması kuruldu

## Sorun giderme

- **"Onay bekliyor" ekranında kalıyorum:** Başkanın Üyeler bölümünden hesabınızı onaylaması gerekir. İlk başkan için 5. adıma bakın.
- **Kayıt olduktan sonra giriş yapamıyorum:** "Confirm email" açıksa e-postanızdaki onay bağlantısına tıklayın (gereksiz klasörünü de kontrol edin) veya 3. adımda bu seçeneği kapatın.
- **Yapay zekâ düğmesi hata veriyor:** `ANTHROPIC_API_KEY` girildi mi, Anthropic hesabında kredi var mı kontrol edin. Supabase panelinde **Edge Functions > caption > Logs** ayrıntıyı gösterir.
- **Instagram paylaşımı hata veriyor:** Çoğunlukla anahtar süresi dolmuştur (8. adım). Ayrıntı için **Edge Functions > instagram-publish > Logs**.
- **Proje duraklatılmış:** Supabase panelinde projeyi açıp **Restore project** deyin.
