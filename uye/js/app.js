import { createStore, trDate } from "./store.js?v=202611141441";
import { can, hasRole, ROLE_LABELS, panelOwners } from "./roles.js?v=202611141441";

const app = document.getElementById("app");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const TL = n => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 2 }).format(+n || 0);
// Yerel tarih (toISOString UTC'dir; Türkiye'de gece 03.00'ten önce dünü verirdi).
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const ini = n => (n || "?").split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join("").toLocaleUpperCase("tr");
const avatar = (p, cls = "") => `<span class="avatar ${cls}">${p?.photo_url ? `<img src="${esc(p.photo_url)}" alt="">` : esc(ini(p?.full_name))}</span>`;
const person = p => `<div class="person">${avatar(p)}<div><b>${esc(p.full_name)}</b><span>${esc(p.title || "Üye")}</span></div></div>`;
const pct = x => `%${Math.round(x * 100)}`;
const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

let store, me;
// Panelden yapılan her yeni kayıt kulüp Gmail adresine iletilir ve başvurular tablosuna kaydedilir (basvuru fonksiyonu).
async function notifyClubOfSignup(d) {
  if (store.mode === "demo") return;
  const body = `Üye panelinden yeni bir hesap açıldı ve başkan onayı bekliyor.
Ad soyad: ${d.full_name}
Telefon: ${d.phone}
E-posta: ${d.email}
Tarih: ${new Date().toLocaleString("tr-TR")}
Onaylamak için üye panelinde Üye listesi > Onay bekleyen hesaplar bölümüne bakın: https://anitteperotaract.org/uye/#uyeler`;
  try {
    const r = await fetch(`${CONFIG_URL}/functions/v1/basvuru`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "panel", subject: `Üyelik başvurusu (panel): ${d.full_name}`, body, reply_to: d.email, page: location.href, confirm: { name: d.full_name, lang: "tr" } }) });
    const j = await r.json().catch(() => ({})); if (!j.ok) throw new Error(j.error || r.status);
  } catch (e) { console.warn("Kayıt bildirimi gönderilemedi", e); }
}
// Görünüm önizleme (yalnızca site sahibi görür): başka bir görevlinin panelini onun gözünden gösterir; değişiklik yapılamaz.
let realMe = null, realStore = null, preview = null;
const isRealOwner = () => !!(realMe || me)?.is_owner;
const PREVIEW_ROLES = [["baskan", "Başkan"], ["asbaskan", "Asbaşkan"], ["sekreter", "Sekreter"], ["sayman", "Sayman"], ["pr", "Halkla İlişkiler (HİTK)"], ["hizmet", "Hizmet Projeleri"], ["gdb", "Geçmiş dönem başkanı"], ["uye", "Normal üye"]];
function readOnlyStore(st) {
  const block = async () => { throw new Error("Önizleme modunda değişiklik yapılamaz."); };
  return new Proxy(st, { get(t, k) {
    const v = t[k];
    if (k === "me") return async () => JSON.parse(JSON.stringify(me));
    if (typeof v === "function" && /^(save|create|update|delete|set|upload|send|approve|add|reset|publish|invite|remove|mark)/.test(String(k)) && k !== "resetDemo") return block;
    return typeof v === "function" ? v.bind(t) : v;
  } });
}
function startPreview(profile, label) {
  realMe = me; realStore = store;
  me = { ...profile, is_owner: false };
  store = readOnlyStore(realStore);
  preview = { label };
  location.hash = "#profil"; render();
}
function endPreview() {
  if (!preview) return;
  me = realMe; store = realStore; realMe = realStore = preview = null;
  location.hash = "#profil"; render();
}
async function previewPicker() {
  const members = (await store.listMembers()).filter(m => m.status === "active" && m.id !== me.id).sort((a, b) => a.full_name.localeCompare(b.full_name, "tr"));
  let d = document.getElementById("pv-dlg"); if (!d) { d = document.createElement("dialog"); d.id = "pv-dlg"; d.className = "bday-dlg"; document.body.appendChild(d); }
  d.innerHTML = `<form method="dialog"><h2>Paneli başka gözle gör</h2>
    <p class="muted" style="margin:0 0 12px">Seçtiğin görevin ya da üyenin panelini, onun gördüğü menü ve yetkilerle açar. Önizlemede hiçbir değişiklik kaydedilmez.</p>
    <div class="grid g2" style="gap:8px">${PREVIEW_ROLES.map(([k, l]) => `<button type="button" class="btn ghost sm" data-pr="${k}">${l}</button>`).join("")}</div>
    <label class="f" style="margin-top:14px">Belirli bir üye gibi gör<select id="pv-m"><option value="">Üye seç…</option>${members.map(m => `<option value="${m.id}">${esc(m.full_name)}${m.title ? " · " + esc(m.title) : ""}</option>`).join("")}</select></label>
    <div class="row" style="margin-top:16px"><button class="btn ghost" value="close">Vazgeç</button></div></form>`;
  if (!d.open) d.showModal();
  d.querySelectorAll("[data-pr]").forEach(b => b.onclick = () => {
    const k = b.dataset.pr, label = PREVIEW_ROLES.find(x => x[0] === k)[1];
    const base = { ...me, roles: [], past_president: false, hide_roles: false, title: label };
    if (k === "gdb") base.past_president = true; else if (k !== "uye") base.roles = [k];
    if (k === "uye") base.title = "Üye";
    d.close(); startPreview(base, label);
  });
  d.querySelector("#pv-m").onchange = e => { const m = members.find(x => x.id === e.target.value); if (m) { d.close(); startPreview(m, m.full_name); } };
}
let toastT;
export function toast(msg, kind = "") {
  const t = document.getElementById("toast");
  t.innerHTML = msg; t.className = "show " + kind;
  clearTimeout(toastT); toastT = setTimeout(() => (t.className = ""), 4200);
}
const fail = e => toast(esc(e?.message || e), "bad");

/* ------------------------------ Açılış ------------------------------ */
async function boot() {
  // Davet ya da şifre belirleme/yenileme e-postasındaki bağlantıyla gelen kişi yalnızca şifre ekranını görür
  // (adres satırı Supabase tarafından temizlenmeden önce bakılır).
  const h = location.hash;
  const pwLink = /(^|[#&])type=(invite|recovery)(&|$)/.test(h);
  const linkError = /(^|[#&])error_code=([^&]+)/.exec(h)?.[2] || (/(^|[#&])error=/.test(h) ? "error" : "");
  if (pwLink) pwMode = true;
  try {
    store = await createStore();
    me = await store.me();
  } catch (e) {
    app.innerHTML = `<div class="pending card"><h1>Panel açılamadı</h1><p>${esc(e.message)}</p><p class="muted">İnternet bağlantınızı ve <code>js/config.js</code> ayarlarını kontrol edin.</p></div>`;
    return;
  }
  store.onRecovery(() => setPasswordView());
  window.addEventListener("hashchange", render);
  if (linkError) { history.replaceState(null, "", location.pathname + location.search); return linkErrorView(linkError); }
  if (pwLink && me) { history.replaceState(null, "", location.pathname + location.search); return setPasswordView(); }
  pwMode = false;
  render();
}
// Şifre belirleme ekranı açıkken panelin başka bir ekranı çizilmez.
let pwMode = false;
function linkErrorView(code) {
  pwMode = false;
  const expired = /expired/.test(code);
  app.innerHTML = `<div class="pending card"><img src="../assets/logo-cranberry.webp" alt="Rotaract Ankara Anıttepe" style="width:200px"><h1>${expired ? "Bağlantının süresi dolmuş" : "Bağlantı geçersiz"}</h1>
  <p>${expired ? "Şifre bağlantıları güvenlik için kısa süre geçerlidir." : "Bu bağlantı daha önce kullanılmış ya da hatalı olabilir."} Yeni bir bağlantı isteyebilirsin.</p>
  <div class="row" style="justify-content:center"><button class="btn" id="newlink">Yeni bağlantı iste</button></div></div>`;
  document.getElementById("newlink").onclick = () => forgotView();
}

function render() {
  if (pwMode) return;
  if (!me) return authView();
  if (me.status === "pending") return pendingView();
  if (me.status === "passive") return pendingView(true);
  shell();
  birthdayNotice();
}

/* ---------------------- Doğum günü bildirimi (pop-up) ---------------------- */
// Başkan ve sekreter, yarın (ve bugün) doğum günü olan üyeleri günde bir kez pop-up olarak görür.
let bdayChecked = false;
const isoLocal = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function birthdaysOn(members, date) {
  const leap = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const md = isoLocal(date).slice(5);
  return members.filter(m => m.status === "active" && m.birth_date).filter(m => {
    let b = m.birth_date.slice(5);
    if (b === "02-29" && !leap(date.getFullYear())) b = "02-28";
    return b === md;
  }).map(m => ({ m, age: +m.birth_date.slice(0, 4) > 1900 ? date.getFullYear() - +m.birth_date.slice(0, 4) : null }));
}
async function birthdayNotice() {
  if (bdayChecked || !(hasRole(me, "baskan") || hasRole(me, "sekreter"))) return;
  bdayChecked = true;
  const key = "ar-bday-seen-" + today();
  try { if (localStorage.getItem(key)) return; } catch {}
  let members; try { members = await store.listMembers(); } catch { return; }
  const now = new Date(), tom = new Date(now); tom.setDate(now.getDate() + 1);
  const tomorrow = birthdaysOn(members, tom), todayList = birthdaysOn(members, now);
  if (!tomorrow.length && !todayList.length) return;
  const line = ({ m, age }) => `<li><b>${esc(m.full_name)}</b>${age ? ` · ${age} yaşına giriyor` : ""}${m.phone ? ` · <a href="tel:${esc(m.phone.replace(/\s/g, ""))}">${esc(m.phone)}</a>` : ""}</li>`;
  const d = document.createElement("dialog");
  d.className = "bday-dlg";
  d.innerHTML = `<form method="dialog">
    <h2>🎂 Doğum günü hatırlatması</h2>
    ${tomorrow.length ? `<p style="margin:0 0 6px">Yarın (${longDate(isoLocal(tom))}) doğum günü olan${tomorrow.length > 1 ? "lar" : ""}:</p><ul>${tomorrow.map(line).join("")}</ul>` : ""}
    ${todayList.length ? `<p style="margin:12px 0 6px">Bugün doğum günü olan${todayList.length > 1 ? "lar" : ""}:</p><ul>${todayList.map(line).join("")}</ul>` : ""}
    <div class="row" style="margin-top:16px"><button class="btn" value="ok">Tamam</button></div>
  </form>`;
  document.body.appendChild(d);
  d.addEventListener("close", () => { try { localStorage.setItem(key, "1"); } catch {} d.remove(); });
  d.showModal();
}

/* ---------------------------- Giriş / kayıt ---------------------------- */
function authView(tab = "giris", error = "") {
  const demo = store.mode === "demo";
  app.innerHTML = `
  <div class="auth">
    <aside class="auth-side">
      <img class="logo" src="../assets/logo-beyaz.webp" alt="Rotaract Ankara Anıttepe">
      <div>
        <h1>Kulübün işleri tek yerde.</h1>
        <p>Profilin, aidat durumun ve toplantılara devamın burada. Görevin varsa yönettiğin bölüm de burada.</p>
      </div>
      <ul><li>Yoklama ve devam oranı</li><li>Aidat ve kulüp kasası</li><li>Proje takvimi</li><li>Instagram paylaşımları</li></ul>
      <div class="wheel-disc" aria-hidden="true"><img src="../assets/rotary-carki.webp" alt=""></div>
    </aside>
    <main class="auth-main">
      <div class="auth-card">
        <div class="tabs" role="tablist">
          <button role="tab" aria-selected="${tab === "giris"}" data-tab="giris">Giriş yap</button>
          <button role="tab" aria-selected="${tab === "kayit"}" data-tab="kayit">Üye ol</button>
        </div>
        ${tab === "giris" ? `
          <h2>Tekrar hoş geldin</h2><p class="muted">Üye hesabınla giriş yap.</p>
          <form id="f-login" novalidate>
            ${error ? `<div class="err" role="alert">${esc(error)}</div>` : ""}
            <label class="f">E-posta<input type="email" name="email" autocomplete="email" required></label>
            <label class="f">Şifre<input type="password" name="password" autocomplete="current-password" required></label>
            <button class="btn" type="submit">Giriş yap</button>
            <button class="btn ghost" type="button" id="forgot">Şifremi unuttum / ilk kez giriş yapıyorum</button>
          </form>` : `
          <h2>Üye hesabı oluştur</h2><p class="muted">Hesabın, başkan onayladıktan sonra açılır.</p>
          <form id="f-signup" novalidate>
            ${error ? `<div class="err" role="alert">${esc(error)}</div>` : ""}
            <label class="f">Ad soyad<input type="text" name="full_name" autocomplete="name" required></label>
            <label class="f">Telefon<input type="tel" name="phone" autocomplete="tel" placeholder="05xx xxx xx xx" required></label>
            <label class="f">E-posta<input type="email" name="email" autocomplete="email" required></label>
            <label class="f">Şifre <small>En az 8 karakter</small><input type="password" name="password" autocomplete="new-password" minlength="8" required></label>
            <button class="btn" type="submit">Hesap oluştur</button>
          </form>`}
        ${demo ? `<div class="demo-box">
          <h3>Demo modu</h3>
          <p class="muted" style="margin:0;font-size:.86rem">Veriler yalnızca bu tarayıcıda tutulur. Bir rolü denemek için kişiye tıkla.</p>
          <div class="chips" id="demo-chips"></div>
        </div>` : ""}
        <p class="muted" style="margin-top:22px;font-size:.86rem"><a href="../">Kulüp sitesine dön</a></p>
      </div>
    </main>
  </div>`;
  app.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => authView(b.dataset.tab));
  const lf = document.getElementById("f-login");
  const fg = document.getElementById("forgot");
  if (fg) fg.onclick = () => forgotView(lf.email.value);
  if (lf) lf.onsubmit = async e => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(lf));
    try { me = await store.signIn(d.email, d.password); if (!/^#(yukle|arsiv)[/]/.test(location.hash)) location.hash = "#profil"; render(); } catch (er) { authView("giris", er.message); }
  };
  const sf = document.getElementById("f-signup");
  if (sf) sf.onsubmit = async e => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(sf));
    if (!d.full_name || !d.phone || !d.email || !d.password) return authView("kayit", "Tüm alanları doldurun.");
    try {
      me = await store.signUp(d);
      await notifyClubOfSignup(d);
      // Supabase'de e-posta doğrulaması açıksa oturum açılmaz; kullanıcıyı boş giriş ekranına sessizce atma.
      if (!me) return authView("giris", "Hesabın oluşturuldu. E-postana gelen doğrulama bağlantısına tıkla, sonra giriş yap.");
      render();
    } catch (er) { authView("kayit", er.message); }
  };
  if (demo) store.demoAccounts().then(list => {
    const box = document.getElementById("demo-chips"); if (!box) return;
    const order = ["Başkan", "Sayman", "Sekreter", "Halkla", "Hizmet", "Geçmiş", "Yönetim", "Üye"];
    const pick = order.map(o => list.find(a => a.title.startsWith(o))).filter(Boolean);
    box.innerHTML = pick.map(a => `<button class="chip" data-e="${esc(a.email)}"><b>${esc(a.label)}</b><span>${esc(a.title)}</span></button>`).join("");
    box.querySelectorAll(".chip").forEach(c => c.onclick = async () => { me = await store.signIn(c.dataset.e, store.demoPassword); if (!/^#(yukle|arsiv)[/]/.test(location.hash)) location.hash = "#profil"; render(); });
  });
}

function forgotView(prefill = "", msg = "", isErr = false) {
  app.innerHTML = `<div class="auth"><aside class="auth-side"><img class="logo" src="../assets/logo-beyaz.webp" alt="Rotaract Ankara Anıttepe"><div><h1>Şifreni belirle.</h1><p>Kulüp listesindeki e-posta adresini yaz; şifre belirleme bağlantısı o adrese gelsin.</p></div></aside>
  <main class="auth-main"><div class="auth-card"><h2>Şifre belirleme bağlantısı</h2><p class="muted">İlk kez giriş yapıyorsan da buradan şifreni oluşturursun.</p>
  <form id="f-forgot" novalidate>${msg ? `<div class="${isErr ? "err" : "banner info"}" role="alert">${esc(msg)}</div>` : ""}
    <label class="f">E-posta<input type="email" name="email" autocomplete="email" value="${esc(prefill)}" required></label>
    <button class="btn" type="submit">Bağlantıyı gönder</button><button class="btn ghost" type="button" id="back">Girişe dön</button></form></div></main></div>`;
  document.getElementById("back").onclick = () => authView();
  document.getElementById("f-forgot").onsubmit = async e => {
    e.preventDefault(); const email = e.target.email.value.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) return forgotView(email, "Geçerli bir e-posta adresi yaz.", true);
    try { await store.resetPassword(email); forgotView(email, "Bağlantı gönderildi. E-postanı (gereksiz klasörü dahil) kontrol et; bağlantıya tıklayınca yeni şifreni belirleyeceksin."); }
    catch (er) { forgotView(email, er.message, true); }
  };
}
function setPasswordView(msg = "") {
  pwMode = true;
  app.innerHTML = `<div class="pending card"><img src="../assets/logo-cranberry.webp" alt="Rotaract Ankara Anıttepe" style="width:200px"><h1>Yeni şifreni belirle</h1>
  <form id="f-newpw" style="display:grid;gap:14px;text-align:left;max-width:380px;margin:0 auto">${msg ? `<div class="err" role="alert">${esc(msg)}</div>` : ""}
    <label class="f">Yeni şifre <small>En az 8 karakter</small><input type="password" name="pw" autocomplete="new-password" minlength="8" required></label>
    <label class="f">Yeni şifre (tekrar)<input type="password" name="pw2" autocomplete="new-password" minlength="8" required></label>
    <button class="btn" type="submit">Şifremi kaydet</button></form></div>`;
  document.getElementById("f-newpw").onsubmit = async e => {
    e.preventDefault(); const f = e.target;
    if (f.pw.value !== f.pw2.value) return setPasswordView("İki şifre aynı değil.");
    try {
      await store.updatePassword(f.pw.value); me = await store.me();
      // Profil açılmaz; yalnızca onay gösterilir. Kişi isterse panele geçer.
      app.innerHTML = `<div class="pending card"><img src="../assets/logo-cranberry.webp" alt="Rotaract Ankara Anıttepe" style="width:200px"><h1>Şifren kaydedildi</h1>
        <p>Artık e-posta adresin ve yeni şifrenle giriş yapabilirsin.</p>
        <div class="row" style="justify-content:center"><button class="btn" id="topanel">Panele git</button></div></div>`;
      document.getElementById("topanel").onclick = () => { pwMode = false; history.replaceState(null, "", location.pathname + "#profil"); render(); };
    }
    catch (er) { setPasswordView(er.message); }
  };
}

function pendingView(passive = false) {
  app.innerHTML = `<div class="pending card">
    <img src="../assets/logo-cranberry.webp" alt="Rotaract Ankara Anıttepe" style="width:200px">
    <h1>${passive ? "Hesabın pasif durumda" : `Hesabın onay bekliyor, ${esc((me.full_name || "").split(" ")[0])}.`}</h1>
    <p class="muted">${passive ? "Yeniden aktif olmak için kulüp başkanıyla iletişime geç." : "Kulüp başkanı hesabını onayladığında profilin açılacak. Onaydan sonra bu sayfayı yenile."}</p>
    <div class="row" style="justify-content:center"><button class="btn ghost" id="out">Çıkış yap</button><a class="btn ghost" href="../">Kulüp sitesi</a></div>
  </div>`;
  document.getElementById("out").onclick = async () => { await store.signOut(); me = null; render(); };
}

/* ------------------------------ Kabuk ------------------------------ */
const PAGES = [
  { id: "profil", label: "Profilim", show: () => true },
  { id: "takvim", label: "Takvim", show: () => true },
  { id: "uyeler", label: "Üye listesi", show: () => true },
  { id: "kulupler", label: "Diğer kulüplerin etkinlikleri", show: () => true },
  { id: "arsiv", label: "Fotoğraf arşivi", show: () => true },
  { id: "yukle", label: "Fotoğraf yükle", show: () => true, hidden: true },
  { grp: "Yönetim" },
  { id: "duyurular", label: "Duyurular", panel: "duyuru" },
  { id: "yoklama", label: "Yoklama", panel: "yoklama" },
  { id: "wa-toplanti", label: "Toplantı duyurusu (WhatsApp)", panel: "wa-toplanti" },
  { id: "aidat", label: "Aidat", panel: "aidat" },
  { id: "wa-aidat", label: "Aidat hatırlatma (WhatsApp)", panel: "wa-aidat" },
  { id: "kasa", label: "Kulüp kasası", panel: "kasa" },
  { id: "bagislar", label: "Bağışlar", panel: "bagis" },
  { id: "projeler", label: "Hizmet projeleri", panel: "projeler" },
  { id: "proje-formlari", label: "Proje formları", panel: "proje-form" },
  // Instagram: yalnızca paylaşım yapabilenler (başkan ve Halkla İlişkiler / HİTK) görür ve açar.
  { id: "instagram", label: "Instagram paylaşımı", panel: "instagram" },
  // Site düzenleme: yalnızca Halkla İlişkiler ve Tanıtım (HİTK) görevlisi.
  { id: "site", label: "Site düzenleme", show: () => hasRole(me, "pr") }
];
const visible = p => p.panel ? can(me, p.panel, "view") : p.show?.();

let composerInst = null;
// Adresin alt parçaları: #arsiv/toplanti/<albümId>, #yukle/<albümId>
let route = [];
// Menüde salt görüntülenen paneller: asbaşkanda panelin görevlisi parantez içinde yazar, diğerlerinde "Görüntüle" etiketi çıkar.
function navLabel(p) {
  const sfx = navSuffix(p);
  return sfx.includes("owner-note") ? `<span class="nav-l">${p.label}${sfx}</span>` : p.label + sfx;
}
function navSuffix(p) {
  if (!p.panel || can(me, p.panel, "edit")) return "";
  if (hasRole(me, "asbaskan")) { const o = panelOwners(p.panel); return o ? ` <span class="owner-note">(${o})</span>` : ""; }
  return '<span class="ro" title="Yalnızca görüntüleme">Görüntüle</span>';
}
function shell() {
  try { composerInst?.destroy?.(); } catch {} composerInst = null;
  [route] = [(location.hash || "#profil").slice(1).split("/").map(decodeURIComponent)];
  let id = route.shift();
  const page = PAGES.find(p => p.id === id);
  if (!page || !visible(page)) { id = "profil"; route = []; }
  const navId = id === "yukle" ? "arsiv" : id;
  // HİTK (Halkla İlişkiler) fotoğraf arşivini yönettiği için menüde arşiv Yönetim başlığının altında durur.
  let pages = PAGES;
  if (hasRole(me, "pr")) { const ar = PAGES.find(p => p.id === "arsiv"), rest = PAGES.filter(p => p !== ar), g = rest.findIndex(p => p.grp); pages = [...rest.slice(0, g + 1), ar, ...rest.slice(g + 1)]; }
  const nav = pages.filter(p => p.grp || (visible(p) && !p.hidden));
  const navHtml = nav.map((p, i) => p.grp
    ? (nav.slice(i + 1).some(x => !x.grp) ? `<div class="grp">${p.grp}</div>` : "")
    : `<a href="#${p.id}" ${p.id === navId ? 'aria-current="page"' : ""}>${navLabel(p)}</a>`).join("");
  app.innerHTML = `
  <div class="shell">
    <aside class="side" id="side">
      <a href="../"><img class="logo" src="../assets/logo-cranberry.webp" alt="Rotaract Ankara Anıttepe, kulüp sitesine dön"></a>
      <nav aria-label="Panel">${navHtml}</nav>
      <div class="who">${avatar(me)}<div style="min-width:0"><b>${esc(me.full_name)}</b><span>${esc(me.title || "Üye")}</span></div></div>
      ${isRealOwner() && !preview ? `<button class="btn ghost sm" id="pv-open">Paneli başka gözle gör</button>` : ""}
      <button class="btn ghost sm" id="logout">Çıkış yap</button>
    </aside>
    <div>
      <div class="topbar"><button class="icon-btn" id="menu" aria-controls="side" aria-expanded="false" aria-label="Menüyü aç"><span class="burger" aria-hidden="true"></span></button><img src="../assets/logo-cranberry.webp" alt="Rotaract Ankara Anıttepe"><span class="topbar-title">${esc((PAGES.find(p => p.id === id) || {}).label || "")}</span></div>
      <main class="main" id="main" tabindex="-1">
        ${store.mode === "demo" ? `<div class="banner demo"><span><b>Demo modu.</b> Örnek verilerle çalışıyor; değişiklikler yalnızca bu tarayıcıda kalır.</span> <button class="btn ghost sm" id="reset">Örnek verileri sıfırla</button></div>` : ""}
        ${preview ? `<div class="banner preview" role="status"><span><b>Önizleme:</b> ${esc(preview.label)} olarak görüyorsun. Değişiklikler kaydedilmez.</span> <button class="btn sm" id="pv-end">Önizlemeden çık</button></div>` : ""}
        <div id="view"><p class="muted">Yükleniyor…</p></div>
      </main>
    </div>
    <div class="scrim" id="scrim" hidden></div>
    <nav class="tabbar" aria-label="Hızlı geçiş">${[["profil", "Profil", "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0"], ["takvim", "Takvim", "M4 6h16v14H4zM4 10h16M9 3v4M15 3v4"], ["uyeler", "Üyeler", "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6 9a6 6 0 0 1 12 0M17 11a3 3 0 1 0-1-5.8M21 20a5 5 0 0 0-4-4.9"], ["arsiv", "Arşiv", "M4 6h16v13H4zM4 15l4.5-4.5 3.5 3.5 2.5-2.5L20 17M15.5 9.5h.01"]].map(([h, l, d]) => `<a href="#${h}" ${h === navId ? 'aria-current="page"' : ""}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg><span>${l}</span></a>`).join("")}<button type="button" id="more"${["profil", "takvim", "uyeler", "arsiv"].includes(navId) ? "" : ' class="on"'}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg><span>Menü</span></button></nav>
  </div>`;
  document.getElementById("logout").onclick = async () => { if (preview) { me = realMe; store = realStore; realMe = realStore = preview = null; } await store.signOut(); me = null; location.hash = ""; render(); };
  document.getElementById("pv-open")?.addEventListener("click", previewPicker);
  document.getElementById("pv-end")?.addEventListener("click", endPreview);
  const side = document.getElementById("side"), mb = document.getElementById("menu");
  const scrim = document.getElementById("scrim");
  const setMenu = o => { side.classList.toggle("open", o); scrim.hidden = !o; mb.setAttribute("aria-expanded", o); document.body.classList.toggle("lock", o); if (o) side.querySelector("nav a")?.focus(); };
  mb.onclick = () => setMenu(!side.classList.contains("open"));
  document.getElementById("more").onclick = () => setMenu(true);
  scrim.onclick = () => setMenu(false);
  document.onkeydown = e => { if (e.key === "Escape" && side.classList.contains("open")) { setMenu(false); mb.focus(); } };
  side.querySelectorAll("nav a").forEach(a => a.addEventListener("click", () => setMenu(false)));
  document.body.classList.remove("lock");
  const rs = document.getElementById("reset");
  if (rs) rs.onclick = () => { if (confirm("Örnek veriler ilk haline dönsün mü? Bu tarayıcıdaki demo değişiklikleri silinir.")) { store.resetDemo(); location.hash = ""; location.reload(); } };
  const view = document.getElementById("view");
  const fn = { profil: viewProfile, takvim: viewCalendar, kulupler: viewClubEvents, duyurular: viewAnnounce, uyeler: viewMembers, yoklama: viewAttendance, aidat: viewDues, kasa: viewTreasury, projeler: viewProjects, instagram: viewInstagram, site: viewSite, arsiv: viewArchive, yukle: viewUpload, bagislar: viewDonations, "proje-formlari": viewProjectForms, "wa-toplanti": viewWaMeeting, "wa-aidat": viewWaDues }[id];
  fn(view).catch(e => { view.innerHTML = `<div class="err">${esc(e.message)}</div>`; });
  labelTables(view);
  new MutationObserver(() => labelTables(view)).observe(view, { childList: true, subtree: true });
  scrollTo(0, 0);
}
// Telefonda tablolar kart olarak görünür: her hücreye sütun başlığını yaz.
function labelTables(root) {
  root.querySelectorAll("table:not(.matrix)").forEach(t => {
    const heads = [...t.querySelectorAll("thead th")].map(th => th.textContent.trim());
    t.classList.add("stack");
    t.querySelectorAll("tbody tr").forEach(tr => [...tr.children].forEach((td, i) => { if (heads[i] && td.dataset.label !== heads[i]) td.dataset.label = heads[i]; }));
  });
}
const header = (title, sub = "", actions = "") => `<div class="page-h"><div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ""}</div><div class="spacer"></div>${actions}</div>`;
const roBanner = panel => can(me, panel, "edit") ? "" : `<div class="banner info">Bu bölümü yalnızca görüntüleyebilirsin; değişiklikleri görevli üye yapar.</div>`;
const refresh = () => shell();

/* --------------------------- Yardımcı hesaplar --------------------------- */
// Üyenin yoklamada sayılmaya başladığı toplantı no'su (bu dönemde değilse dönem başı = 1).
const memberStartNo = (m, meetings) => meetings.find(x => x.id === m?.start_meeting_id)?.term_no || 1;
// Misafirin ilk geldiği toplantı no'su (hiç gelmediyse ilk kaydı; kaydı yoksa null).
const guestStartNo = (gid, meetings, gatt) => {
  const no = id => meetings.find(m => m.id === id)?.term_no;
  const mine = gatt.filter(a => a.member_id === gid).map(a => ({ s: a.status, n: no(a.meeting_id) })).filter(x => x.n);
  const came = mine.filter(x => x.s === "geldi").map(x => x.n);
  const list = came.length ? came : mine.map(x => x.n);
  return list.length ? Math.min(...list) : null;
};
// Oran, kişinin başladığı toplantıdan (startNo) itibaren yapılan toplantılara göre hesaplanır.
function attendanceStats(memberId, meetings, att, startNo = 1) {
  const held = meetings.filter(m => m.date <= today() && m.term_no >= startNo);
  const ids = new Set(held.map(m => m.id));
  const mine = att.filter(a => a.member_id === memberId && ids.has(a.meeting_id));
  const c = { geldi: 0, gelmedi: 0, mazeretli: 0 };
  mine.forEach(a => c[a.status]++);
  const n = held.length;
  return { held: n, ...c, isaretsiz: n - mine.length, oran: n ? c.geldi / n : 0, oranMazeretHaric: (n - c.mazeretli) ? c.geldi / (n - c.mazeretli) : 0 };
}
// Ödeme aralığı son günden 14 gün önce açılır (ör. 2. taksit 1–15 Kasım). Aralık açılmadan taksit borç sayılmaz.
const PAY_WINDOW_DAYS = 14;
function payOpens(d) { if (!d?.due_date) return ""; const x = new Date(d.due_date + "T00:00:00"); x.setDate(x.getDate() - PAY_WINDOW_DAYS); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; }
const isPayOpen = d => !!d && (!d.due_date || payOpens(d) <= today());
const notOpenTag = d => `<span class="tag">Ödeme başlangıcı: ${trDate(payOpens(d))}</span>`;
function debtOf(memberId, charges, dues) {
  const dmap = Object.fromEntries(dues.map(d => [d.id, d]));
  const open = charges.filter(c => c.member_id === memberId && !c.paid_at).map(c => ({ ...c, due: dmap[c.due_id] })).filter(c => c.due && isPayOpen(c.due));
  return { total: open.reduce((s, c) => s + +c.amount, 0), open, overdue: open.filter(c => c.due.due_date < today()) };
}


// Profil fotoğrafı kırpma: fotoğraf yuvarlak çerçevede sürüklenir ve yakınlaştırılır; "Kaydet" 480×480 JPEG döndürür.
function cropPhoto(file) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onerror = () => { URL.revokeObjectURL(url); toast("Bu fotoğraf açılamadı. Farklı bir dosya dene (HEIC desteklenmeyebilir).", "bad"); resolve(null); };
    img.onload = () => {
      const S = 300, OUT = 480;
      const dlg = document.createElement("dialog");
      dlg.className = "crop-dlg";
      dlg.innerHTML = `<form method="dialog" class="crop-box">
        <h2 style="margin:0 0 4px">Profil fotoğrafı</h2>
        <p class="muted" style="margin:0 0 12px;font-size:.88rem">Fotoğrafı sürükleyerek konumlandır, kaydırıcıyla yakınlaştır. Daire içinde kalan kısım görünür.</p>
        <div class="crop-stage"><canvas width="${S}" height="${S}" aria-label="Kırpma önizlemesi" tabindex="0"></canvas></div>
        <label class="f" style="margin-top:12px">Yakınlaştır<input type="range" min="1" max="3" step="0.01" value="1" class="crop-zoom"></label>
        <div class="row" style="margin-top:14px;justify-content:flex-end"><button type="button" class="btn ghost" data-c="cancel">Vazgeç</button><button type="button" class="btn" data-c="ok">Kaydet</button></div>
      </form>`;
      document.body.appendChild(dlg);
      const cv = dlg.querySelector("canvas"), ctx = cv.getContext("2d"), zoomEl = dlg.querySelector(".crop-zoom");
      const base = Math.max(S / img.naturalWidth, S / img.naturalHeight);
      let zoom = 1, cx = 0.5, cy = 0.5; // görünen alanın merkezi (görsel oranı olarak)
      const geom = (size) => {
        const k = size / S, sc = base * zoom * k, w = img.naturalWidth * sc, h = img.naturalHeight * sc;
        const x = Math.min(0, Math.max(size - w, size / 2 - cx * w)), y = Math.min(0, Math.max(size - h, size / 2 - cy * h));
        return { x, y, w, h };
      };
      const clampC = () => { const g = geom(S); cx = (S / 2 - g.x) / g.w; cy = (S / 2 - g.y) / g.h; };
      const draw = () => { const g = geom(S); ctx.clearRect(0, 0, S, S); ctx.drawImage(img, g.x, g.y, g.w, g.h); };
      draw();
      zoomEl.oninput = () => { zoom = +zoomEl.value; clampC(); draw(); };
      let drag = null;
      cv.onpointerdown = e => { cv.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY }; };
      cv.onpointermove = e => {
        if (!drag) return; const g = geom(S), k = S / cv.getBoundingClientRect().width;
        cx -= (e.clientX - drag.x) * k / g.w; cy -= (e.clientY - drag.y) * k / g.h; drag = { x: e.clientX, y: e.clientY }; clampC(); draw();
      };
      cv.onpointerup = cv.onpointercancel = () => { drag = null; };
      cv.onkeydown = e => {
        const g = geom(S), st = (e.shiftKey ? 20 : 6), m = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] }[e.key];
        if (!m) return; e.preventDefault(); cx += m[0] / g.w; cy += m[1] / g.h; clampC(); draw();
      };
      cv.addEventListener("wheel", e => { e.preventDefault(); zoom = Math.min(3, Math.max(1, zoom - e.deltaY * 0.002)); zoomEl.value = String(zoom); clampC(); draw(); }, { passive: false });
      const close = blob => { URL.revokeObjectURL(url); dlg.close(); dlg.remove(); resolve(blob); };
      dlg.querySelector('[data-c="cancel"]').onclick = () => close(null);
      dlg.addEventListener("cancel", e => { e.preventDefault(); close(null); });
      dlg.querySelector('[data-c="ok"]').onclick = () => {
        const out = document.createElement("canvas"); out.width = out.height = OUT;
        const g = geom(OUT), o = out.getContext("2d"); o.imageSmoothingQuality = "high"; o.drawImage(img, g.x, g.y, g.w, g.h);
        out.toBlob(b => close(b), "image/jpeg", 0.9);
      };
      dlg.showModal();
    };
    img.src = url;
  });
}

/* ------------------------------ Profil ------------------------------ */
async function viewProfile(v) {
  const [meetings, att, charges, dues, priv] = await Promise.all([store.listMeetings(), store.listAttendance(), store.listCharges(), store.listDues(), store.getPrivate(me.id)]);
  const st = attendanceStats(me.id, meetings, att, memberStartNo(me, meetings));
  const debt = debtOf(me.id, charges, dues);
  const roles = (me.hide_roles ? [] : me.roles || []).map(r => `<span class="tag cran">${ROLE_LABELS[r]}</span>`).join(" ") + (me.past_president ? ` <span class="tag">Geçmiş dönem başkanı</span>` : "");
  v.innerHTML = header("Profilim") + `
  <div class="card"><div class="profile-head">
    <div class="photo-btn">${avatar(me, "lg")}<label>Değiştir<input type="file" accept="image/*" id="photo" class="sr"></label></div>
    <div><h2>${esc(me.full_name)}</h2><p style="margin:2px 0 8px;font-weight:600">${esc(me.title || "Üye")}</p><div class="row">${roles}</div></div>
  </div></div>
  <div class="stats" style="margin-top:16px">
    <div class="stat ${debt.total ? "hl" : ""}"><span>Aidat borcu</span><b>${TL(debt.total)}</b></div>
    <div class="stat"><span>Devam oranı</span><b>${pct(st.oran)}</b></div>
    <div class="stat"><span>Katıldığı toplantı</span><b>${st.geldi} / ${st.held}</b></div>
    <div class="stat"><span>Mazeretli · Gelmedi</span><b>${st.mazeretli} · ${st.gelmedi}</b></div>
  </div>
  <div class="grid g2">
    <div class="card"><h2>Aidat durumu</h2>${debt.open.length ? `<div class="tbl-wrap"><table><thead><tr><th>Dönem</th><th>Son ödeme</th><th class="num">Tutar</th></tr></thead><tbody>
      ${debt.open.sort((a, b) => (a.due.due_date || "").localeCompare(b.due.due_date || "")).map(c => `<tr><td>${esc(c.due.label)}</td><td>${trDate(c.due.due_date)} ${c.due.due_date < today() ? '<span class="tag bad">Gecikti</span>' : ""}</td><td class="num">${TL(c.amount)}</td></tr>`).join("")}
      </tbody></table></div>` : `<p class="muted" style="margin:0">Ödenmemiş aidatın yok.</p>`}</div>
    <div class="card"><h2>Toplantılara devam</h2>
      <p style="margin:0 0 8px">Bu dönem yapılan ${st.held} toplantının ${st.geldi} tanesine katıldın.</p>
      <div class="bar" aria-hidden="true"><i style="width:${st.oran * 100}%"></i></div>
      <p class="muted" style="font-size:.86rem;margin:10px 0 0">Mazeretli toplantılar hariç devam oranın ${pct(st.oranMazeretHaric)}. ${st.isaretsiz ? `${st.isaretsiz} toplantı henüz işlenmedi.` : ""}</p>
    </div>
  </div>
  <form class="card" id="f-me" style="margin-top:16px"><h2>Bilgilerim</h2>
    <div class="grid g2">
      <label class="f">Ad soyad<input type="text" name="full_name" value="${esc(me.full_name)}" required></label>
      <label class="f">Telefon<input type="tel" name="phone" value="${esc(me.phone)}"></label>
      <label class="f">E-posta <small>Değiştirmek için başkana yazın</small><input type="email" value="${esc(me.email)}" disabled></label>
      <label class="f">Doğum tarihi<input type="date" name="birth_date" value="${esc(me.birth_date || "")}"></label>
      <label class="f">Meslek / okul<input type="text" name="profession" value="${esc(me.profession)}"></label>
      <label class="f">Instagram<input type="text" name="instagram" value="${esc(me.instagram || "")}" placeholder="@kullaniciadi"></label>
      <label class="f">Kan grubu <small>Yalnızca sen ve başkan görür</small><input type="text" name="blood_type" value="${esc(priv.blood_type || "")}" placeholder="ör. A Rh+"></label>
      <label class="f">Görev <small>Başkan atar</small><input type="text" value="${esc(me.title || "Üye")}" disabled></label>
    </div>
    <div class="row" style="margin-top:14px"><button class="btn" type="submit">Kaydet</button></div>
  </form>
  <form class="card" id="f-pw" style="margin-top:16px" novalidate><h2>Şifre değiştir</h2>
    <input type="email" name="username" value="${esc(me.email)}" autocomplete="username" hidden>
    <div class="grid g2">
      <label class="f">Yeni şifre <small>En az 8 karakter</small><input type="password" name="pw" autocomplete="new-password" minlength="8" required></label>
      <label class="f">Yeni şifre (tekrar)<input type="password" name="pw2" autocomplete="new-password" minlength="8" required></label>
    </div>
    <p class="err" id="pw-err" role="alert" hidden style="margin:12px 0 0"></p>
    <div class="row" style="margin-top:14px"><button class="btn" type="submit">Şifremi değiştir</button></div>
  </form>`;
  document.getElementById("f-pw").onsubmit = async e => {
    e.preventDefault(); const f = e.target, err = document.getElementById("pw-err");
    const show = m => { err.textContent = m; err.hidden = !m; };
    if (f.pw.value.length < 8) return show("Şifre en az 8 karakter olmalı.");
    if (f.pw.value !== f.pw2.value) return show("İki şifre aynı değil.");
    show("");
    const b = f.querySelector("button"); b.disabled = true;
    try { await store.updatePassword(f.pw.value); f.reset(); toast("Şifren değiştirildi. Bir sonraki girişte yeni şifreni kullan."); }
    catch (er) { show(er.message); }
    b.disabled = false;
  };
  document.getElementById("photo").onchange = async e => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    const blob = await cropPhoto(f); if (!blob) return;
    try { await store.uploadPhoto(me.id, new File([blob], "profil.jpg", { type: "image/jpeg" })); me = await store.me(); toast("Profil fotoğrafın güncellendi."); refresh(); } catch (er) { fail(er); }
  };
  document.getElementById("f-me").onsubmit = async e => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)); d.birth_date ||= null;
    try { await store.updateMember(me.id, d); me = await store.me(); toast("Bilgilerin kaydedildi."); refresh(); } catch (er) { fail(er); }
  };
}

/* ---------------------------- Üye listesi ---------------------------- */
async function viewMembers(v) {
  const admin = hasRole(me, "baskan");
  const seeDebt = false; // Üye listesinde aidat borcu gösterilmez (Aidat sayfasında var)
  const [members, charges, dues, accounts] = await Promise.all([store.listMembers(), seeDebt ? store.listCharges() : [], seeDebt ? store.listDues() : [], store.listAccounts()]);
  // Hesap belirteci: şifresini oluşturmuş mu? (yalnızca yetkili kişiler görür; veri yoksa hiç gösterilmez)
  const acc = accounts ? new Map(accounts.map(a => [a.id, a])) : null;
  const acctDot = m => {
    if (!acc) return "";
    const a = acc.get(m.id), on = !!a?.has_password;
    const t = on ? `Siteye şifresini oluşturdu${a.last_sign_in_at ? " · son giriş " + trDate(a.last_sign_in_at.slice(0, 10)) : ""}` : "Henüz şifresini oluşturmadı";
    return `<span class="acct ${on ? "on" : ""}" title="${t}" role="img" aria-label="${t}"></span>`;
  };
  const pending = members.filter(m => m.status === "pending");
  const STATUS = { active: ["Aktif", "ok"], pending: ["Onay bekliyor", "warn"], passive: ["Pasif", ""] };
  const rows = q => members.filter(m => m.status !== "pending" || admin)
    .filter(m => !q || [m.full_name, m.title, m.email, m.phone, m.profession].join(" ").toLocaleLowerCase("tr").includes(q))
    .sort((a, b) => (a.status === "active" ? 0 : 1) - (b.status === "active" ? 0 : 1) || a.full_name.localeCompare(b.full_name, "tr"))
    .map(m => {
      const d = seeDebt ? debtOf(m.id, charges, dues) : null;
      return `<tr>
        <td>${acc ? person(m).replace(`<div class="person">`, `<div class="person has-acct">` + acctDot(m)) : person(m)}</td>
        <td>${m.phone ? `<a href="tel:${esc(m.phone.replace(/\s/g, ""))}">${esc(m.phone)}</a>` : '<span class="muted">Eklenmedi</span>'}</td>
        <td>${m.email ? `<a href="mailto:${esc(m.email)}">${esc(m.email)}</a>` : ""}</td>
        <td>${m.birth_date ? trDate(m.birth_date) : '<span class="muted">Eklenmedi</span>'}</td>
        <td>${esc(m.profession) || '<span class="muted">Eklenmedi</span>'}</td>
        <td>${m.instagram ? `<a href="https://instagram.com/${esc(m.instagram.replace(/^@/, ""))}" target="_blank" rel="noopener">@${esc(m.instagram.replace(/^@/, ""))}</a>` : '<span class="muted">Eklenmedi</span>'}</td>
        <td>${trDate(m.joined_at)}</td>
        <td><span class="tag ${STATUS[m.status]?.[1] || ""}">${STATUS[m.status]?.[0] || esc(m.status)}</span>${(m.hide_roles ? [] : m.roles || []).map(r => ` <span class="tag cran">${ROLE_LABELS[r]}</span>`).join("")}${m.past_president ? ' <span class="tag">GDB</span>' : ""}</td>
        ${seeDebt ? `<td class="num">${d.total ? `<b>${TL(d.total)}</b>${d.overdue.length ? ' <span class="tag bad">Gecikmiş</span>' : ""}` : '<span class="tag ok">Yok</span>'}</td>` : ""}
        ${admin ? `<td><button class="btn ghost sm" data-edit="${m.id}">Düzenle</button></td>` : ""}
      </tr>`;
    }).join("");
  v.innerHTML = header("Üye listesi", `${members.filter(m => m.status === "active").length} aktif üye`, `<div class="row"><input type="search" id="q" placeholder="İsim, görev, telefon ara" style="max-width:260px" aria-label="Üye ara">${admin ? `<button class="btn" id="addm">Yeni üye ekle</button><label class="btn ghost" style="cursor:pointer">Excel'den bilgileri al<input type="file" id="xls" accept=".xlsx,.xls,.csv" class="sr"></label>` : ""}</div>`) +
    (admin ? `<p class="muted" style="margin:-8px 0 16px;font-size:.86rem">Excel'den alma yalnızca listedeki mevcut üyelerin telefon, e-posta, doğum tarihi, meslek, Instagram ve kan grubu bilgilerini günceller; yeni kişi eklemez. Dosya bu tarayıcıda okunur, hiçbir yere yüklenmez.</p>` : "") +
    (admin && pending.length ? `<div class="card" style="margin-bottom:16px"><h2>Onay bekleyen hesaplar</h2>${pending.map(m => `<div class="pay-row">${person(m)}<span class="muted">${esc(m.email)} · ${esc(m.phone)}</span><button class="btn sm" data-approve="${m.id}">Onayla</button><button class="btn danger sm" data-reject="${m.id}">Pasife al</button></div>`).join("")}</div>` : "") +
    (acc ? `<p class="muted acct-legend"><span class="lg"><span class="acct on"></span>Siteye şifresini oluşturdu</span> <span class="lg"><span class="acct"></span>Henüz oluşturmadı</span> <span class="lg">· ${members.filter(m => acc.get(m.id)?.has_password).length}/${members.length} kişi</span></p>` : "") +
    `<div class="tbl-wrap"><table><thead><tr><th>Üye</th><th>Telefon</th><th>E-posta</th><th>Doğum tarihi</th><th>Meslek / okul</th><th>Instagram</th><th>Üyelik</th><th>Durum</th>${seeDebt ? '<th class="num">Aidat borcu</th>' : ""}${admin ? "<th></th>" : ""}</tr></thead><tbody id="tb">${rows("")}</tbody></table></div>
    <dialog id="dlg"></dialog>`;
  const tb = document.getElementById("tb");
  const bind = () => tb.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => editMember(members.find(m => m.id === b.dataset.edit)));
  document.getElementById("q").oninput = e => { tb.innerHTML = rows(e.target.value.trim().toLocaleLowerCase("tr")); bind(); };
  bind();
  if (admin) {
    document.getElementById("addm").onclick = () => editMember(null);
    document.getElementById("xls").onchange = e => { const f = e.target.files[0]; e.target.value = ""; if (f) importMembers(f, members); };
  }
  v.querySelectorAll("[data-approve]").forEach(b => b.onclick = async () => { try { await store.approveMember(b.dataset.approve); toast("Üye onaylandı."); refresh(); } catch (e) { fail(e); } });
  v.querySelectorAll("[data-reject]").forEach(b => b.onclick = async () => { try { await store.updateMember(b.dataset.reject, { status: "passive" }); toast("Hesap pasife alındı."); refresh(); } catch (e) { fail(e); } });
}

async function editMember(m) {
  const isNew = !m;
  m ||= { full_name: "", title: "Üye", phone: "", email: "", status: "active", joined_at: today(), roles: [], past_president: false };
  const [priv, meetings] = await Promise.all([isNew ? {} : store.getPrivate(m.id), store.listMeetings().catch(() => [])]);
  const dlg = document.getElementById("dlg");
  dlg.innerHTML = `<form method="dialog" id="f-em">
    <h2>${isNew ? "Yeni üye ekle" : esc(m.full_name)}</h2>
    ${isNew && store.mode === "supabase" ? `<p class="muted" style="margin:0">Üyeye e-postasına bir davet gider; bağlantıya tıklayıp şifresini belirleyince panele girebilir.</p>` : ""}
    <div class="grid g2">
      <label class="f">Ad soyad<input type="text" name="full_name" value="${esc(m.full_name)}" required></label>
      <label class="f">Görev<input type="text" name="title" value="${esc(m.title)}" list="titles"></label>
      <label class="f">Telefon<input type="tel" name="phone" value="${esc(m.phone)}" placeholder="05xx xxx xx xx"></label>
      <label class="f">E-posta<input type="email" name="email" value="${esc(m.email)}" ${isNew && store.mode === "supabase" ? "required" : ""}></label>
      <label class="f">Doğum tarihi<input type="date" name="birth_date" value="${esc(m.birth_date || "")}"></label>
      <label class="f">Meslek / okul<input type="text" name="profession" value="${esc(m.profession || "")}"></label>
      <label class="f">Instagram<input type="text" name="instagram" value="${esc(m.instagram || "")}" placeholder="@kullaniciadi"></label>
      <label class="f">Kan grubu<input type="text" name="blood_type" value="${esc(priv.blood_type || "")}" placeholder="ör. A Rh+"></label>
      <label class="f">Durum<select name="status">${[["active", "Aktif"], ["pending", "Onay bekliyor"], ["passive", "Pasif"]].map(([k, l]) => `<option value="${k}" ${m.status === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label class="f">Üyelik tarihi<input type="date" name="joined_at" value="${esc(m.joined_at || "")}"></label>
      <label class="f">Yoklamada başladığı toplantı <small>Üye alındığı toplantı; devam oranı buradan itibaren hesaplanır</small><select name="start_meeting_id"><option value="">Dönem başından</option>${meetings.map(x => `<option value="${x.id}" ${m.start_meeting_id === x.id ? "selected" : ""}>${x.term_no}. toplantı · ${trDate(x.date)}</option>`).join("")}</select></label>
    </div>
    <datalist id="titles">${["Başkan", "Asbaşkan", "Sekreter", "Sayman", "Yönetim Kurulu Üyesi", "Geçmiş Dönem Başkanı", "Hizmet Projeleri Komitesi Başkanı", "Halkla İlişkiler ve Tanıtım Komitesi Başkanı", "Üye"].map(t => `<option value="${t}">`).join("")}</datalist>
    <fieldset><legend style="font-weight:700;margin-bottom:6px">Panel yetkileri</legend><div class="grid g2">
      ${Object.entries(ROLE_LABELS).map(([k, l]) => `<label class="check"><input type="checkbox" name="role" value="${k}" ${(m.roles || []).includes(k) ? "checked" : ""}> ${l}</label>`).join("")}
      <label class="check"><input type="checkbox" name="past_president" ${m.past_president ? "checked" : ""}> Geçmiş dönem başkanı (tüm panelleri görür)</label>
      <label class="check"><input type="checkbox" name="hide_roles" ${m.hide_roles ? "checked" : ""}> Yetkileri görev olarak gösterme (yalnızca unvan ve GDB görünür)</label>
    </div></fieldset>
    <div class="row"><button class="btn" value="save">Kaydet</button><button class="btn ghost" value="cancel" formnovalidate>Vazgeç</button></div>
  </form>`;
  if (!dlg.open) dlg.showModal();
  dlg.querySelector("form").onsubmit = async e => {
    if (e.submitter?.value !== "save") return;
    const fd = new FormData(e.target);
    const patch = { full_name: fd.get("full_name"), title: fd.get("title"), phone: fd.get("phone"), email: fd.get("email"), birth_date: fd.get("birth_date") || null, profession: fd.get("profession"), instagram: fd.get("instagram"), blood_type: fd.get("blood_type"), status: fd.get("status"), joined_at: fd.get("joined_at") || null, roles: fd.getAll("role"), past_president: fd.has("past_president"), hide_roles: fd.has("hide_roles"), start_meeting_id: fd.get("start_meeting_id") || null };
    try {
      if (isNew) {
        const { roles, past_president, status, hide_roles, start_meeting_id, ...base } = patch;
        const created = await store.addMember(base);
        if (created?.id && (roles.length || past_president || status !== "active" || hide_roles || start_meeting_id)) await store.updateMember(created.id, { roles, past_president, status, hide_roles, start_meeting_id });
        toast(`${esc(patch.full_name)} üye listesine eklendi.`);
      } else { await store.updateMember(m.id, patch); if (m.id === me.id) me = await store.me(); toast("Üye bilgileri kaydedildi."); }
      refresh();
    } catch (er) { fail(er); }
  };
}

/* ------------------------- Excel'den üye bilgisi ------------------------- */
const XLSX_URL = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
const loadScript = src => new Promise((res, rej) => { if ([...document.scripts].some(s => s.src === src)) return res(); const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("Gerekli kütüphane yüklenemedi. İnternet bağlantını kontrol et.")); document.head.appendChild(s); });
const norm = s => String(s || "").replace(/İ/g, "i").replace(/I/g, "ı").toLocaleLowerCase("tr").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
function lev(a, b) { const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; }
function excelDate(v) {
  if (v == null || v === "") return null;
  if (typeof v === "string" && /^d{4,5}(.d+)?$/.test(v.trim())) v = +v;
  if (typeof v === "number") { const d = new Date(Math.round((v - 25569) * 864e5)); return d.toISOString().slice(0, 10); }
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  const m = String(v).trim().match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/); if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const iso = String(v).match(/^\d{4}-\d{2}-\d{2}/); return iso ? iso[0] : null;
}
const cleanPhone = v => { const d = String(v || "").replace(/\D/g, ""); if (!d) return ""; const n = d.startsWith("90") ? d.slice(2) : d.startsWith("0") ? d.slice(1) : d; return n.length === 10 ? `0${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6, 8)} ${n.slice(8)}` : String(v).trim(); };
async function importMembers(file, members) {
  try {
    await loadScript(XLSX_URL);
    const wb = window.XLSX.read(await file.arrayBuffer(), { type: "array" });
    const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: "" });
    const hi = rows.findIndex(r => r.some(c => /isim|ad soyad/i.test(norm(c))));
    if (hi < 0) throw new Error("Dosyada \"İsim Soyisim\" sütunu bulunamadı.");
    const H = rows[hi].map(norm), col = re => H.findIndex(h => re.test(h));
    const C = { name: col(/isim|ad soyad/), birth: col(/dogum/), phone: col(/telefon|tel/), mail: col(/mail|e posta/), insta: col(/instagram/), job: col(/meslek/), blood: col(/kan/) };
    const people = rows.slice(hi + 1).filter(r => String(r[C.name] || "").trim()).map(r => ({ r, n: norm(r[C.name]) }));
    const site = members.filter(m => m.status !== "pending");
    const updated = [], missing = [];
    for (const m of site) {
      const mn = norm(m.full_name);
      let best = people.find(p => p.n === mn);
      if (!best) { const c = people.map(p => ({ p, d: lev(p.n, mn) })).sort((a, b) => a.d - b.d)[0]; if (c && c.d <= 2) best = c.p; }
      if (!best) { missing.push(m.full_name); continue; }
      const r = best.r, patch = {};
      if (C.phone >= 0 && r[C.phone]) patch.phone = cleanPhone(r[C.phone]);
      if (C.mail >= 0 && r[C.mail]) patch.email = String(r[C.mail]).trim().toLowerCase();
      if (C.birth >= 0 && excelDate(r[C.birth])) patch.birth_date = excelDate(r[C.birth]);
      if (C.job >= 0 && r[C.job]) patch.profession = String(r[C.job]).trim();
      if (C.insta >= 0 && r[C.insta] && String(r[C.insta]).trim() !== "-") patch.instagram = String(r[C.insta]).trim().replace(/^https?:\/\/(www\.)?instagram\.com\//, "").replace(/\/.*$/, "").replace(/^@/, "");
      if (C.blood >= 0 && r[C.blood]) patch.blood_type = String(r[C.blood]).trim();
      await store.updateMember(m.id, patch);
      updated.push(m.full_name);
    }
    me = await store.me();
    const skipped = people.length - updated.length;
    toast(`${updated.length} üyenin bilgileri güncellendi.${missing.length ? ` Listede bulunamayan: ${esc(missing.join(", "))}.` : ""} ${skipped > 0 ? `Listedeki diğer ${skipped} kişi eklenmedi.` : ""}`);
    refresh();
  } catch (e) { fail(e); }
}

/* ------------------------------ Yoklama ------------------------------ */
let selMeeting = null;
async function viewAttendance(v) {
  const ro = !can(me, "yoklama", "edit");
  const [term, meetings, att, all, guests, gattRaw] = await Promise.all([store.getTerm(), store.listMeetings(), store.listAttendance(), store.listMembers(), store.listGuests(), store.listGuestAttendance()]);
  const members = all.filter(m => m.status === "active").sort((a, b) => a.full_name.localeCompare(b.full_name, "tr"));
  if (!meetings.length) { v.innerHTML = header("Yoklama", `${esc(term.name)} dönemi`) + `<div class="card"><p class="muted" style="margin:0">Bu dönem için henüz toplantı tanımlanmamış.</p></div>`; return; }
  const held = meetings.filter(m => m.date <= today());
  if (!selMeeting || !meetings.find(m => m.id === selMeeting)) selMeeting = (held.at(-1) || meetings[0])?.id;
  const cur = meetings.find(m => m.id === selMeeting);
  const amap = new Map(att.map(a => [a.meeting_id + "|" + a.member_id, a]));
  // Misafir kayıtları üye kayıtlarıyla aynı biçime getirilir (member_id = misafir id'si).
  const gatt = gattRaw.map(a => ({ ...a, member_id: a.guest_id }));
  const gmap = new Map(gatt.map(a => [a.meeting_id + "|" + a.member_id, a]));
  const guestList = guests.map(g => ({ ...g, title: "Misafir" })).sort((a, b) => a.full_name.localeCompare(b.full_name, "tr"));
  const startOf = new Map([...members.map(m => [m.id, memberStartNo(m, meetings)]), ...guestList.map(g => [g.id, guestStartNo(g.id, meetings, gatt)])]);
  const stats = members.map(m => ({ m, s: attendanceStats(m.id, meetings, att, startOf.get(m.id)) }));
  const gstats = guestList.map(g => ({ m: g, start: startOf.get(g.id), s: startOf.get(g.id) ? attendanceStats(g.id, meetings, gatt, startOf.get(g.id)) : null }));
  const avg = stats.length ? stats.reduce((x, y) => x + y.s.oran, 0) / stats.length : 0;
  // Bu toplantıda üye olmayanlar (daha sonraki bir toplantıda üye alınanlar) listede görünmez.
  const curMembers = members.filter(m => startOf.get(m.id) <= cur.term_no);
  const curMarks = curMembers.map(m => amap.get(cur.id + "|" + m.id)?.status);
  const cnt = k => curMarks.filter(x => x === k).length;
  const guestCame = guestList.filter(g => gmap.get(cur.id + "|" + g.id)?.status === "geldi").length;
  const SEG = [["geldi", "Geldi"], ["gelmedi", "Gelmedi"], ["mazeretli", "Mazeretli"]];
  const SHORT = { geldi: "✓", gelmedi: "✕", mazeretli: "M" };
  const segRow = (p, s, kind) => `<div class="att-row">${person(p)}<div class="seg" role="group" aria-label="${esc(p.full_name)} yoklama">${SEG.map(([k, l]) => `<button type="button" data-${kind}="${p.id}" data-v="${k}" aria-pressed="${s === k}" ${ro ? "disabled" : ""}>${l}</button>`).join("")}</div></div>`;
  const statRow = (p, s, extra) => `<tr><td>${person(p)}</td><td>${extra}</td><td class="num">${s.geldi}</td><td class="num">${s.gelmedi}</td><td class="num">${s.mazeretli}</td><td class="num">${s.isaretsiz}</td>
      <td><div class="row" style="flex-wrap:nowrap"><div class="bar" style="flex:1"><i style="width:${s.oran * 100}%"></i></div><b style="min-width:44px;text-align:right">${pct(s.oran)}</b></div></td><td class="num">${pct(s.oranMazeretHaric)}</td></tr>`;
  const startTxt = no => no > 1 ? `${no}. toplantıdan` : "Dönem başından";
  const matrixRow = (p, map, kind) => { const st = startOf.get(p.id); return `<tr><td title="${esc(p.full_name)}">${esc(p.full_name)}</td>${meetings.map(m => {
    const fut = m.date > today() ? "future" : "";
    if (kind === "cp" && m.term_no < st) return `<td class="${fut}"><span class="cell pre" title="Henüz üye değildi">–</span></td>`;
    const s = map.get(m.id + "|" + p.id)?.status;
    return `<td class="${fut}"><button class="cell ${s || ""}" data-cm="${m.id}" data-${kind}="${p.id}" ${ro ? "disabled" : ""} aria-label="${esc(p.full_name)}, ${m.term_no}. toplantı: ${s || "işaretsiz"}">${s ? SHORT[s] : "·"}</button></td>`;
  }).join("")}</tr>`; };

  v.innerHTML = header("Yoklama", `${esc(term.name)} dönemi · ${term.meeting_count} toplantı · toplantılar iki haftada bir perşembe 19.30`) + roBanner("yoklama") + `
  <div class="stats">
    <div class="stat hl"><span>Yapılan toplantı</span><b>${held.length} / ${term.meeting_count}</b></div>
    <div class="stat"><span>Kulübün toplantı sayısı</span><b>${held.at(-1)?.club_no ?? "–"}</b></div>
    <div class="stat"><span>Ortalama devam</span><b>${pct(avg)}</b></div>
    <div class="stat"><span>Aktif üye · misafir</span><b>${members.length} · ${guestList.length}</b></div>
  </div>
  <div class="card">
    <div class="row" style="margin-bottom:14px">
      <label class="f" style="min-width:260px;flex:1">Toplantı
        <select id="msel">${meetings.map(m => `<option value="${m.id}" ${m.id === cur.id ? "selected" : ""}>${m.term_no}. toplantı · kulübün ${m.club_no}. · ${trDate(m.date)}${m.date > today() ? " · ileride" : ""}${m.label ? ` (${esc(m.label)})` : ""}</option>`).join("")}</select>
      </label>
      <fieldset ${ro ? "disabled" : ""} class="row" style="align-items:flex-end">
        <label class="f">Tarih<input type="date" id="mdate" value="${cur.date}"></label>
        <label class="f" style="min-width:160px">Tür<input type="text" id="mlabel" value="${esc(cur.label || "")}" placeholder="ör. Rotary ortak" list="mlabels"><datalist id="mlabels"><option value="Rotary ortak"><option value="Yaz ortak"><option value="BRT ziyareti"><option value="Grup ortak"></datalist></label>
        <label class="f" style="min-width:200px">Not<input type="text" id="mnote" value="${esc(cur.note)}" placeholder="Konuk, konu…"></label>
        <button class="btn ghost sm" id="msave" style="margin-bottom:4px">Kaydet</button>
      </fieldset>
    </div>
    <div class="row" style="margin-bottom:12px">
      <span class="tag ok">Geldi ${cnt("geldi")}</span><span class="tag bad">Gelmedi ${cnt("gelmedi")}</span><span class="tag warn">Mazeretli ${cnt("mazeretli")}</span><span class="tag">İşaretsiz ${curMarks.filter(x => !x).length}</span><span class="tag cran">Misafir ${guestCame}</span>
      <div class="spacer"></div>
      ${ro ? "" : `<button class="btn ghost sm" id="allin">İşaretsiz üyeleri "geldi" yap</button>`}
    </div>
    <div class="att-list">${curMembers.map(m => segRow(m, amap.get(cur.id + "|" + m.id)?.status, "m")).join("")}</div>
    <h3 style="margin:20px 0 8px">Misafirler</h3>
    ${guestList.length ? `<div class="att-list">${guestList.map(g => segRow(g, gmap.get(cur.id + "|" + g.id)?.status, "g")).join("")}</div>` : `<p class="muted" style="margin:0 0 8px">Henüz misafir eklenmedi.</p>`}
    ${ro ? "" : `<form class="row" id="f-guest" style="margin-top:12px;align-items:flex-end">
      <label class="f" style="flex:1;min-width:200px">Yeni misafir<input type="text" name="full_name" placeholder="Ad soyad" required></label>
      <label class="f" style="min-width:160px">Telefon <small>isteğe bağlı</small><input type="tel" name="phone" placeholder="05xx xxx xx xx"></label>
      <button class="btn sm" style="margin-bottom:4px">Ekle ve "geldi" işaretle</button>
    </form>`}
  </div>
  <div class="card"><h2>Üyelerin devam durumu</h2>
    <p class="muted" style="margin-top:-6px">Oran, üyenin yoklamada başladığı (üye alındığı) toplantıdan bugüne kadar yapılan toplantılara göre hesaplanır. Başlangıç toplantısı Üye listesinde üyeyi düzenleyerek değiştirilir.</p>
    <div class="tbl-wrap"><table><thead><tr><th>Üye</th><th>Başlangıç</th><th class="num">Geldi</th><th class="num">Gelmedi</th><th class="num">Mazeretli</th><th class="num">İşaretsiz</th><th>Devam oranı</th><th class="num">Mazeret hariç</th></tr></thead><tbody>
    ${stats.sort((a, b) => b.s.oran - a.s.oran).map(({ m, s }) => statRow(m, s, startTxt(startOf.get(m.id)))).join("")}
    </tbody></table></div>
  </div>
  <div class="card"><h2>Misafirlerin devam durumu</h2>
    <p class="muted" style="margin-top:-6px">Oran, misafirin ilk geldiği toplantıdan itibaren hesaplanır.</p>
    ${gstats.length ? `<div class="tbl-wrap"><table><thead><tr><th>Misafir</th><th>İlk geldiği</th><th class="num">Geldi</th><th class="num">Gelmedi</th><th class="num">Mazeretli</th><th class="num">İşaretsiz</th><th>Devam oranı</th><th class="num">Mazeret hariç</th></tr></thead><tbody>
    ${gstats.filter(x => x.s).sort((a, b) => b.s.oran - a.s.oran).map(({ m, s, start }) => statRow(m, s, `${start}. toplantı${ro ? "" : ` <button type="button" class="btn ghost sm" data-gdel="${m.id}" aria-label="${esc(m.full_name)} misafirini sil">Sil</button>`}`)).join("")}
    ${gstats.filter(x => !x.s).map(({ m }) => `<tr><td>${person(m)}</td><td colspan="7" class="muted">Henüz yoklama kaydı yok${ro ? "" : ` <button type="button" class="btn ghost sm" data-gdel="${m.id}">Sil</button>`}</td></tr>`).join("")}
    </tbody></table></div>` : `<p class="muted" style="margin:0">Henüz misafir yok. Yukarıdaki yoklamadan misafir ekleyebilirsin.</p>`}
  </div>
  <details class="card"><summary style="cursor:pointer;font-weight:700">Dönemin tamamı (${term.meeting_count} toplantı tablosu)</summary>
    <div class="legend" style="margin:12px 0"><span><span class="cell geldi">✓</span>Geldi</span><span><span class="cell gelmedi">✕</span>Gelmedi</span><span><span class="cell mazeretli">M</span>Mazeretli</span><span><span class="cell">·</span>İşaretsiz</span><span><span class="cell pre">–</span>Henüz üye değil</span>${ro ? "" : "<span>Hücreye tıklayınca durum değişir.</span>"}</div>
    <div class="tbl-wrap"><table class="matrix"><thead><tr><th>Üye</th>${meetings.map(m => `<th class="${m.date > today() ? "future" : ""}" title="${trDate(m.date)}${m.label ? " · " + esc(m.label) : ""}">${m.term_no}${m.label ? `<br><small class="mlabel">(${esc(m.label)})</small>` : ""}</th>`).join("")}</tr></thead><tbody>
    ${members.map(p => matrixRow(p, amap, "cp")).join("")}
    ${guestList.length ? `<tr><th colspan="${meetings.length + 1}" style="text-align:left;padding-top:14px">Misafirler</th></tr>${guestList.map(g => matrixRow(g, gmap, "cg")).join("")}` : ""}
    </tbody></table></div>
  </details>`;

  document.getElementById("msel").onchange = e => { selMeeting = e.target.value; refreshKeep(v, viewAttendance); };
  if (ro) return;
  const run = async (fn, keep = false) => { try { await fn(); refreshKeep(v, viewAttendance, keep); } catch (e) { fail(e); } };
  document.getElementById("msave").onclick = () => run(async () => { await store.updateMeeting(cur.id, { date: document.getElementById("mdate").value, note: document.getElementById("mnote").value, label: document.getElementById("mlabel").value.trim() || null }); toast("Toplantı bilgisi kaydedildi."); });
  v.querySelectorAll(".seg button").forEach(b => b.onclick = () => {
    const was = b.getAttribute("aria-pressed") === "true", val = was ? null : b.dataset.v;
    run(() => b.dataset.g ? store.setGuestAttendance(cur.id, b.dataset.g, val) : store.setAttendance(cur.id, b.dataset.m, val));
  });
  document.getElementById("allin").onclick = () => run(async () => { for (const m of curMembers) if (!amap.get(cur.id + "|" + m.id)) await store.setAttendance(cur.id, m.id, "geldi"); });
  document.getElementById("f-guest").onsubmit = e => {
    e.preventDefault(); const f = e.target, name = f.full_name.value.trim();
    if (!name) return;
    run(async () => { const g = await store.saveGuest({ full_name: name, phone: f.phone.value.trim() }); await store.setGuestAttendance(cur.id, g.id, "geldi"); toast(`${esc(name)} misafir olarak eklendi.`); });
  };
  v.querySelectorAll("[data-gdel]").forEach(b => b.onclick = () => {
    const g = guestList.find(x => x.id === b.dataset.gdel);
    if (g && confirm(`${g.full_name} misafir listesinden ve tüm yoklama kayıtlarından silinsin mi?`)) run(() => store.deleteGuest(g.id));
  });
  const order = [undefined, "geldi", "gelmedi", "mazeretli"];
  v.querySelectorAll("[data-cm]").forEach(b => b.onclick = () => {
    const guest = !!b.dataset.cg, id = guest ? b.dataset.cg : b.dataset.cp;
    const s = (guest ? gmap : amap).get(b.dataset.cm + "|" + id)?.status;
    const next = order[(order.indexOf(s) + 1) % order.length] || null;
    run(() => guest ? store.setGuestAttendance(b.dataset.cm, id, next) : store.setAttendance(b.dataset.cm, id, next), true);
  });
}
// Kaydırma konumunu ve açık <details>'i koruyarak yeniden çiz.
async function refreshKeep(v, fn, keepDetails = false) {
  const y = scrollY, open = keepDetails || v.querySelector("details[open]") != null;
  await fn(v);
  if (open) v.querySelectorAll("details").forEach(d => d.open = true);
  scrollTo(0, y);
}

/* ------------------------------- Aidat ------------------------------- */
async function viewDues(v) {
  const ro = !can(me, "aidat", "edit");
  const [dues, charges, all] = await Promise.all([store.listDues(), store.listCharges(), store.listMembers()]);
  const members = all.filter(m => m.status !== "pending").sort((a, b) => a.full_name.localeCompare(b.full_name, "tr"));
  const mmap = Object.fromEntries(all.map(m => [m.id, m]));
  const total = charges.reduce((s, c) => s + +c.amount, 0);
  const paid = charges.filter(c => c.paid_at).reduce((s, c) => s + +c.amount, 0);
  const dmap = Object.fromEntries(dues.map(d => [d.id, d]));
  const overdue = charges.filter(c => !c.paid_at && dmap[c.due_id]?.due_date < today()).reduce((s, c) => s + +c.amount, 0);
  const ym = today().slice(0, 7);
  v.innerHTML = header("Aidat", "Aidatları dönem dönem gir, ödeyenleri işaretle.") + roBanner("aidat") + `
  <div class="stats">
    <div class="stat"><span>Toplam tahakkuk</span><b>${TL(total)}</b></div>
    <div class="stat"><span>Tahsil edilen</span><b>${TL(paid)}</b></div>
    <div class="stat hl"><span>Bekleyen</span><b>${TL(charges.filter(c => !c.paid_at && isPayOpen(dmap[c.due_id])).reduce((s, c) => s + +c.amount, 0))}</b></div>
    <div class="stat"><span>Son ödeme tarihi geçen</span><b>${TL(overdue)}</b></div>
  </div>
  ${ro ? "" : `<form class="card" id="f-due"><h2>Yeni aidat gir</h2>
    <div class="grid g4">
      <label class="f">Ay<input type="month" name="period" value="${ym}" required></label>
      <label class="f">Açıklama<input type="text" name="label" placeholder="${MONTHS[+ym.slice(5) - 1]} ${ym.slice(0, 4)} aidatı"></label>
      <label class="f">Tutar (TL)<input type="number" name="amount" min="0" step="0.01" required></label>
      <label class="f">Son ödeme tarihi<input type="date" name="due_date" required></label>
    </div>
    <details style="margin-top:12px"><summary style="cursor:pointer;font-weight:600">Kimlere uygulanacak? <span class="muted" id="who-n">Tüm aktif üyeler</span></summary>
      <div class="grid g3" style="margin-top:10px">${members.filter(m => m.status === "active").map(m => `<label class="check"><input type="checkbox" name="mem" value="${m.id}" checked> ${esc(m.full_name)}</label>`).join("")}</div>
    </details>
    <div class="row" style="margin-top:14px"><button class="btn" type="submit">Aidatı ekle</button></div>
  </form>`}
  <div class="card"><h2>Aidat dönemleri</h2>
    ${dues.length ? dues.slice().sort((a, b) => (b.due_date || "").localeCompare(a.due_date || "")).map(d => {
      const cs = charges.filter(c => c.due_id === d.id).sort((a, b) => (mmap[a.member_id]?.full_name || "").localeCompare(mmap[b.member_id]?.full_name || "", "tr"));
      const p = cs.filter(c => c.paid_at).length;
      return `<details class="due"><summary><b>${esc(d.label)}</b><span class="muted">${TL(d.amount)} · son ödeme ${trDate(d.due_date)}</span><div class="spacer"></div>
        ${p < cs.length && !isPayOpen(d) ? notOpenTag(d) : `<span class="tag ${p === cs.length ? "ok" : d.due_date < today() ? "bad" : "warn"}">${p}/${cs.length} ödendi</span>`}</summary>
        <div class="body">${cs.map(c => `<div class="pay-row">${person(mmap[c.member_id] || { full_name: "Silinmiş üye" })}
          ${c.paid_at ? `<span class="tag ok">Ödendi · ${trDate(c.paid_at)}</span>` : !isPayOpen(d) ? notOpenTag(d) : `<span class="tag ${d.due_date < today() ? "bad" : "warn"}">${d.due_date < today() ? "Gecikti" : "Bekliyor"}</span>`}
          ${ro ? "" : c.paid_at ? `<button class="btn ghost sm" data-unpay="${c.id}">Geri al</button>` : `<input type="date" value="${today()}" data-pd="${c.id}" aria-label="Ödeme tarihi" style="width:auto;min-height:32px"><button class="btn sm" data-pay="${c.id}">Ödendi</button>`}
        </div>`).join("")}
        ${ro ? "" : `<div class="row" style="margin-top:10px"><button class="btn danger sm" data-deldue="${d.id}">Bu aidat dönemini sil</button></div>`}</div></details>`;
    }).join("") : `<p class="muted">Henüz aidat girilmedi.</p>`}
  </div>
  <div class="card"><h2>Üye bazında borç</h2><div class="tbl-wrap"><table><thead><tr><th>Üye</th><th class="num">Ödenmemiş dönem</th><th class="num">Gecikmiş</th><th class="num">Toplam borç</th></tr></thead><tbody>
    ${members.map(m => ({ m, d: debtOf(m.id, charges, dues) })).sort((a, b) => b.d.total - a.d.total).map(({ m, d }) => `<tr><td>${person(m)}</td><td class="num">${d.open.length}</td><td class="num">${d.overdue.length ? `<span class="tag bad">${d.overdue.length}</span>` : 0}</td><td class="num"><b>${TL(d.total)}</b></td></tr>`).join("")}
  </tbody></table></div></div>`;
  if (ro) return;
  const f = document.getElementById("f-due");
  f.addEventListener("change", () => { const n = f.querySelectorAll("[name=mem]:checked").length, t = f.querySelectorAll("[name=mem]").length; document.getElementById("who-n").textContent = n === t ? "Tüm aktif üyeler" : `${n} üye seçili`; });
  f.onsubmit = async e => {
    e.preventDefault(); const fd = new FormData(f);
    const period = fd.get("period"); const ids = fd.getAll("mem");
    if (!ids.length) return toast("En az bir üye seçin.", "bad");
    const label = fd.get("label") || `${MONTHS[+period.slice(5) - 1]} ${period.slice(0, 4)} aidatı`;
    try { await store.createDue({ label, period, amount: +fd.get("amount"), due_date: fd.get("due_date"), member_ids: ids }); toast(`${esc(label)} ${ids.length} üyeye eklendi.`); refresh(); } catch (er) { fail(er); }
  };
  v.querySelectorAll("[data-pay]").forEach(b => b.onclick = async () => { const d = v.querySelector(`[data-pd="${b.dataset.pay}"]`).value || today(); try { await store.setChargePaid(b.dataset.pay, d); refreshKeepOpen(v, viewDues); } catch (e) { fail(e); } });
  v.querySelectorAll("[data-unpay]").forEach(b => b.onclick = async () => { try { await store.setChargePaid(b.dataset.unpay, null); refreshKeepOpen(v, viewDues); } catch (e) { fail(e); } });
  v.querySelectorAll("[data-deldue]").forEach(b => b.onclick = async () => { if (!confirm("Bu aidat dönemi ve tüm ödeme kayıtları silinsin mi?")) return; try { await store.deleteDue(b.dataset.deldue); toast("Aidat dönemi silindi."); refresh(); } catch (e) { fail(e); } });
}
async function refreshKeepOpen(v, fn) {
  const y = scrollY; const open = [...v.querySelectorAll("details.due")].map(d => d.open);
  await fn(v); v.querySelectorAll("details.due").forEach((d, i) => d.open = !!open[i]); scrollTo(0, y);
}

/* ---------------------------- Kulüp kasası ---------------------------- */
// Kasa kategorileri kulübün "Kasa Takibi" Excel'ine göre. Bağış yapılan fon artık kategorinin parçası ("Bağış – PolioPlus").
const DON_PREFIX = "Bağış – ";
const FUNDS = ["PolioPlus", "Yıllık Fon (Annual Fund)", "Kalıcı Fon (Endowment)", "Afet Müdahale Fonu", "Diğer"];
const KASA_FUNDS = ["PolioPlus", "Yıllık Fon (Annual Fund)"];
const CATS = {
  gelir: ["Üye aidat tahsilatı", "Misafir toplantı ücreti", "Rozet satışı", "Diğer gelir"],
  gider: ["Bölge katkı payı (BKP)", "UR ödemesi", "Toplantı yeri", ...KASA_FUNDS.map(f => DON_PREFIX + f), "Diğer gider"]
};
// Etkinlik ve projeler önce adıyla açılır; gelir ve giderleri kendi sekmesinden girilir (Excel'deki Etkinlik x / Proje x sayfaları gibi).
// Özette her etkinlik/proje net sonucuyla görünür: artıdaysa Gelirler'de, eksideyse Giderler'de.
const GROUP_CAT = { etkinlik: { gelir: "Etkinlik geliri", gider: "Etkinlik gideri" }, proje: { gelir: "Proje geliri", gider: "Proje gideri" } };
const GROUP_LABEL = { etkinlik: "Etkinlik", proje: "Proje" };
const groupKindOf = c => String(c || "").startsWith("Proje") ? "proje" : String(c || "").startsWith("Etkinlik") ? "etkinlik" : null;
const isDonCat = c => c === "Bağış" || String(c || "").startsWith(DON_PREFIX);
let kasaTab = "ozet", kasaKind = "hepsi", kasaCat = "", kasaAdd = "hareket";
async function viewTreasury(v) {
  const ro = !can(me, "kasa", "edit");
  const [term, txs, charges, dues, meetings, members, savedGroups] = await Promise.all([store.getTerm(), store.listTransactions(), store.listCharges(), store.listDues(), store.listMeetings(), store.listMembers(), store.listKasaGroups().catch(() => [])]);
  // Ödenen aidatlar "Üye aidat tahsilatı" olarak kendiliğinden gelir yazılır.
  const duesIncome = dues.filter(d => d.term_id === term.id).map(d => { const cs = charges.filter(c => c.due_id === d.id && c.paid_at); return { id: "d-" + d.id, date: cs.map(c => c.paid_at).sort().at(-1) || d.due_date, kind: "gelir", category: "Üye aidat tahsilatı", description: `${d.label} (${cs.length} üye)`, amount: cs.reduce((s, c) => s + +c.amount, 0), auto: true }; }).filter(x => x.amount > 0);
  const all = [...txs, ...duesIncome].sort((a, b) => b.date.localeCompare(a.date));
  const sum = list => list.reduce((s, r) => s + +r.amount, 0);

  // Etkinlik/proje listesi: kayıtlı olanlar + kayıtlarda adı geçip listede olmayanlar
  const groups = savedGroups.map(g => ({ ...g }));
  all.forEach(r => { const k = groupKindOf(r.category); if (r.group_name && k && !groups.some(g => g.kind === k && g.name === r.group_name)) groups.push({ id: "n-" + k + "-" + r.group_name, kind: k, name: r.group_name, derived: true }); });
  groups.forEach(g => { g.rows = all.filter(r => r.group_name === g.name && groupKindOf(r.category) === g.kind); g.gi = sum(g.rows.filter(r => r.kind === "gelir")); g.ge = sum(g.rows.filter(r => r.kind === "gider")); g.net = g.gi - g.ge; });
  const inGroup = r => r.group_name && groups.some(g => g.name === r.group_name && g.kind === groupKindOf(r.category));
  const rows = all.filter(r => !inGroup(r));

  // Özet: normal kalemler + etkinlik/proje net sonuçları
  const lines = { gelir: {}, gider: {} };
  rows.forEach(r => { const o = lines[r.kind]; o[r.category || "Diğer"] = (o[r.category || "Diğer"] || 0) + +r.amount; });
  groups.forEach(g => { if (!g.net) return; const side = g.net > 0 ? "gelir" : "gider"; lines[side][`${GROUP_LABEL[g.kind]}: ${g.name}`] = Math.abs(g.net); });
  const inc = Object.values(lines.gelir).reduce((s, x) => s + x, 0), exp = Object.values(lines.gider).reduce((s, x) => s + x, 0);
  const bal = +term.opening_balance + inc - exp;
  const groupByLabel = Object.fromEntries(groups.map(g => [`${GROUP_LABEL[g.kind]}: ${g.name}`, g.id]));
  const sideTbl = (title, kind, total) => `<div class="card" style="margin:0"><h2>${title}</h2><div class="tbl-wrap"><table class="matrix"><thead><tr><th>Kalem</th><th class="num">Tutar</th></tr></thead><tbody>
    ${Object.entries(lines[kind]).sort((a, b) => b[1] - a[1]).map(([c, a]) => `<tr class="kasa-cat" data-cat="${esc(c)}" data-kind="${kind}" ${groupByLabel[c] ? `data-g="${esc(groupByLabel[c])}"` : ""} tabindex="0" role="button"><td>${esc(c)}</td><td class="num">${TL(a)}</td></tr>`).join("") || `<tr><td colspan="2" class="muted">Henüz ${kind} yok.</td></tr>`}
    </tbody><tfoot><tr><th>Toplam</th><th class="num">${TL(total)}</th></tr></tfoot></table></div></div>`;
  const person = r => r.person ? esc(r.person) : '<span class="muted">–</span>';
  const amt = r => `<span style="color:${r.kind === "gelir" ? "var(--ok)" : "var(--bad)"};font-weight:700">${r.kind === "gelir" ? "+" : "−"}${TL(r.amount)}</span>`;
  const delBtn = r => ro ? "" : `<td>${r.auto ? '<span class="muted" style="font-size:.8rem">Aidattan</span>' : `<button class="btn danger sm" data-deltx="${r.id}">Sil</button>`}</td>`;

  const openGroup = kasaTab.startsWith("g:") ? groups.find(g => g.id === kasaTab.slice(2)) : null;
  if (kasaTab.startsWith("g:") && !openGroup) kasaTab = "ozet";
  let body = "";
  if (openGroup) {
    const g = openGroup;
    const side = (kind, title) => {
      const rs = g.rows.filter(r => r.kind === kind).sort((a, b) => a.date.localeCompare(b.date));
      return `<div class="card" style="margin:0"><h2>${title}</h2>
      <div class="tbl-wrap"><table class="matrix"><thead><tr><th>Tarih</th><th>Ne olduğu</th><th class="num">Tutar</th>${ro ? "" : "<th></th>"}</tr></thead><tbody>
      ${rs.map(r => `<tr><td>${trDate(r.date)}</td><td>${esc(r.description)}</td><td class="num">${TL(r.amount)}</td>${ro ? "" : `<td><button class="btn ghost sm" data-deltx="${r.id}" aria-label="Sil">Sil</button></td>`}</tr>`).join("") || `<tr><td colspan="${ro ? 3 : 4}" class="muted">Henüz ${kind} yok.</td></tr>`}
      </tbody><tfoot><tr><th colspan="2">Toplam</th><th class="num">${TL(sum(rs))}</th>${ro ? "" : "<th></th>"}</tr></tfoot></table></div>
      ${ro ? "" : `<form class="g-add" data-kind="${kind}" style="margin-top:12px"><div class="grid g3">
        <label class="f">${kind === "gelir" ? "Gelir tarihi" : "Gider tarihi"}<input type="date" name="date" value="${today()}" required></label>
        <label class="f">Ne olduğu<input type="text" name="description" required placeholder="${kind === "gelir" ? "ör. Bilet satışı" : "ör. Salon kirası"}"></label>
        <label class="f">Tutar (TL)<input type="number" name="amount" min="0.01" step="0.01" required></label>
      </div><div class="row" style="margin-top:10px"><button class="btn sm" type="submit">${kind === "gelir" ? "Gelir ekle" : "Gider ekle"}</button></div></form>`}</div>`;
    };
    body = `<div class="card"><div class="row" style="align-items:center;margin-bottom:12px"><h2 style="margin:0">${esc(g.name)}</h2><span class="tag">${GROUP_LABEL[g.kind]}</span><div class="spacer"></div>
      <span class="tag ${g.net >= 0 ? "ok" : "bad"}">Net ${g.net >= 0 ? "+" : "−"}${TL(Math.abs(g.net))}</span></div>
      <p class="muted" style="margin:-4px 0 14px;font-size:.88rem">Net sonuç özette ${g.net >= 0 ? "Gelirler" : "Giderler"} tarafında görünür ve kasaya bu şekilde yansır.</p>
      <div style="display:grid;gap:14px">${side("gelir", "Gelirler")}${side("gider", "Giderler")}</div>
      ${ro || g.derived ? "" : `<div class="row" style="margin-top:14px"><button class="btn danger sm" id="g-del">${GROUP_LABEL[g.kind] === "Etkinlik" ? "Etkinliği" : "Projeyi"} sil</button></div>`}</div>`;
  } else if (kasaTab === "ozet") {
    body = `<div class="grid g2" style="align-items:start;margin-bottom:10px">${sideTbl("Gelirler", "gelir", inc)}${sideTbl("Giderler", "gider", exp)}</div>
    <p class="muted" style="font-size:.86rem;margin:-4px 0 16px">Bir kaleme tıklarsan ayrıntısı açılır. Etkinlik ve projeler net sonuçlarıyla yazılır: artıdaysa gelirlerde, eksideyse giderlerde.</p>`;
  } else if (kasaTab === "hareket") {
    const cats = [...new Set(rows.map(r => r.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "tr"));
    const shown = rows.filter(r => (kasaKind === "hepsi" || r.kind === kasaKind) && (!kasaCat || r.category === kasaCat));
    body = `<div class="card"><div class="row" style="margin-bottom:12px;align-items:flex-end"><h2 style="margin:0">Kasa hareketleri</h2><div class="spacer"></div>
      <div class="seg" role="group" aria-label="Tür" style="margin-bottom:4px">${[["hepsi", "Hepsi"], ["gelir", "Gelir"], ["gider", "Gider"]].map(([k, l]) => `<button type="button" data-kk="${k}" aria-pressed="${kasaKind === k}">${l}</button>`).join("")}</div>
      <label class="f" style="min-width:200px">Kalem<select id="kasa-cat"><option value="">Tüm kalemler</option>${cats.map(c => `<option ${kasaCat === c ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></label></div>
      <p class="muted" style="margin:-4px 0 12px;font-size:.88rem">${shown.length} hareket. Etkinlik ve proje kayıtları kendi sekmelerinde.</p>
      <div class="tbl-wrap"><table><thead><tr><th>Tarih</th><th>Açıklama</th><th>Kalem</th><th>Ödeyen / Ödemeyi yapan</th><th class="num">Tutar</th>${ro ? "" : "<th></th>"}</tr></thead><tbody>
      ${shown.map(r => `<tr><td>${trDate(r.date)}</td><td>${esc(r.description)}${r.donation_for ? `<br><small class="muted">${esc(r.donation_for)} adına</small>` : ""}</td><td><span class="tag ${r.kind === "gelir" ? "ok" : ""}">${esc(r.category)}</span></td><td>${person(r)}</td><td class="num">${amt(r)}</td>${delBtn(r)}</tr>`).join("") || `<tr><td colspan="6" class="muted">Bu filtrede hareket yok.</td></tr>`}
      </tbody></table></div></div>`;
  } else if (kasaTab === "aidat") {
    const tDues = dues.filter(d => d.term_id === term.id).sort((x, y) => (x.due_date || "").localeCompare(y.due_date || ""));
    const mById = Object.fromEntries(members.map(m => [m.id, m]));
    const mids = [...new Set(charges.filter(c => tDues.some(d => d.id === c.due_id)).map(c => c.member_id))].sort((x, y) => (mById[x]?.full_name || "").localeCompare(mById[y]?.full_name || "", "tr"));
    const manual = rows.filter(r => r.category === "Üye aidat tahsilatı" && !r.auto);
    const manualPeople = [...new Set(manual.map(r => r.person || "Belirtilmedi"))].sort((x, y) => x.localeCompare(y, "tr"));
    const cellOf = (mid, d) => { const c = charges.find(c => c.member_id === mid && c.due_id === d.id); if (!c) return '<span class="muted">–</span>'; if (c.paid_at) return `<span class="tag ok">Ödendi · ${trDate(c.paid_at)}</span>`; if (!isPayOpen(d)) return notOpenTag(d); return d.due_date && d.due_date < today() ? '<span class="tag bad">Gecikti</span>' : '<span class="tag warn">Bekliyor</span>'; };
    const paidOf = mid => sum(charges.filter(c => c.member_id === mid && c.paid_at && tDues.some(d => d.id === c.due_id)));
    const debtOfM = mid => sum(charges.filter(c => c.member_id === mid && !c.paid_at && tDues.some(d => d.id === c.due_id && d.due_date && d.due_date <= today())));
    const totPaid = mids.reduce((s, m) => s + paidOf(m), 0) + sum(manual), totDebt = mids.reduce((s, m) => s + debtOfM(m), 0);
    body = `<div class="card"><h2>Üye aidat tahsilatları</h2>
      <p class="muted" style="margin:-6px 0 12px;font-size:.88rem">Taksitler Aidat sayfasından gelir; ödendi işaretlenen her taksit kasaya "Üye aidat tahsilatı" olarak yazılır. Borç, son ödeme günü geçmiş ve ödenmemiş taksitlerin toplamıdır.</p>
      <div class="stats" style="margin-bottom:12px"><div class="stat"><span>Tahsil edilen</span><b>${TL(totPaid)}</b></div><div class="stat"><span>Vadesi gelmiş borç</span><b>${TL(totDebt)}</b></div></div>
      ${mids.length || manualPeople.length ? `<div class="tbl-wrap"><table class="matrix"><thead><tr><th>Üye</th>${tDues.map(d => `<th>${esc(d.label)}<br><small class="muted">${d.due_date ? trDate(d.due_date) : ""}</small></th>`).join("")}<th class="num">Ödenen</th><th class="num">Borç</th></tr></thead><tbody>
      ${mids.map(mid => `<tr><td><b>${esc(mById[mid]?.full_name || "Silinmiş üye")}</b></td>${tDues.map(d => `<td>${cellOf(mid, d)}</td>`).join("")}<td class="num">${TL(paidOf(mid))}</td><td class="num">${debtOfM(mid) ? `<b style="color:var(--bad)">${TL(debtOfM(mid))}</b>` : TL(0)}</td></tr>`).join("")}
      ${manualPeople.map(p => { const rs = manual.filter(r => (r.person || "Belirtilmedi") === p); return `<tr><td><b>${esc(p)}</b><br><small class="muted">Panelde hesabı yok</small></td><td colspan="${tDues.length || 1}">${rs.map(r => `<span class="tag ok" style="margin:2px 4px 2px 0">${esc(r.description || "Ödeme")} · ${trDate(r.date)}</span>`).join("")}</td><td class="num">${TL(sum(rs))}</td><td class="num muted">–</td></tr>`; }).join("")}
      </tbody><tfoot><tr><th>Toplam</th>${tDues.map(d => `<th>${charges.filter(c => c.due_id === d.id && c.paid_at).length}/${charges.filter(c => c.due_id === d.id).length} ödendi</th>`).join("")}<th class="num">${TL(totPaid)}</th><th class="num">${TL(totDebt)}</th></tr></tfoot></table></div>` : '<p class="muted" style="margin:0">Henüz aidat tanımlanmadı. Aidat sayfasından taksit ekleyebilirsin.</p>'}</div>`;
  } else if (kasaTab === "rozet") {
    const bs = rows.filter(r => r.category === "Rozet satışı").sort((x, y) => y.date.localeCompare(x.date));
    body = `<div class="card"><h2>Rozet satışları</h2>
      <div class="tbl-wrap"><table class="matrix"><thead><tr><th>Tarih</th><th>Rozet</th><th class="num">Adet</th><th class="num">Bir rozetin bedeli</th><th class="num">Toplam</th><th>Satılan kişi</th>${ro ? "" : "<th></th>"}</tr></thead><tbody>
      ${bs.map(r => `<tr><td>${trDate(r.date)}</td><td>${esc(r.badge || r.description || "–")}</td><td class="num">${r.qty ?? "–"}</td><td class="num">${r.unit_price != null ? TL(r.unit_price) : "–"}</td><td class="num"><b>${TL(r.amount)}</b></td><td>${person(r)}</td>${delBtn(r)}</tr>`).join("") || `<tr><td colspan="7" class="muted">Henüz rozet satışı yok. "Hareket ekle → Gelir → Rozet satışı" ile girebilirsin.</td></tr>`}
      </tbody><tfoot><tr><th colspan="2">Toplam</th><th class="num">${bs.reduce((s, r) => s + (+r.qty || 0), 0)}</th><th></th><th class="num">${TL(sum(bs))}</th><th colspan="${ro ? 1 : 2}"></th></tr></tfoot></table></div></div>`;
  } else {
    const ms = rows.filter(r => r.category === "Misafir toplantı ücreti");
    const nos = [...new Set(ms.map(r => r.meeting_no).filter(Boolean))].sort((a, b) => a - b);
    const ppl = [...new Set(ms.map(r => r.person || "Belirtilmedi"))].sort((a, b) => a.localeCompare(b, "tr"));
    const cell = (p, n) => sum(ms.filter(r => (r.person || "Belirtilmedi") === p && +r.meeting_no === n));
    const noMeet = p => sum(ms.filter(r => (r.person || "Belirtilmedi") === p && !r.meeting_no));
    const label = n => { const m = meetings.find(x => +x.club_no === n); return `${n}${m?.term_no ? "/" + m.term_no : ""}`; };
    body = `<div class="card"><h2>Misafir toplantı tahsilatları</h2>
      <p class="muted" style="margin:-6px 0 12px;font-size:.88rem">"Misafir toplantı ücreti" kalemiyle girilen ödemeler misafir ve toplantı bazında.</p>
      ${ppl.length ? `<div class="tbl-wrap"><table class="matrix"><thead><tr><th>Misafir</th>${nos.map(n => `<th class="num">${label(n)}</th>`).join("")}${ms.some(r => !r.meeting_no) ? '<th class="num">Toplantısız</th>' : ""}<th class="num">Toplam</th></tr></thead><tbody>
      ${ppl.map(p => `<tr><td>${esc(p)}</td>${nos.map(n => `<td class="num">${cell(p, n) ? TL(cell(p, n)) : '<span class="muted">–</span>'}</td>`).join("")}${ms.some(r => !r.meeting_no) ? `<td class="num">${noMeet(p) ? TL(noMeet(p)) : "–"}</td>` : ""}<td class="num"><b>${TL(sum(ms.filter(r => (r.person || "Belirtilmedi") === p)))}</b></td></tr>`).join("")}
      </tbody><tfoot><tr><th>Toplam</th>${nos.map(n => `<th class="num">${TL(sum(ms.filter(r => +r.meeting_no === n)))}</th>`).join("")}${ms.some(r => !r.meeting_no) ? `<th class="num">${TL(sum(ms.filter(r => !r.meeting_no)))}</th>` : ""}<th class="num">${TL(sum(ms))}</th></tr></tfoot></table></div>` : '<p class="muted" style="margin:0">Henüz misafir toplantı ücreti girilmedi.</p>'}</div>`;
  }

  const people = [...new Set([...members.map(m => m.full_name), ...rows.map(r => r.person).filter(Boolean)])].sort((a, b) => a.localeCompare(b, "tr"));
  const meetOpts = meetings.filter(m => m.date <= new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10)).slice().sort((a, b) => b.date.localeCompare(a.date)).map(m => `<option value="${m.club_no}">${m.club_no}${m.term_no ? "/" + m.term_no : ""} · ${trDate(m.date)}</option>`).join("");
  const tabBtn = (k, l, extra = "") => `<button type="button" role="tab" data-kt="${esc(k)}" aria-pressed="${kasaTab === k}" aria-selected="${kasaTab === k}">${extra}${l}</button>`;

  v.innerHTML = header("Kulüp kasası", `${esc(term.name)} dönemi kasa takibi`) + roBanner("kasa") + `
  <div class="stats">
    <div class="stat"><span>Kasa başlangıcı</span><b>${TL(term.opening_balance)}</b></div>
    <div class="stat"><span>Toplam gelir</span><b>${TL(inc)}</b></div>
    <div class="stat"><span>Toplam gider</span><b>${TL(exp)}</b></div>
    <div class="stat hl"><span>Güncel kasa</span><b>${TL(bal)}</b></div>
  </div>
  ${ro ? "" : `<div class="card">
    <div class="seg" role="group" aria-label="Ne eklenecek" style="margin-bottom:14px">${[["hareket", "Hareket ekle"], ["etkinlik", "Etkinlik ekle"], ["proje", "Proje ekle"]].map(([k, l]) => `<button type="button" data-ka="${k}" aria-pressed="${kasaAdd === k}">${l}</button>`).join("")}</div>
    ${kasaAdd === "hareket" ? `<form id="f-tx">
    <div class="seg" role="group" aria-label="Tür" style="margin-bottom:12px"><button type="button" data-k="gider" aria-pressed="true">Gider</button><button type="button" data-k="gelir" aria-pressed="false">Gelir</button></div>
    <input type="hidden" name="kind" value="gider">
    <div class="grid g3">
      <label class="f">Tarih<input type="date" name="date" value="${today()}" required></label>
      <label class="f">Kalem<select name="category" id="cat">${CATS.gider.map(c => `<option>${c}</option>`).join("")}</select></label>
      <label class="f" id="amt-f">Tutar (TL)<input type="number" name="amount" min="0.01" step="0.01" required></label>
      <label class="f" id="badge-f" hidden>Hangi rozet<input type="text" name="badge" list="kasa-badges" autocomplete="off" placeholder="ör. Rotaract rozeti"></label>
      <label class="f" id="qty-f" hidden>Rozet sayısı<input type="number" name="qty" min="1" step="1" value="1"></label>
      <label class="f" id="unit-f" hidden>Bir rozetin bedeli (TL)<input type="number" name="unit_price" min="0.01" step="0.01"></label>
      <label class="f" id="desc-f">Açıklama<input type="text" name="description" required placeholder="Ne için?"></label>
      <label class="f"><span id="person-l">Ödemeyi yapan</span><input type="text" name="person" list="kasa-people" autocomplete="off" placeholder="Ad soyad"></label>
      <label class="f" id="meet-f" hidden>Toplantı<select name="meeting_no"><option value="">Seç…</option>${meetOpts}</select></label>
      <label class="f" id="don-f" hidden>Kim adına<input type="text" name="donation_for" placeholder="ör. Kulüp adına / Ad Soyad"></label>
    </div>
    <datalist id="kasa-people">${people.map(p => `<option value="${esc(p)}">`).join("")}</datalist>
    <datalist id="kasa-badges">${[...new Set(rows.map(r => r.badge).filter(Boolean))].map(b => `<option value="${esc(b)}">`).join("")}</datalist>
    <p class="muted" id="badge-total" hidden style="margin:10px 0 0"></p>
    <div class="row" style="margin-top:14px"><button class="btn" type="submit">Ekle</button></div>
    <p class="muted" style="font-size:.84rem;margin:12px 0 0">Ödenen aidatlar kasaya "Üye aidat tahsilatı" olarak kendiliğinden eklenir. "Bağış – …" kalemleri Bağışlar listesine de düşer.</p>
    </form>` : `<form id="f-grp" class="row" style="align-items:flex-end">
      <label class="f" style="flex:1;min-width:220px">${kasaAdd === "etkinlik" ? "Etkinlik adı" : "Proje adı"}<input type="text" name="name" required autocomplete="off" placeholder="${kasaAdd === "etkinlik" ? "ör. Döneme Merhaba Partisi" : "ör. 10 Kasım Kitap Projesi"}"></label>
      <button class="btn" type="submit" style="margin-bottom:4px">${kasaAdd === "etkinlik" ? "Etkinlik ekle" : "Proje ekle"}</button>
    </form>
    <p class="muted" style="font-size:.84rem;margin:12px 0 0">Eklenince adı aşağıdaki sekmelerin yanında görünür; tıklayınca gelir ve giderlerini ayrı ayrı girersin.</p>`}
  </div>`}
  <div class="seg kasa-tabs" role="tablist" aria-label="Kasa görünümü" style="margin:4px 0 14px;flex-wrap:wrap">${tabBtn("ozet", "Özet")}${tabBtn("hareket", "Hareketler")}${tabBtn("misafir", "Misafir tahsilatları")}${tabBtn("aidat", "Aidatlar")}${tabBtn("rozet", "Rozet satışları")}${["etkinlik", "proje"].map(k => { const gs = groups.filter(g => g.kind === k); const on = openGroup?.kind === k; return `<select class="kasa-pick${on ? " on" : ""}" data-kp="${k}" aria-label="${k === "etkinlik" ? "Etkinlik seç" : "Proje seç"}"><option value="">${k === "etkinlik" ? "Etkinlik" : "Proje"} ▾</option>${gs.map(g => `<option value="${esc(g.id)}" ${openGroup?.id === g.id ? "selected" : ""}>${esc(g.name)}</option>`).join("") || `<option disabled>Henüz ${k} yok</option>`}</select>`; }).join("")}</div>
  ${body}
  <form id="f-open" class="card row" style="align-items:flex-end"><fieldset ${ro ? "disabled" : ""} class="row" style="align-items:flex-end;flex:1;border:0;padding:0;margin:0">
    <label class="f" style="flex:1">Kasa başlangıcı (TL) <small>Dönemin ilk günündeki kasa</small><input type="number" step="0.01" name="opening_balance" value="${term.opening_balance}"></label>
    ${ro ? "" : '<button class="btn ghost sm" style="margin-bottom:4px">Güncelle</button>'}</fieldset></form>`;

  const rerender = () => viewTreasury(v);
  v.querySelectorAll("[data-kt]").forEach(b => b.onclick = () => { kasaTab = b.dataset.kt; rerender(); });
  v.querySelectorAll("select[data-kp]").forEach(s => s.onchange = () => { kasaTab = s.value ? "g:" + s.value : "ozet"; rerender(); });
  v.querySelectorAll("[data-kk]").forEach(b => b.onclick = () => { kasaKind = b.dataset.kk; rerender(); });
  const kc = document.getElementById("kasa-cat"); if (kc) kc.onchange = e => { kasaCat = e.target.value; rerender(); };
  v.querySelectorAll("tr.kasa-cat").forEach(tr => { const go = () => { if (tr.dataset.g) kasaTab = "g:" + tr.dataset.g; else { kasaTab = "hareket"; kasaKind = tr.dataset.kind; kasaCat = tr.dataset.cat; } rerender(); }; tr.onclick = go; tr.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } }; });
  if (ro) return;
  v.querySelectorAll("[data-ka]").forEach(b => b.onclick = () => { kasaAdd = b.dataset.ka; rerender(); });
  const fg = document.getElementById("f-grp");
  if (fg) fg.onsubmit = async e => {
    e.preventDefault(); const name = fg.name.value.trim(); if (!name) return;
    try { const g = await store.addKasaGroup(kasaAdd, name); toast(`${GROUP_LABEL[kasaAdd]} eklendi.`); kasaTab = "g:" + g.id; rerender(); } catch (er) { fail(er); }
  };
  const f = document.getElementById("f-tx");
  if (f) {
    // Toplantı yalnızca misafir toplantı ücretinde, "Kim adına" yalnızca bağış giderinde açılır.
    const sync = () => {
      const gelir = f.kind.value === "gelir", c = f.category.value;
      const badge = c === "Rozet satışı";
      document.getElementById("person-l").textContent = c === "Misafir toplantı ücreti" ? "Misafir" : badge ? "Satılan kişi" : gelir ? "Ödeyen" : "Ödemeyi yapan";
      document.getElementById("meet-f").hidden = c !== "Misafir toplantı ücreti";
      ["badge-f", "qty-f", "unit-f", "badge-total"].forEach(id => document.getElementById(id).hidden = !badge);
      document.getElementById("amt-f").hidden = badge; document.getElementById("desc-f").hidden = badge;
      f.amount.required = !badge; f.description.required = !badge; f.badge.required = badge; f.qty.required = badge; f.unit_price.required = badge;
      calc();
      document.getElementById("don-f").hidden = !(!gelir && isDonCat(c));
    };
    f.querySelectorAll("[data-k]").forEach(b => b.onclick = () => {
      f.querySelectorAll("[data-k]").forEach(x => x.setAttribute("aria-pressed", x === b));
      f.kind.value = b.dataset.k; document.getElementById("cat").innerHTML = CATS[b.dataset.k].map(c => `<option>${c}</option>`).join(""); sync();
    });
    // Rozet satışında toplam = rozet sayısı × bir rozetin bedeli
    function calc() { const t = (+f.qty.value || 0) * (+f.unit_price.value || 0); document.getElementById("badge-total").textContent = `Gelire yazılacak tutar: ${f.qty.value || 0} × ${TL(+f.unit_price.value || 0)} = ${TL(t)}`; }
    f.qty.addEventListener("input", calc); f.unit_price.addEventListener("input", calc);
    document.getElementById("cat").addEventListener("change", sync);
    f.onsubmit = async e => {
      e.preventDefault(); const d = Object.fromEntries(new FormData(f)); d.amount = +d.amount;
      if (d.category === "Rozet satışı") { d.qty = +d.qty; d.unit_price = +d.unit_price; d.badge = (d.badge || "").trim(); d.amount = Math.round(d.qty * d.unit_price * 100) / 100; d.description = `${d.badge} × ${d.qty}`; if (!(d.amount > 0)) return toast("Rozet sayısı ve bedeli gerekli.", "bad"); }
      else { d.badge = null; d.qty = null; d.unit_price = null; }
      for (const k of ["person", "donation_for", "description"]) d[k] = (d[k] || "").trim() || null;
      d.group_name = null;
      d.meeting_no = d.category === "Misafir toplantı ücreti" && d.meeting_no ? +d.meeting_no : null;
      const isDon = d.kind === "gider" && isDonCat(d.category);
      if (isDon) d.donation_fund = d.category.startsWith(DON_PREFIX) ? d.category.slice(DON_PREFIX.length) : null; else { d.donation_fund = null; d.donation_for = null; }
      try { await store.addTransaction(d); toast(isDon ? "Kasa hareketi eklendi; bağış Bağışlar listesine aktarıldı." : "Kasa hareketi eklendi."); rerender(); } catch (er) { fail(er); }
    };
  }
  if (openGroup) {
    v.querySelectorAll("form.g-add").forEach(gf => gf.onsubmit = async e => {
      e.preventDefault(); const d = Object.fromEntries(new FormData(gf)); const kind = gf.dataset.kind;
      const row = { kind, category: GROUP_CAT[openGroup.kind][kind], group_name: openGroup.name, date: d.date, description: d.description.trim(), amount: +d.amount, person: null, meeting_no: null, donation_fund: null, donation_for: null };
      try { await store.addTransaction(row); toast(kind === "gelir" ? "Gelir eklendi." : "Gider eklendi."); rerender(); } catch (er) { fail(er); }
    });
    const gd = document.getElementById("g-del");
    if (gd) gd.onclick = async () => {
      if (!confirm(`"${openGroup.name}" ve ${openGroup.rows.length} gelir/gider kaydı silinsin mi?`)) return;
      try { await store.deleteKasaGroup(openGroup.id); toast("Silindi."); kasaTab = "ozet"; rerender(); } catch (er) { fail(er); }
    };
  }
  document.getElementById("f-open").onsubmit = async e => { e.preventDefault(); try { await store.updateTerm({ opening_balance: +e.target.opening_balance.value }); toast("Kasa başlangıcı güncellendi."); rerender(); } catch (er) { fail(er); } };
  v.querySelectorAll("[data-deltx]").forEach(b => b.onclick = async () => { if (!confirm("Bu kayıt silinsin mi?")) return; try { await store.deleteTransaction(b.dataset.deltx); toast("Silindi."); rerender(); } catch (e) { fail(e); } });
}

/* ------------------------------ Projeler ------------------------------ */
const KIND = { hizmet: "Hizmet projesi", etkinlik: "Etkinlik", ocakbasi: "Ocakbaşı", diger: "Diğer" };
const PSTAT = { planlandi: ["Planlandı", "warn"], devam: ["Devam ediyor", "cran"], tamamlandi: ["Tamamlandı", "ok"], iptal: ["İptal", "bad"] };
let projMode = "liste", calMonth = today().slice(0, 7);
async function viewProjects(v) {
  const ro = !can(me, "projeler", "edit");
  const [projects, meetings] = await Promise.all([store.listProjects(), store.listMeetings()]);
  projects.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  // Saat, yer ve durum alanları kaldırıldı: tarihi geçmiş proje "yapıldı" sayılır.
  const up = projects.filter(p => p.date >= today() && p.status !== "iptal");
  const doneP = projects.filter(p => p.date && p.date < today() && p.status !== "iptal");
  v.innerHTML = header("Hizmet projeleri", "Projeleri planla; liste ve takvim birlikte güncellenir.", ro ? "" : `<button class="btn" id="newp">Yeni proje</button>`) + roBanner("projeler") + `
  <div class="stats">
    <div class="stat hl"><span>Yaklaşan</span><b>${up.length}</b></div>
    <div class="stat"><span>Toplam</span><b>${projects.length}</b></div>
    <div class="stat"><span>Yapılan</span><b>${doneP.length}</b></div>
    <div class="stat"><span>Sitede görünen</span><b>${projects.filter(p => p.public).length}</b></div>
  </div>
  <div class="row" style="margin-bottom:14px"><div class="seg" role="group" aria-label="Görünüm"><button data-mode="liste" aria-pressed="${projMode === "liste"}">Liste</button><button data-mode="takvim" aria-pressed="${projMode === "takvim"}">Takvim</button></div></div>
  <div id="pbody"></div><dialog id="dlg"></dialog>`;
  const body = document.getElementById("pbody");
  if (projMode === "liste") {
    body.innerHTML = `<div class="card">${projects.length ? projects.map(p => {
      const d = p.date ? new Date(p.date + "T12:00:00") : null;
      return `<div class="proj"><div class="date">${d ? `<b>${d.getDate()}</b><span>${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}</span>` : "<span>Tarih yok</span>"}</div>
        <div><h3>${esc(p.title)}</h3><div class="row"><span class="tag">${KIND[p.kind] || ""}</span>${p.public ? '<span class="tag cran">Sitede</span>' : ""}<span class="muted" style="font-size:.86rem">${[p.committee, p.owner].filter(Boolean).map(esc).join(" · ")}</span></div>
        ${p.description ? `<p style="white-space:pre-line">${esc(p.description)}</p>` : ""}${p.plan ? `<p class="muted" style="white-space:pre-line"><b style="color:var(--ink)">Nasıl yapılacak:</b> ${esc(p.plan)}</p>` : ""}</div>
        <div class="acts row">${ro ? "" : `<button class="btn ghost sm" data-ep="${p.id}">Düzenle</button>`}</div></div>`;
    }).join("") : '<p class="muted">Henüz proje yok. "Yeni proje" ile ilkini planla.</p>'}</div>`;
  } else {
    const [y, m] = calMonth.split("-").map(Number);
    const first = new Date(y, m - 1, 1), start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));
    const cells = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
    const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    body.innerHTML = `<div class="row" style="margin-bottom:10px"><button class="btn ghost sm" id="prev" aria-label="Önceki ay">‹</button><h2 style="margin:0;font-size:1.15rem;min-width:150px;text-align:center">${MONTHS[m - 1]} ${y}</h2><button class="btn ghost sm" id="next" aria-label="Sonraki ay">›</button><button class="btn ghost sm" id="tdy">Bugün</button><div class="spacer"></div><span class="legend"><span><span class="tag cran">Proje</span></span><span><span class="tag" style="background:#EEF3FB;color:var(--royal)">Toplantı</span></span></span></div>
    <div class="cal">${["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"].map(d => `<div class="dow">${d}</div>`).join("")}
    ${cells.map(d => { const k = iso(d); return `<div class="day ${d.getMonth() !== m - 1 ? "out" : ""} ${k === today() ? "today" : ""}"><span class="n">${d.getDate()}</span>
      ${meetings.filter(x => x.date === k).map(x => `<span class="ev meet">${x.term_no}. toplantı 19.30</span>`).join("")}
      ${projects.filter(p => p.date === k).map(p => `<button class="ev ${p.date < today() ? "done" : ""}" data-ep="${p.id}" title="${esc(p.title)}">${esc(p.title)}</button>`).join("")}</div>`; }).join("")}</div>`;
    const shift = n => { const d = new Date(y, m - 1 + n, 1); calMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; viewProjects(v); };
    document.getElementById("prev").onclick = () => shift(-1);
    document.getElementById("next").onclick = () => shift(1);
    document.getElementById("tdy").onclick = () => { calMonth = today().slice(0, 7); viewProjects(v); };
  }
  v.querySelectorAll("[data-mode]").forEach(b => b.onclick = () => { projMode = b.dataset.mode; viewProjects(v); });
  v.querySelectorAll("[data-ep]").forEach(b => b.onclick = () => ro ? null : editProject(projects.find(p => p.id === b.dataset.ep), v));
  const np = document.getElementById("newp"); if (np) np.onclick = () => editProject(null, v);
}
function editProject(p, v, after = viewProjects) {
  p ||= { title: "", kind: "hizmet", date: "", time: "", location: "", description: "", plan: "", owner: me.full_name, status: "planlandi", public: false };
  const dlg = document.getElementById("dlg");
  dlg.innerHTML = `<form method="dialog">
    <h2>${p.id ? "Projeyi düzenle" : "Yeni proje"}</h2>
    <label class="f">Proje adı<input type="text" name="title" value="${esc(p.title)}" required></label>
    <div class="grid g3">
      <label class="f">Tür<select name="kind">${Object.entries(KIND).map(([k, l]) => `<option value="${k}" ${p.kind === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label class="f">Tarih<input type="date" name="date" value="${esc(p.date)}" required></label>
      <label class="f">Sorumlu<input type="text" name="owner" value="${esc(p.owner)}"></label>
      <label class="f">Komite<select name="committee"><option value="">Seç…</option>${COMMITTEES.map(c => `<option ${p.committee === c ? "selected" : ""}>${c}</option>`).join("")}</select></label>
    </div>
    <label class="f">Kısa açıklama<textarea name="description" rows="2">${esc(p.description)}</textarea></label>
    <label class="f">Nasıl yapılacak? <small>Adımlar, ihtiyaçlar, görev dağılımı</small><textarea name="plan" rows="4">${esc(p.plan)}</textarea></label>
    <label class="check"><input type="checkbox" name="public" ${p.public ? "checked" : ""}> Kulüp sitesindeki takvimde göster</label>
    <div class="row"><button class="btn" value="save">Kaydet</button><button class="btn ghost" value="cancel" formnovalidate>Vazgeç</button><div class="spacer"></div>${p.id ? `<button class="btn danger" value="delete" formnovalidate>Sil</button>` : ""}</div>
  </form>`;
  if (!dlg.open) dlg.showModal();
  dlg.querySelector("form").onsubmit = async e => {
    const act = e.submitter?.value;
    try {
      if (act === "delete") { if (!confirm("Proje silinsin mi?")) { e.preventDefault(); return; } await store.deleteProject(p.id); toast("Proje silindi."); }
      else if (act === "save") {
        const fd = new FormData(e.target); const d = Object.fromEntries(fd); d.public = fd.has("public");
        await store.saveProject(p.id ? { ...d, id: p.id } : d); toast(p.id ? "Proje güncellendi." : "Proje listeye ve takvime eklendi.");
        if (d.date) calMonth = d.date.slice(0, 7);
      } else return;
      after(v);
    } catch (er) { fail(er); }
  };
}

/* ----------------------------- Instagram ----------------------------- */
/* ------------------------- Site düzenleme (HİTK) ------------------------- */
let siteSid = null, siteTab = "metin", siteLang = "index.html";
// Doğrudan düzenleyici: anasayfanın GitHub'daki güncel hâli okunur, düzenlenebilir metinler bölüm bölüm listelenir.
// Her metin kaynakta ">eski</etiket>" biçiminde aranır; bulunamayanlar (kodla üretilen kartlar vb.) listelenmez.
const SITE_TAGS = { h1: "Başlık", h2: "Başlık", h3: "Ara başlık", h4: "Ara başlık", p: "Paragraf", li: "Liste öğesi", summary: "Soru", small: "Küçük yazı", span: "Kısa yazı", a: "Bağlantı / buton", time: "Tarih", b: "Kalın yazı", label: "Form etiketi", figcaption: "Görsel açıklaması", blockquote: "Alıntı", dt: "Terim", dd: "Açıklama" };
const escHtml = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
async function siteBlocks(file) {
  const src = await fetch(`https://raw.githubusercontent.com/cankilicaslan/anittepe-rotaract/main/${file}?t=${Date.now()}`, { cache: "no-store" }).then(r => { if (!r.ok) throw new Error("Anasayfa okunamadı."); return r.text(); });
  const doc = new DOMParser().parseFromString(src, "text/html");
  const sel = Object.keys(SITE_TAGS).join(",");
  const cands = [...doc.body.querySelectorAll(sel)].filter(el => !el.closest("script,style,svg,noscript,template,select,button,.marquee-track[aria-hidden]") && el.textContent.trim().length > 1);
  const set = new Set(cands);
  const blocks = [];
  for (const el of cands) {
    if ([...el.querySelectorAll(sel)].some(c => set.has(c))) continue; // içinde başka düzenlenebilir öğe varsa onlar ayrı listelenir
    const tag = el.tagName.toLowerCase(), inner = el.innerHTML, key = `>${inner}</${tag}>`;
    const n = src.split(key).length - 1;
    if (!n) continue;
    const sec = el.closest("section,header,nav,main");
    const title = el.closest("footer") ? "Alt bilgi" : sec?.querySelector("h2")?.textContent.trim() || (sec?.tagName === "HEADER" || sec?.tagName === "NAV" ? "Üst menü" : "Giriş");
    if (blocks.some(b => b.key === key)) continue;
    blocks.push({ id: blocks.length, tag, key, inner, n, section: title, plain: el.children.length === 0, value: el.children.length === 0 ? el.textContent : inner });
  }
  return { src, blocks };
}
async function siteDirect(box, rerender) {
  let data;
  try { data = await siteBlocks(siteLang); } catch (e) { box.innerHTML = `<p class="muted" style="margin:0">${esc(e.message)} Sayfayı yenileyip tekrar dene.</p>`; return; }
  const { blocks } = data, changed = new Map();
  const sections = [...new Set(blocks.map(b => b.section))];
  box.innerHTML = `<div class="row se-tools">
      <label class="f" style="flex:0 0 auto">Sayfa<select id="se-lang"><option value="index.html" ${siteLang === "index.html" ? "selected" : ""}>Türkçe anasayfa</option><option value="en/index.html" ${siteLang === "en/index.html" ? "selected" : ""}>İngilizce anasayfa</option></select></label>
      <label class="f" style="flex:1 1 220px">Ara<input type="search" id="se-q" placeholder="Değiştirmek istediğin metinden bir parça yaz"></label>
    </div>
    <p class="muted" style="font-size:.86rem;margin:4px 0 12px">Geleneksel projeler, takvim ve sıradaki toplantı kartları kod içinde tutulduğu için burada listelenmez; onlar için "Yapay zekâ ile" sekmesini kullan.</p>
    <div id="se-secs">${sections.map((s, i) => `<details class="se-sec" ${i === 0 ? "open" : ""}><summary><b>${esc(s)}</b> <span class="muted">${blocks.filter(b => b.section === s).length} metin</span></summary>
      ${blocks.filter(b => b.section === s).map(b => `<label class="f se-item" data-b="${b.id}"><span>${SITE_TAGS[b.tag] || b.tag}${b.plain ? "" : " · HTML içerir"}${b.n > 1 ? ` · ${b.n} yerde geçiyor, hepsi değişir` : ""}</span><textarea rows="${Math.min(8, Math.max(1, Math.ceil(b.value.length / 70)))}" data-b="${b.id}">${esc(b.value)}</textarea></label>`).join("")}</details>`).join("")}</div>
    <div class="se-bar" id="se-bar" hidden><span id="se-count"></span><button type="button" class="btn ghost sm" id="se-reset">Değişiklikleri at</button><button type="button" class="btn sm" id="se-review">Gözden geçir ve yayınla</button></div>
    <div id="se-review-box"></div>`;
  const bar = box.querySelector("#se-bar");
  const upd = () => { bar.hidden = !changed.size; box.querySelector("#se-count").textContent = `${changed.size} metin değişti`; };
  box.querySelectorAll("textarea[data-b]").forEach(t => t.addEventListener("input", () => {
    const b = blocks[+t.dataset.b];
    if (t.value === b.value) changed.delete(b.id); else changed.set(b.id, t.value);
    t.closest(".se-item").classList.toggle("on", changed.has(b.id)); upd();
  }));
  box.querySelector("#se-lang").onchange = e => { siteLang = e.target.value; rerender(); };
  box.querySelector("#se-q").addEventListener("input", e => {
    const q = e.target.value.trim().toLocaleLowerCase("tr");
    box.querySelectorAll(".se-sec").forEach(d => { let any = false;
      d.querySelectorAll(".se-item").forEach(it => { const hit = !q || it.querySelector("textarea").value.toLocaleLowerCase("tr").includes(q); it.hidden = !hit; any ||= hit; });
      d.hidden = !any; if (q && any) d.open = true; });
  });
  box.querySelector("#se-reset").onclick = () => rerender();
  box.querySelector("#se-review").onclick = () => {
    const edits = [...changed].map(([id, val]) => { const b = blocks[id], inner = b.plain ? escHtml(val) : val;
      return { file: siteLang, old_str: b.key, new_str: `>${inner}</${b.tag}>`, ...(b.n > 1 ? { all: true } : {}) }; });
    const rb = box.querySelector("#se-review-box");
    rb.innerHTML = `<div class="se-review"><h3 style="margin:0 0 6px">Yayınlanacak değişiklikler</h3>${siteDiff(edits.map(e => ({ ...e, old_str: e.old_str.slice(1, e.old_str.lastIndexOf("</")), new_str: e.new_str.slice(1, e.new_str.lastIndexOf("</")) })))}
      <label class="f" style="margin-top:10px">Not (isteğe bağlı)<input type="text" id="se-note" maxlength="300" placeholder="ör. Toplantı saati güncellendi"></label>
      <div class="row" style="margin-top:10px"><button type="button" class="btn" id="se-pub">Yayınla</button><button type="button" class="btn ghost" id="se-cancel">Düzenlemeye dön</button></div></div>`;
    rb.scrollIntoView({ block: "start", behavior: "smooth" });
    rb.querySelector("#se-cancel").onclick = () => { rb.innerHTML = ""; };
    rb.querySelector("#se-pub").onclick = async e => {
      const btn = e.currentTarget; btn.disabled = true; btn.textContent = "Yayınlanıyor…";
      try { await store.siteEdit({ action: "direct", edits, note: rb.querySelector("#se-note").value }); toast("Yayınlandı. Sitede 1–2 dakika içinde görünür.", "ok"); rerender(); }
      catch (err) { toast(esc(err.message), "bad"); btn.disabled = false; btn.textContent = "Yayınla"; }
    };
  };
}
const SITE_STATUS = { onerildi: ["Onay bekliyor", "warn"], yayinlandi: ["Yayınlandı", "ok"], reddedildi: ["Vazgeçildi", ""], hata: ["Uygulanamadı", "bad"], yanit: ["Yanıt", ""] };
const dt = s => s ? new Date(s).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" }) : "";
const plain = h => { const d = document.createElement("div"); d.innerHTML = h; return (d.textContent || "").replace(/\s+/g, " ").trim(); };
const nl2br = s => s.split("\n").join("<br>");
function siteDiff(edits) {
  return edits.map(e => { const o = plain(e.old_str), n = plain(e.new_str), textOnly = o !== n;
    return `<div class="sdiff"><small class="muted">${e.file === "en/index.html" ? "İngilizce sayfa" : "Türkçe sayfa"}</small>
      ${textOnly ? `<div class="d-old" aria-label="Eski">${esc(o) || "<i>(boş)</i>"}</div><div class="d-new" aria-label="Yeni">${esc(n) || "<i>(silinecek)</i>"}</div>` : `<p class="muted" style="margin:4px 0">Görünen metin aynı; bağlantı ya da görsel gibi kod kısmı değişiyor.</p>`}
      <details><summary>HTML farkı</summary><pre class="d-old">${esc(e.old_str)}</pre><pre class="d-new">${esc(e.new_str)}</pre></details></div>`; }).join("");
}
async function viewSite(v) {
  const rerender = () => viewSite(v), uid = () => crypto.randomUUID();
  const rows = await store.listSiteEdits();
  if (!siteSid) siteSid = rows.find(r => r.user_id === me.id)?.session_id || uid();
  const thread = rows.filter(r => r.session_id === siteSid).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const act = r => r.status === "onerildi" ? `<div class="row" style="margin-top:10px"><button class="btn sm" data-se="publish" data-id="${r.id}">Yayınla</button><button class="btn ghost sm" data-se="reject" data-id="${r.id}">Vazgeç</button></div>`
    : r.status === "yayinlandi" ? `<div class="row" style="margin-top:10px;align-items:center"><span class="muted" style="font-size:.86rem">Yayınlandı · ${dt(r.published_at)}. Sitede 1–2 dakika içinde görünür.</span><a class="btn ghost sm" href="https://anitteperotaract.org/" target="_blank" rel="noopener">Siteyi aç</a><button class="btn ghost sm" data-se="revert" data-id="${r.id}">Geri al</button></div>` : "";
  const bubble = r => `<div class="chat-me"><div class="bub"><p>${nl2br(esc(r.prompt))}</p><small>${esc(r.user_name || "")} · ${dt(r.created_at)}</small></div></div>
    <div class="chat-ai"><div class="bub"><p>${nl2br(esc(r.reply || ""))}</p>
      ${r.status !== "yanit" ? `<span class="tag ${SITE_STATUS[r.status]?.[1] || ""}">${SITE_STATUS[r.status]?.[0] || esc(r.status)}</span>` : ""}
      ${r.error ? `<p class="muted" style="font-size:.86rem;margin:6px 0 0">${esc(r.error)}</p>` : ""}
      ${r.edits?.length ? siteDiff(r.edits) : ""}${act(r)}</div></div>`;
  const tabs = `<div class="seg" role="tablist" aria-label="Düzenleme yöntemi" style="margin:4px 0 14px">${[["metin", "Metinleri düzenle"], ["ai", "Yapay zekâ ile"]].map(([k, l]) => `<button type="button" role="tab" aria-pressed="${siteTab === k}" aria-selected="${siteTab === k}" data-st="${k}">${l}</button>`).join("")}</div>`;
  v.innerHTML = header("Site düzenleme", siteTab === "metin" ? "Anasayfadaki metinleri buradan düzelt; değişiklikleri gözden geçirip tek tıkla yayınla." : "Anasayfada neyin değişmesini istediğini yaz. Yapay zekâ değişikliği hazırlar; sen önce farkı görür, sonra yayınlarsın.", siteTab === "ai" ? `<button class="btn ghost" id="se-new">Yeni sohbet</button>` : "") + tabs + (siteTab === "metin" ? `<div class="card" id="se-direct"><p class="muted" style="margin:0">Anasayfa yükleniyor…</p></div>` : `
  <div class="card chat">
    <div class="chat-log" id="se-log">${thread.map(bubble).join("") || `<p class="muted" style="margin:0">Örnek: "Toplantı saatini 20.00 yap" ya da "Haberlere 26 Kasım'daki kan bağışı etkinliğini ekle; başlık: …, metin: …".</p>`}</div>
    <form id="se-f" class="chat-form">
      <label class="f">İsteğin<textarea name="prompt" rows="3" maxlength="4000" required placeholder="Anasayfada neyi, nasıl değiştirelim?"></textarea></label>
      <div class="row"><button class="btn" type="submit">Gönder</button><span class="muted" id="se-wait" hidden style="font-size:.88rem">Değişiklik hazırlanıyor, bu 30–60 saniye sürebilir…</span></div>
    </form>
  </div>`) + `
  <div class="card"><h2>Kayıtlar</h2><p class="muted" style="margin:-6px 0 12px;font-size:.88rem">Tüm istekler, yapay zekâ yanıtları ve yayınlanan değişiklikler burada saklanır. Bir satıra tıklayınca o sohbet açılır.</p>
    <div class="tbl-wrap"><table><thead><tr><th>Tarih</th><th>Kişi</th><th>İstek</th><th>Durum</th><th class="num">Değişiklik</th><th>Commit</th></tr></thead><tbody>
    ${rows.map(r => `<tr data-sid="${esc(r.session_id)}" style="cursor:pointer"><td>${dt(r.created_at)}</td><td>${esc(r.user_name || "–")}</td><td>${esc(r.prompt.length > 90 ? r.prompt.slice(0, 90) + "…" : r.prompt)}</td><td><span class="tag ${SITE_STATUS[r.status]?.[1] || ""}">${SITE_STATUS[r.status]?.[0] || esc(r.status)}</span></td><td class="num">${r.edits?.length || 0}</td><td>${(r.commit_urls || []).map((u, i) => `<a href="${esc(u)}" target="_blank" rel="noopener">${i + 1}</a>`).join(" ") || "–"}</td></tr>`).join("") || '<tr><td colspan="6" class="muted">Henüz kayıt yok.</td></tr>'}
    </tbody></table></div></div>`;
  v.querySelectorAll("[data-st]").forEach(b => b.onclick = () => { siteTab = b.dataset.st; rerender(); });
  v.querySelectorAll("tr[data-sid]").forEach(tr => tr.onclick = () => { siteSid = tr.dataset.sid; siteTab = "ai"; rerender(); window.scrollTo(0, 0); });
  if (siteTab === "metin") return siteDirect(document.getElementById("se-direct"), rerender);
  const log = document.getElementById("se-log"); log.scrollTop = log.scrollHeight;
  document.getElementById("se-new").onclick = () => { siteSid = uid(); rerender(); };
  v.querySelectorAll("[data-se]").forEach(b => b.onclick = async () => {
    const a = b.dataset.se;
    if (a === "publish" && !confirm("Bu değişiklik canlı siteye yayınlanacak. Devam edilsin mi?")) return;
    v.querySelectorAll("[data-se]").forEach(x => x.disabled = true); b.textContent = a === "publish" ? "Yayınlanıyor…" : "İşleniyor…";
    try { await store.siteEdit({ action: a, id: b.dataset.id }); toast(a === "publish" ? "Yayınlandı. Sitede 1–2 dakika içinde görünür." : a === "revert" ? "Geri alma önerisi hazır; kontrol edip yayınla." : "Öneriden vazgeçildi.", "ok"); }
    catch (e) { toast(esc(e.message), "bad"); }
    rerender();
  });
  const f = document.getElementById("se-f");
  f.prompt.addEventListener("keydown", e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) f.requestSubmit(); });
  f.onsubmit = async e => {
    e.preventDefault(); const prompt = f.prompt.value.trim(); if (!prompt) return;
    const btn = f.querySelector("button"); btn.disabled = true; btn.textContent = "Gönderiliyor…"; document.getElementById("se-wait").hidden = false;
    try { await store.siteEdit({ action: "propose", prompt, session_id: siteSid }); rerender(); }
    catch (err) { toast(esc(err.message), "bad"); btn.disabled = false; btn.textContent = "Gönder"; document.getElementById("se-wait").hidden = true; }
  };
}

async function viewInstagram(v) {
  v.innerHTML = header("Instagram paylaşımı", "Fotoğrafı sürükle, türü seç, bilgileri gir; görsel ve açıklama hazırlansın.") + roBanner("instagram") +
    (store.mode === "demo" ? `<div class="banner info">Demo modunda Instagram'a doğrudan paylaşım ve yapay zekâ kapalı. Görseli indirip açıklamayı kopyalayabilirsin. Gerçek paylaşım için kurulum rehberine bak.</div>` : "") + `<div id="composer"></div>`;
  const { mountComposer } = await import("./composer.js?v=202611141441");
  composerInst = mountComposer(document.getElementById("composer"), { store, me, toast: (m, k) => toast(esc(m), k === "error" ? "bad" : ""), readOnly: !can(me, "instagram", "edit") });
}

/* ------------------------------- Takvim ------------------------------- */
const DAYS_TR = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];
const CAL_TYPES = {
  toplanti: "Toplantı", hizmet: "Proje", etkinlik: "Etkinlik", ocakbasi: "Ocakbaşı", diger: "Diğer", aidat: "Aidat ödemesi", kulup: "Diğer kulüpler"
};
let cal2Month = today().slice(0, 7);
const calOff = new Set();
const longDate = iso => { const d = new Date(iso + "T12:00:00"); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${DAYS_TR[d.getDay()]}`; };

async function calendarItems() {
  const [meetings, projects, dues, charges, clubs, rsvps] = await Promise.all([
    store.listMeetings(), store.listCalendarProjects(), store.listDues(), store.listCharges(), store.listClubEvents(), store.listRsvps()
  ]);
  const items = [];
  meetings.forEach(m => items.push({ date: m.date, type: "toplanti", time: "19.30", title: `${m.term_no}. toplantı${m.label ? ` (${m.label})` : ""}`, sub: `Kulübümüzün ${m.club_no}. toplantısı · Hybrid Hub${m.note ? " · " + m.note : ""}`, ref: m }));
  projects.filter(p => p.date && p.status !== "iptal").forEach(p => items.push({ date: p.date, type: CAL_TYPES[p.kind] ? p.kind : "diger", time: p.time || "", title: p.title, sub: [p.location, p.owner].filter(Boolean).join(" · "), desc: p.description, ref: p, done: p.status === "tamamlandi" }));
  dues.filter(d => d.due_date).forEach(d => {
    const mine = charges.find(c => c.due_id === d.id && c.member_id === me.id);
    const paidN = charges.filter(c => c.due_id === d.id && c.paid_at).length, allN = charges.filter(c => c.due_id === d.id).length;
    items.push({ date: d.due_date, type: "aidat", time: "", title: `Aidat son günü`, sub: `${d.label} · ${TL(d.amount)}${mine ? (mine.paid_at ? " · Ödedin" : " · Henüz ödemedin") : ""}${can(me, "aidat", "view") ? ` · ${paidN}/${allN} ödendi` : ""}`, ref: d, done: !!mine?.paid_at });
  });
  clubs.forEach(e => {
    const mine = rsvps.find(r => r.event_id === e.id && r.member_id === me.id);
    items.push({ date: e.date, type: "kulup", time: e.time || "", title: `${e.club}: ${e.title}`, sub: [e.location, mine ? (mine.status === "katiliyorum" ? "Katılıyorsun" : "Katılamıyorsun") : "Yanıt vermedin"].filter(Boolean).join(" · "), desc: e.description, ref: e });
  });
  return items.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

async function viewCalendar(v) {
  const items = (await calendarItems()).filter(i => !calOff.has(i.type));
  const [y, m] = cal2Month.split("-").map(Number);
  const first = new Date(y, m - 1, 1), start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));
  const weeks = Math.ceil((((first.getDay() + 6) % 7) + new Date(y, m, 0).getDate()) / 7);
  const cells = Array.from({ length: weeks * 7 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const monthItems = items.filter(i => i.date.startsWith(cal2Month));
  const canAdd = can(me, "projeler", "edit");
  const idx = new Map(); items.forEach((it, i) => idx.set(it, i));
  v.innerHTML = header("Takvim", "Toplantılar, projeler, etkinlikler, ocakbaşları, aidat günleri ve diğer kulüplerin etkinlikleri. Yeni bir kayıt eklendiğinde takvim kendiliğinden güncellenir.",
    `<div class="row">${canAdd ? `<button class="btn" id="cal-add">Yeni ekle</button>` : ""}<button class="btn ghost" id="cal-png">PNG indir</button><button class="btn ghost" id="cal-pdf">PDF indir</button></div>`) + `
  <div class="row" style="margin-bottom:12px">
    <button class="btn ghost sm" id="c-prev" aria-label="Önceki ay">‹</button>
    <h2 style="margin:0;font-size:1.2rem;min-width:160px;text-align:center">${MONTHS[m - 1]} ${y}</h2>
    <button class="btn ghost sm" id="c-next" aria-label="Sonraki ay">›</button>
    <button class="btn ghost sm" id="c-today">Bu ay</button>
    <div class="spacer"></div>
    <div class="cal-filters" role="group" aria-label="Takvimde göster">${Object.entries(CAL_TYPES).map(([k, l]) => `<button type="button" class="cf t-${k}" data-f="${k}" aria-pressed="${!calOff.has(k)}">${l}</button>`).join("")}</div>
  </div>
  <div id="cal-export" class="cal-export">
    <div class="cal-print-head"><img src="../assets/logo-cranberry.webp" alt=""><div><b>${MONTHS[m - 1]} ${y} takvimi</b><span>Ankara Anıttepe Rotaract Kulübü · Toplantılar iki haftada bir perşembe 19.30, Hybrid Hub</span></div></div>
    <div class="cal cal2">${["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"].map(d => `<div class="dow">${d}</div>`).join("")}
    ${cells.map(d => { const k = iso(d); const n = items.filter(i => i.date === k).length; return `<div class="day ${d.getMonth() !== m - 1 ? "out" : ""} ${k === today() ? "today" : ""} ${n ? "has" : ""}" data-day="${k}" ${n ? `role="button" tabindex="0" aria-label="${longDate(k)}, ${n} kayıt"` : ""}><span class="n">${d.getDate()}</span>
      ${items.filter(i => i.date === k).map(i => `<button type="button" class="ev t-${i.type} ${i.done ? "done" : ""}" data-i="${idx.get(i)}" title="${esc(i.title)}">${i.time ? `<i>${esc(i.time)}</i> ` : ""}${esc(i.title)}</button>`).join("")}</div>`; }).join("")}
    </div>
    <div class="agenda">
      <h3>${MONTHS[m - 1]} ayında ${monthItems.length ? monthItems.length + " kayıt" : "kayıt yok"}</h3>
      ${monthItems.map(i => `<button type="button" class="ag-row" data-i="${idx.get(i)}"><span class="ag-date">${longDate(i.date)}${i.time ? ` · ${esc(i.time)}` : ""}</span><span class="tag t-${i.type}">${CAL_TYPES[i.type]}</span><span class="ag-t"><b>${esc(i.title)}</b>${i.sub ? `<small>${esc(i.sub)}</small>` : ""}</span></button>`).join("")}
    </div>
  </div>
  <dialog id="dlg"></dialog>`;
  const shift = n => { const d = new Date(y, m - 1 + n, 1); cal2Month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; viewCalendar(v); };
  document.getElementById("c-prev").onclick = () => shift(-1);
  document.getElementById("c-next").onclick = () => shift(1);
  document.getElementById("c-today").onclick = () => { cal2Month = today().slice(0, 7); viewCalendar(v); };
  v.querySelectorAll("[data-f]").forEach(b => b.onclick = () => { calOff.has(b.dataset.f) ? calOff.delete(b.dataset.f) : calOff.add(b.dataset.f); viewCalendar(v); });
  v.querySelectorAll("[data-i]").forEach(b => b.onclick = e => { e.stopPropagation(); calDetail(items[+b.dataset.i], v); });
  const small = () => matchMedia("(max-width: 640px)").matches;
  v.querySelectorAll(".cal2 .day.has").forEach(d => {
    const open = () => {
      const list = items.filter(i => i.date === d.dataset.day);
      if (!small() && list.length === 1) return calDetail(list[0], v);
      const dlg = document.getElementById("dlg");
      dlg.innerHTML = `<form method="dialog"><h2>${longDate(d.dataset.day)}</h2><div class="agenda" style="margin:0">${list.map(i => `<button type="button" class="ag-row" data-j="${idx.get(i)}"><span class="tag t-${i.type}">${CAL_TYPES[i.type]}</span><span class="ag-t"><b>${i.time ? esc(i.time) + " · " : ""}${esc(i.title)}</b>${i.sub ? `<small>${esc(i.sub)}</small>` : ""}</span></button>`).join("")}</div><div class="row"><button class="btn ghost" value="close">Kapat</button></div></form>`;
      if (!dlg.open) dlg.showModal();
      dlg.querySelectorAll("[data-j]").forEach(b => b.onclick = () => calDetail(items[+b.dataset.j], v));
    };
    d.addEventListener("click", open);
    d.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
  });
  if (canAdd) document.getElementById("cal-add").onclick = () => editProject({ title: "", kind: "etkinlik", date: `${cal2Month}-${cal2Month === today().slice(0, 7) ? today().slice(8) : "01"}`, time: "", location: "", description: "", plan: "", owner: me.full_name, status: "planlandi", public: false }, v, viewCalendar);
  document.getElementById("cal-png").onclick = () => exportCalendar("png", `${MONTHS[m - 1]}-${y}`);
  document.getElementById("cal-pdf").onclick = () => exportCalendar("pdf", `${MONTHS[m - 1]}-${y}`);
}

function calDetail(it, v) {
  const dlg = document.getElementById("dlg");
  const canEditProj = ["hizmet", "etkinlik", "ocakbasi", "diger"].includes(it.type) && can(me, "projeler", "edit");
  const canAnnounce = can(me, "duyuru", "edit") && it.type !== "aidat";
  dlg.innerHTML = `<form method="dialog">
    <div class="row"><span class="tag t-${it.type}">${CAL_TYPES[it.type]}</span><span class="muted">${longDate(it.date)}${it.time ? " · " + esc(it.time) : ""}</span></div>
    <h2>${esc(it.title)}</h2>
    ${it.sub ? `<p style="margin:0">${esc(it.sub)}</p>` : ""}
    ${it.desc ? `<p class="muted" style="margin:0;white-space:pre-line">${esc(it.desc)}</p>` : ""}
    ${it.type === "kulup" && it.ref.link ? `<p style="margin:0"><a href="${esc(it.ref.link)}" target="_blank" rel="noopener">Etkinlik bağlantısı</a></p>` : ""}
    <div class="row">
      ${canEditProj ? `<button class="btn" value="edit">Düzenle</button>` : ""}
      ${it.type === "kulup" ? `<button class="btn" value="club">Katılım durumunu seç</button>` : ""}
      ${canAnnounce ? `<button class="btn ghost" value="announce">Duyuru gönder</button>` : ""}
      <button class="btn ghost" value="close">Kapat</button>
    </div></form>`;
  if (!dlg.open) dlg.showModal();
  dlg.querySelector("form").onsubmit = e => {
    const a = e.submitter?.value;
    if (a === "edit") setTimeout(() => editProject(it.ref, v, viewCalendar));
    if (a === "club") location.hash = "#kulupler";
    if (a === "announce") { sessionStorage.setItem("ar-announce", JSON.stringify(announceTemplate(it))); location.hash = "#duyurular"; }
  };
}

const H2C = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
const JSPDF = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
async function exportCalendar(kind, name) {
  const src = document.getElementById("cal-export");
  toast("Takvim hazırlanıyor…");
  const box = document.createElement("div");
  box.className = "cal-export-frame";
  box.appendChild(src.cloneNode(true));
  document.body.appendChild(box);
  try {
    await loadScript(H2C);
    if (kind === "pdf") await loadScript(JSPDF);
    await document.fonts.ready;
    const canvas = await window.html2canvas(box.firstElementChild, { scale: 2, backgroundColor: "#ffffff", useCORS: true, logging: false });
    const file = `anittepe-rotaract-takvim-${name.toLocaleLowerCase("tr").replace(/[^a-z0-9ğüşıöç-]+/g, "-")}`;
    if (kind === "png") {
      const a = document.createElement("a"); a.href = canvas.toDataURL("image/png"); a.download = file + ".png"; a.click();
    } else {
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const W = 297, Hh = 210, mg = 8, iw = W - mg * 2, ih = canvas.height * iw / canvas.width;
      const img = canvas.toDataURL("image/jpeg", 0.92);
      // Uzun aylar birden fazla sayfaya bölünür
      let y = 0; const pageH = Hh - mg * 2;
      while (y < ih) { if (y > 0) pdf.addPage(); pdf.addImage(img, "JPEG", mg, mg - y, iw, ih); y += pageH; }
      pdf.save(file + ".pdf");
    }
    toast(kind === "png" ? "Takvim PNG olarak indirildi." : "Takvim PDF olarak indirildi.");
  } catch (e) { fail(e); } finally { box.remove(); }
}

/* ---------------------- Diğer kulüplerin etkinlikleri ---------------------- */
async function viewClubEvents(v) {
  const [events, rsvps, members] = await Promise.all([store.listClubEvents(), store.listRsvps(), store.listMembers()]);
  const mmap = Object.fromEntries(members.map(x => [x.id, x]));
  const admin = hasRole(me, "baskan");
  const up = events.filter(e => e.date >= today()), past = events.filter(e => e.date < today()).reverse();
  const card = e => {
    const rs = rsvps.filter(r => r.event_id === e.id), mine = rs.find(r => r.member_id === me.id)?.status;
    const yes = rs.filter(r => r.status === "katiliyorum").map(r => mmap[r.member_id]?.full_name).filter(Boolean);
    const no = rs.filter(r => r.status === "katilamiyorum").map(r => mmap[r.member_id]?.full_name).filter(Boolean);
    const d = new Date(e.date + "T12:00:00");
    const mayEdit = admin || e.created_by === me.id;
    return `<div class="proj"><div class="date"><b>${d.getDate()}</b><span>${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}</span></div>
      <div><span class="tag t-kulup">${esc(e.club)}</span><h3 style="margin-top:6px">${esc(e.title)}</h3>
        <p class="muted" style="margin:0;font-size:.88rem">${[DAYS_TR[d.getDay()], e.time, e.location].filter(Boolean).map(esc).join(" · ")}</p>
        ${e.description ? `<p style="white-space:pre-line">${esc(e.description)}</p>` : ""}${e.link ? `<p><a href="${esc(e.link)}" target="_blank" rel="noopener">Etkinlik bağlantısı</a></p>` : ""}
        <div class="row" style="margin-top:10px">
          <div class="seg rsvp" role="group" aria-label="Katılım durumun"><button type="button" data-ev="${e.id}" data-v="katiliyorum" aria-pressed="${mine === "katiliyorum"}">Katılıyorum</button><button type="button" data-ev="${e.id}" data-v="katilamiyorum" aria-pressed="${mine === "katilamiyorum"}">Katılamıyorum</button></div>
          <span class="tag ok">${yes.length} katılıyor</span><span class="tag">${no.length} katılamıyor</span>
        </div>
        ${yes.length || no.length ? `<details style="margin-top:8px"><summary style="cursor:pointer;font-size:.88rem;font-weight:600">Kimler yanıt verdi?</summary><p style="font-size:.88rem;margin:6px 0 0"><b>Katılıyor:</b> ${esc(yes.join(", ") || "Henüz kimse")}</p><p style="font-size:.88rem;margin:4px 0 0"><b>Katılamıyor:</b> ${esc(no.join(", ") || "Kimse")}</p></details>` : ""}
      </div>
      <div class="acts row">${can(me, "duyuru", "edit") ? `<button class="btn ghost sm" data-ann="${e.id}">Duyur</button>` : ""}${mayEdit ? `<button class="btn ghost sm" data-ed="${e.id}">Düzenle</button>` : ""}</div></div>`;
  };
  v.innerHTML = header("Diğer kulüplerin etkinlikleri", "Başka kulüplerin etkinlik ve organizasyonlarını ekle; herkes katılıp katılamayacağını işaretlesin.", `<button class="btn" id="ce-add">Etkinlik ekle</button>`) + `
  <div class="card"><h2>Yaklaşan etkinlikler</h2>${up.length ? up.map(card).join("") : '<p class="muted">Yaklaşan bir etkinlik yok. "Etkinlik ekle" ile ilkini gir.</p>'}</div>
  ${past.length ? `<details class="card"><summary style="cursor:pointer;font-weight:700">Geçmiş etkinlikler (${past.length})</summary>${past.map(card).join("")}</details>` : ""}
  <dialog id="dlg"></dialog>`;
  v.querySelectorAll(".rsvp button").forEach(b => b.onclick = async () => {
    const was = b.getAttribute("aria-pressed") === "true";
    try { await store.setRsvp(b.dataset.ev, was ? null : b.dataset.v); toast(was ? "Yanıtın kaldırıldı." : b.dataset.v === "katiliyorum" ? "Katılacağını işaretledin." : "Katılamayacağını işaretledin."); refreshKeep(v, viewClubEvents); } catch (e) { fail(e); }
  });
  v.querySelectorAll("[data-ed]").forEach(b => b.onclick = () => editClubEvent(events.find(e => e.id === b.dataset.ed), v));
  v.querySelectorAll("[data-ann]").forEach(b => b.onclick = () => { const e = events.find(x => x.id === b.dataset.ann); sessionStorage.setItem("ar-announce", JSON.stringify(announceTemplate({ type: "kulup", date: e.date, time: e.time, title: `${e.club}: ${e.title}`, sub: e.location, desc: e.description, ref: e }))); location.hash = "#duyurular"; });
  document.getElementById("ce-add").onclick = () => editClubEvent(null, v);
}
function editClubEvent(e, v) {
  e ||= { club: "", title: "", date: today(), time: "", location: "", link: "", description: "" };
  const dlg = document.getElementById("dlg");
  dlg.innerHTML = `<form method="dialog">
    <h2>${e.id ? "Etkinliği düzenle" : "Diğer kulübün etkinliğini ekle"}</h2>
    <div class="grid g2">
      <label class="f">Kulüp<input type="text" name="club" value="${esc(e.club)}" required placeholder="ör. Ankara Çankaya Rotaract"></label>
      <label class="f">Etkinlik adı<input type="text" name="title" value="${esc(e.title)}" required></label>
      <label class="f">Tarih<input type="date" name="date" value="${esc(e.date)}" required></label>
      <label class="f">Saat<input type="time" name="time" value="${esc(e.time)}"></label>
      <label class="f">Yer<input type="text" name="location" value="${esc(e.location)}"></label>
      <label class="f">Bağlantı <small>Davet, Instagram gönderisi…</small><input type="url" name="link" value="${esc(e.link)}" placeholder="https://"></label>
    </div>
    <label class="f">Açıklama<textarea name="description" rows="3">${esc(e.description)}</textarea></label>
    <div class="row"><button class="btn" value="save">Kaydet</button><button class="btn ghost" value="cancel" formnovalidate>Vazgeç</button><div class="spacer"></div>${e.id ? `<button class="btn danger" value="delete" formnovalidate>Sil</button>` : ""}</div>
  </form>`;
  if (!dlg.open) dlg.showModal();
  dlg.querySelector("form").onsubmit = async ev => {
    const a = ev.submitter?.value;
    try {
      if (a === "delete") { if (!confirm("Etkinlik ve katılım yanıtları silinsin mi?")) { ev.preventDefault(); return; } await store.deleteClubEvent(e.id); toast("Etkinlik silindi."); }
      else if (a === "save") { const d = Object.fromEntries(new FormData(ev.target)); await store.saveClubEvent(e.id ? { ...d, id: e.id } : d); toast(e.id ? "Etkinlik güncellendi." : "Etkinlik eklendi; takvimde de görünüyor."); }
      else return;
      viewClubEvents(v);
    } catch (er) { fail(er); }
  };
}

/* ------------------------------ Duyurular ------------------------------ */
const CLUB_MAIL = "anitteperotaract1996@gmail.com";
const SIGN = "\n\nAnkara Anıttepe Rotaract Kulübü";
function announceTemplate(it) {
  const when = `${longDate(it.date)}${it.time ? " " + it.time : ""}`;
  if (it.type === "toplanti") return { kind: "toplanti", subject: `${when}: ${it.ref.term_no}. toplantımız`, body: `Merhaba,\n\nDönemimizin ${it.ref.term_no}., kulübümüzün ${it.ref.club_no}. toplantısı ${when}'da Hybrid Hub'da.${it.ref.note ? "\n\nGündem: " + it.ref.note : ""}\n\nGelemeyeceksen lütfen sekreterimize haber ver.` + SIGN };
  if (it.type === "kulup") return { kind: "etkinlik", subject: `${it.title} · ${when}`, body: `Merhaba,\n\n${it.title} etkinliği ${when}${it.sub ? ", " + it.sub : ""}.${it.desc ? "\n\n" + it.desc : ""}\n\nKatılıp katılamayacağını üye panelindeki "Diğer kulüplerin etkinlikleri" sayfasından işaretleyebilirsin: https://anitteperotaract.org/uye/#kulupler` + SIGN };
  const label = CAL_TYPES[it.type] || "Etkinlik";
  return { kind: it.type === "hizmet" ? "proje" : "etkinlik", subject: `${label}: ${it.title} · ${when}`, body: `Merhaba,\n\n${it.title} ${when}${it.ref?.location ? ", " + it.ref.location : ""}.${it.desc ? "\n\n" + it.desc : ""}\n\nSeni de aramızda görmek isteriz.` + SIGN };
}
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isPhone = () => /Android|iPhone|iPod/i.test(navigator.userAgent);
const smsNumber = p => { const d = String(p || "").replace(/\D/g, ""); if (!d) return ""; const n = d.startsWith("90") ? d.slice(2) : d.startsWith("0") ? d.slice(1) : d; return n.length === 10 ? "+90" + n : ""; };

async function viewAnnounce(v) {
  const ro = !can(me, "duyuru", "edit");
  const [members, items, log] = await Promise.all([store.listMembers(), calendarItems(), store.listAnnouncements()]);
  const active = members.filter(m => m.status === "active").sort((a, b) => a.full_name.localeCompare(b.full_name, "tr"));
  const upcoming = items.filter(i => i.date >= today() && i.type !== "aidat").slice(0, 12);
  let pre = null; try { pre = JSON.parse(sessionStorage.getItem("ar-announce") || "null"); sessionStorage.removeItem("ar-announce"); } catch {}
  if (!pre && upcoming[0]) pre = announceTemplate(upcoming.find(i => i.type === "toplanti") || upcoming[0]);
  pre ||= { kind: "diger", subject: "", body: "Merhaba,\n\n" + SIGN };
  const noMail = active.filter(m => !m.email).length, noPhone = active.filter(m => !smsNumber(m.phone)).length;
  v.innerHTML = header("Duyurular", "Toplantı ve etkinlik duyurularını üyelerin e-postasına ve telefonuna gönder.") + (ro ? roBanner("duyuru") : "") +
    (store.mode === "demo" ? `<div class="banner info">Demo modunda gönderim senin cihazından yapılır: "E-posta ile gönder" e-posta uygulamanı, "SMS gönder" telefonunun mesaj uygulamasını alıcılar ve metin hazır şekilde açar; son adımda Gönder'e sen basarsın. Sunucudan otomatik gönderim için kurulum rehberindeki e-posta ve SMS adımları gerekir.</div>` : "") + `
  <form class="card" id="f-ann"><fieldset ${ro ? "disabled" : ""}>
    <label class="f">Hazır metin <small>Takvimdeki yaklaşan kayıtlardan biriyle doldur</small>
      <select id="tpl"><option value="">Seç…</option>${upcoming.map((i, k) => `<option value="${k}">${longDate(i.date)} · ${esc(CAL_TYPES[i.type])}: ${esc(i.title)}</option>`).join("")}</select></label>
    <div class="grid" style="margin-top:12px">
      <label class="f">Konu<input type="text" name="subject" value="${esc(pre.subject)}" required></label>
      <label class="f">Mesaj <small>SMS'te de aynı metin gider; kısa tutmak iyi olur</small><textarea name="body" rows="8" required>${esc(pre.body)}</textarea></label>
      <p class="muted" style="margin:-6px 0 0;font-size:.84rem" id="smslen"></p>
    </div>
    <details style="margin-top:14px" open><summary style="cursor:pointer;font-weight:700">Alıcılar <span class="muted" id="rc"></span></summary>
      <div class="row" style="margin:10px 0"><button type="button" class="btn ghost sm" id="r-all">Hepsini seç</button><button type="button" class="btn ghost sm" id="r-none">Hiçbirini seçme</button>
      ${noMail || noPhone ? `<span class="muted" style="font-size:.84rem">${noMail ? `${noMail} üyenin e-postası, ` : ""}${noPhone ? `${noPhone} üyenin telefonu ` : ""}eksik. Üye listesinden ekleyebilirsin.</span>` : ""}</div>
      <div class="grid g3">${active.map(m => `<label class="check"><input type="checkbox" name="to" value="${m.id}" checked> ${esc(m.full_name)} ${!m.email ? '<span class="tag warn">e-posta yok</span>' : ""}${!smsNumber(m.phone) ? '<span class="tag warn">telefon yok</span>' : ""}</label>`).join("")}</div>
    </details>
    <input type="hidden" name="kind" value="${esc(pre.kind)}">
    <div class="row" style="margin-top:16px">
      <button type="button" class="btn" id="s-mail">E-posta ile gönder</button>
      <button type="button" class="btn" id="s-sms">SMS gönder</button>      <div class="spacer"></div>
      <button type="button" class="btn ghost sm" id="c-mail">E-postaları kopyala</button>
      <button type="button" class="btn ghost sm" id="c-tel">Numaraları kopyala</button>
    </div>
    <p class="muted" style="font-size:.84rem;margin:10px 0 0">${store.mode === "supabase" ? "E-posta, kulüp Gmail hesabından her üyeye ayrı ayrı otomatik gider; alıcılar birbirinin adresini görmez." : "E-postada alıcılar gizli (BCC) eklenir, birbirlerinin adresini görmezler."} SMS, telefondan açıldığında mesaj uygulamanda toplu mesaj olarak hazırlanır.</p>
  </fieldset></form>
  <div class="card"><h2>Gönderilen duyurular</h2>${log.length ? `<div class="tbl-wrap"><table><thead><tr><th>Tarih</th><th>Konu</th><th>Kanal</th><th class="num">Alıcı</th></tr></thead><tbody>${log.map(a => `<tr><td>${trDate(a.created_at.slice(0, 10))}</td><td>${esc(a.subject)}</td><td>${(a.channels || []).map(c => `<span class="tag">${c === "email" ? "E-posta" : "SMS"}</span>`).join(" ")}</td><td class="num">${(a.recipient_ids || []).length}</td></tr>`).join("")}</tbody></table></div>` : '<p class="muted">Henüz duyuru gönderilmedi.</p>'}</div>`;
  if (ro) return;
  const f = document.getElementById("f-ann");
  const sel = () => active.filter(m => f.querySelector(`[name=to][value="${m.id}"]`)?.checked);
  const upd = () => {
    const s = sel(); document.getElementById("rc").textContent = `${s.length} kişi seçili · ${s.filter(m => m.email).length} e-posta · ${s.filter(m => smsNumber(m.phone)).length} telefon`;
    const n = f.body.value.length; document.getElementById("smslen").textContent = `${n} karakter · yaklaşık ${Math.max(1, Math.ceil(n / 153))} SMS`;
  };
  f.addEventListener("input", upd); f.addEventListener("change", upd); upd();
  document.getElementById("tpl").onchange = e => { const it = upcoming[+e.target.value]; if (!it) return; const t = announceTemplate(it); f.subject.value = t.subject; f.body.value = t.body; f.kind.value = t.kind; upd(); };
  document.getElementById("r-all").onclick = () => { f.querySelectorAll("[name=to]").forEach(c => c.checked = true); upd(); };
  document.getElementById("r-none").onclick = () => { f.querySelectorAll("[name=to]").forEach(c => c.checked = false); upd(); };
  const log1 = (channels, sent_via, result) => store.saveAnnouncement({ kind: f.kind.value, subject: f.subject.value, body: f.body.value, channels, recipient_ids: sel().map(m => m.id), sent_via, result }).catch(() => {});
  const copy = async (txt, what) => { try { await navigator.clipboard.writeText(txt); toast(`${what} panoya kopyalandı.`); } catch { prompt("Kopyalayın:", txt); } };
  const mailBtn = document.getElementById("s-mail");
  const openMailApp = async () => {
    if (!f.reportValidity()) return;
    const to = sel().map(m => m.email).filter(Boolean);
    if (!to.length) return toast("Seçili üyelerin hiçbirinin e-postası yok.", "bad");
    const url = `mailto:${CLUB_MAIL}?bcc=${to.map(encodeURIComponent).join(",")}&subject=${encodeURIComponent(f.subject.value)}&body=${encodeURIComponent(f.body.value)}`;
    if (url.length > 1900) toast("Alıcı çok fazla olduğu için bazı e-posta uygulamaları kesebilir; gerekirse adresleri kopyalayıp yapıştır.");
    location.href = url; await log1(["email"], "cihaz"); toast(`E-posta uygulaman ${to.length} alıcıyla açıldı. Gönder'e bastığında duyuru gider.`);
  };
  // Supabase modunda e-posta sunucudan (kulüp Gmail'i) otomatik gider; demo modunda e-posta uygulaması açılır.
  mailBtn.onclick = store.mode !== "supabase" ? openMailApp : async () => {
    if (!f.reportValidity()) return;
    const to = sel().filter(m => m.email);
    if (!to.length) return toast("Seçili üyelerin hiçbirinin e-postası yok.", "bad");
    if (!confirm(`"${f.subject.value}" duyurusu ${to.length} üyeye e-posta ile gönderilsin mi?`)) return;
    mailBtn.disabled = true; mailBtn.textContent = "Gönderiliyor…";
    try {
      const r = await store.sendAnnouncement({ kind: f.kind.value, subject: f.subject.value, body: f.body.value, recipient_ids: to.map(m => m.id), channels: ["email"] });
      if (r.skipped?.email) throw new Error(r.skipped.email);
      const failed = r.email?.failed ?? 0;
      toast(`E-posta gönderildi: ${r.email?.sent ?? 0} kişi.${failed ? ` ${failed} kişiye gidemedi. ${(r.errors || []).join(" ")}` : ""}`, failed ? "bad" : undefined);
      viewAnnounce(v);
    } catch (e) { fail(e); mailBtn.disabled = false; mailBtn.textContent = "E-posta ile gönder"; }
  };  document.getElementById("s-sms").onclick = async () => {
    if (!f.reportValidity()) return;
    const nums = sel().map(m => smsNumber(m.phone)).filter(Boolean);
    if (!nums.length) return toast("Seçili üyelerin hiçbirinin telefonu yok.", "bad");
    const body = encodeURIComponent(f.body.value);
    if (!isPhone()) { await copy(nums.join(", "), `${nums.length} telefon numarası`); toast("SMS telefonda açılır. Bu sayfayı telefondan açıp tekrar dene; numaralar şimdilik panoya kopyalandı."); return; }
    location.href = isIOS() ? `sms:/open?addresses=${nums.join(",")}&body=${body}` : `sms:${nums.join(",")}?body=${body}`;
    await log1(["sms"], "cihaz"); toast(`Mesaj uygulaman ${nums.length} alıcıyla açıldı. Gönder'e bastığında SMS gider.`);
  };
  document.getElementById("c-mail").onclick =() => copy(sel().map(m => m.email).filter(Boolean).join(", "), "E-posta adresleri");
  document.getElementById("c-tel").onclick = () => copy(sel().map(m => smsNumber(m.phone)).filter(Boolean).join(", "), "Telefon numaraları");
}

/* ------------------------- WhatsApp: ortak yardımcılar ------------------------- */
const waNumber = p => smsNumber(p).replace("+", "");            // wa.me 90XXXXXXXXXX biçimi ister
const waOpen = (text, phone = "") => window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
const lsGet = (k, d = "") => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const copyText = async (txt, what = "Metin") => { try { await navigator.clipboard.writeText(txt); toast(`${what} panoya kopyalandı.`); } catch { prompt("Kopyalayın:", txt); } };
// İmza: gönderen o görevin sahibiyse görev adı, değilse (ör. başkan) kendi unvanı yazılır.
// Görüntüleme modu: sayfadaki tüm alan ve düğmeleri kapat (bağlantılar çalışmaya devam eder).
const lockView = root => root.querySelectorAll("input, textarea, select, button").forEach(el => { if (el.tagName === "SELECT" || el.tagName === "BUTTON") el.disabled = true; else el.readOnly = true; });
const signature = (role, label) => `${me.full_name}\n${hasRole(me, role) ? label : me.title || label} · Ankara Anıttepe Rotaract Kulübü`;

/* ---------------- Sekreter: WhatsApp toplantı duyurusu ---------------- */
// Bulunma hâli eki (-da/-de/-ta/-te): yer adı için son ünlü ve son ünsüze, saat için okunuşa göre.
const locSuffix = word => {
  const w = String(word).trim().toLocaleLowerCase("tr"); if (!w) return "";
  const t = w.match(/(\d{1,2})[.:](\d{2})$/);
  if (t) {
    const said = +t[2] || +t[1], u = said % 10, tens = said - u;
    const UN = { 1: "de", 2: "de", 3: "te", 4: "te", 5: "te", 6: "da", 7: "de", 8: "de", 9: "da" }, TEN = { 10: "da", 20: "de", 30: "da", 40: "ta", 50: "de" };
    return "’" + (u ? UN[u] : TEN[tens] || "da");
  }
  const vowels = w.match(/[aıoueiöü]/g) || ["a"], back = "aıou".includes(vowels.at(-1));
  return "’" + ("fstkçşhp".includes(w.at(-1)) ? "t" : "d") + (back ? "a" : "e");
};
// Toplantı duyurusu: kulübün sabit WhatsApp şablonu. Yalnızca toplantı numaraları ve tarihler değişir; imzalar sabittir.
const WA_SIGN = `Rtc. Simay Oğuzkurt
Ankara Anıttepe Rotaract Kulübü
2026-27 Dönem Başkanı

Rtc. Oğulcan Görgülü
Ankara Anıttepe Rotaract Kulübü
2026-27 Dönem Sekreteri`;
async function viewWaMeeting(v) {
  const meetings = await store.listMeetings();
  if (!meetings.length) { v.innerHTML = header("Toplantı duyurusu", "WhatsApp") + `<div class="card"><p class="muted" style="margin:0">Bu dönem için henüz toplantı tanımlanmamış.</p></div>`; return; }
  const next = meetings.find(m => m.date >= today()) || meetings.at(-1);
  v.innerHTML = header("Toplantı duyurusu", "Seçtiğin toplantı için WhatsApp grubuna atılacak duyuru metnini hazırlar.") + roBanner("wa-toplanti") + `
  <div class="grid g2 wa-grid">
    <form class="card" id="f-wam">
      <h2>Toplantı</h2>
      <label class="f">Toplantı<select name="mid">${meetings.map(m => `<option value="${m.id}" ${m.id === next.id ? "selected" : ""}>${m.term_no}. toplantı · kulübün ${m.club_no}. · ${trDate(m.date)}${m.date < today() ? " · yapıldı" : ""}${m.label ? ` (${esc(m.label)})` : ""}</option>`).join("")}</select></label>
      <p class="muted" style="font-size:.86rem;margin:12px 0 0">Metin kulübün sabit duyuru şablonundan oluşur. Toplantıyı seçtiğinde toplantı numaraları, toplantı tarihi ve katılım için son gün (bir gün öncesi) kendiliğinden değişir. Tarih Yoklama sayfasındaki toplantı tarihinden gelir.</p>
    </form>
    <div class="card">
      <h2>WhatsApp mesajı</h2>
      <p class="muted" style="margin-top:-6px;font-size:.86rem">Gerekirse buradan düzenleyebilirsin; başka bir toplantı seçince metin yeniden oluşur.</p>
      <textarea id="wa-text" rows="22" class="wa-text" aria-label="WhatsApp mesajı"></textarea>
      <div class="row" style="margin-top:12px">
        <button type="button" class="btn wa" id="wa-send">WhatsApp grubunda paylaş</button>
        <button type="button" class="btn ghost" id="wa-copy">Metni kopyala</button>
      </div>
      <p class="muted" style="font-size:.84rem;margin:10px 0 0">WhatsApp metin hazır açılır; kulüp grubunu seçip gönderirsin.</p>
    </div>
  </div>`;
  const f = document.getElementById("f-wam"), out = document.getElementById("wa-text");
  const build = () => {
    const m = meetings.find(x => x.id === f.mid.value);
    const d = new Date(m.date + "T12:00:00"), prev = new Date(d); prev.setDate(d.getDate() - 1);
    const fullDate = x => `${x.getDate()} ${MONTHS[x.getMonth()]} ${x.getFullYear()} ${DAYS_TR[x.getDay()]}`;
    const p2 = n => String(n).padStart(2, "0");
    const dotDate = `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()} ${DAYS_TR[d.getDay()]}`;
    return [
      "Kıymetli Anıttepe Rotaract Kulübü Üye ve Misafirleri,", "",
      `Kulübümüzün *${m.club_no}.* ve dönemin *${m.term_no}. toplantısı,* *${fullDate(d)}* günü, saat *19:30’da HybridHub’da* gerçekleştirilecektir.`, "",
      `Katılım durumunuzu ve katılamamanız halinde sebebini, *${fullDate(prev)}* akşamına kadar bildirmeniz gerekmektedir.`, "",
      "Toplantımızda smart casual dress code olduğunu hatırlatmak isteriz.", "",
      `🗓️ : *${dotDate}*`,
      "⏰ : *19:30*",
      "💃🏻 : *Smart Casual*",
      "📍 : *HybridHub*",
      "https://maps.app.goo.gl/SuKHmR4eTei8gXPK7", "",
      "En derin Rotaract Sevgi ve Saygılarımızla,", "",
      WA_SIGN,
    ].join("\n");
  };
  out.value = build();
  f.mid.onchange = () => { out.value = build(); };
  if (!can(me, "wa-toplanti", "edit")) { lockView(v); return; }
  document.getElementById("wa-send").onclick = () => { waOpen(out.value); toast("WhatsApp açıldı. Kulüp grubunu seçip gönder."); };
  document.getElementById("wa-copy").onclick = () => copyText(out.value, "Duyuru metni");
}

/* ---------------- Sayman: WhatsApp aidat / ödeme hatırlatma ---------------- */
async function viewWaDues(v) {
  const [members, charges, dues, payInfo] = await Promise.all([store.listMembers(), store.listCharges(), store.listDues(), store.getSetting("wa_pay").catch(() => null)]);
  const active = members.filter(m => m.status === "active");
  // Yalnızca vadesi geçmiş ya da 15 gün içinde dolacak aidatlar hatırlatılır (ileriki ayların aidatı borç sayılmaz).
  const soon = (() => { const d = new Date(); d.setDate(d.getDate() + 15); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
  const dueNow = id => { const d = debtOf(id, charges, dues); const open = d.open.filter(c => c.due.due_date <= soon); return { ...d, open, total: open.reduce((s, c) => s + +c.amount, 0) }; };
  const debtors = active.map(m => ({ m, d: dueNow(m.id) })).filter(x => x.d.total > 0)
    .sort((a, b) => b.d.total - a.d.total || a.m.full_name.localeCompare(b.m.full_name, "tr"));
  const openDues = dues.filter(d => charges.some(c => c.due_id === d.id && !c.paid_at)).sort((a, b) => a.due_date.localeCompare(b.due_date));
  const defDue = openDues.find(d => d.due_date >= today()) || openDues.at(-1) || dues.at(-1);
  const DEF_PERSONAL = "{ad} selamlar,\n\n{kalemler} için {borc} tutarındaki ödemen henüz bize ulaşmamış görünüyor. Uygun olduğunda aşağıdaki hesaba aktarmanı rica ederim. 🙏\n\n{odeme}\n\nÖdemeyi yaptıysan bu mesajı dikkate alma, teşekkür ederim. 💗";
  const sent = new Set();
  v.innerHTML = header("Aidat hatırlatma", "Aidat ve ödeme hatırlatmalarını WhatsApp'tan gruba ya da kişiye özel gönder.") + roBanner("wa-aidat") + `
  <div class="card">
    <h2>Ödeme bilgisi</h2>
    <label class="f">IBAN ve ödeme açıklaması <small>Grup ve kişiye özel mesajlara eklenir; kulüp genelinde kayıtlıdır</small><textarea id="pay" rows="3" readonly placeholder="IBAN: TR.. .... .... ....\nAlıcı: ...">${esc(payInfo ?? lsGet("ar-wa-pay"))}</textarea></label>
    <div class="row" style="margin-top:10px"><button type="button" class="btn ghost sm" id="pay-edit">Değiştir</button><button type="button" class="btn sm" id="pay-save" hidden>Kaydet</button><button type="button" class="btn ghost sm" id="pay-cancel" hidden>Vazgeç</button></div>
  </div>
  <div class="grid g2 wa-grid">
    <div class="card">
      <h2>Gruba genel hatırlatma</h2>
      ${dues.length ? `<label class="f">Aidat<select id="gdue">${dues.map(d => `<option value="${d.id}" ${d.id === defDue?.id ? "selected" : ""}>${esc(d.label)} · ${TL(d.amount)} · son gün ${trDate(d.due_date)}</option>`).join("")}</select></label>
      <textarea id="gtext" rows="11" class="wa-text" style="margin-top:12px" aria-label="Grup mesajı"></textarea>
      <div class="row" style="margin-top:12px"><button type="button" class="btn wa" id="gsend">WhatsApp grubunda paylaş</button><button type="button" class="btn ghost" id="gcopy">Metni kopyala</button></div>
      <p class="muted" style="font-size:.84rem;margin:10px 0 0">Grup mesajında kimsenin adı ya da borcu yazmaz.</p>` : `<p class="muted" style="margin:0">Henüz aidat oluşturulmadı.</p>`}
    </div>
    <div class="card">
      <h2>Kişiye özel mesaj şablonu</h2>
      <p class="muted" style="margin-top:-6px;font-size:.86rem">Kullanılabilir alanlar: {ad}, {borc}, {kalemler}, {odeme}, {imza}</p>
      <textarea id="ptpl" rows="9" class="wa-text" aria-label="Kişiye özel mesaj şablonu">${esc(lsGet("ar-wa-ptpl3", DEF_PERSONAL))}</textarea>
      <div class="row" style="margin-top:8px"><button type="button" class="btn ghost sm" id="preset">Varsayılan şablona dön</button></div>
    </div>
  </div>
  <div class="card"><h2>Hatırlatılacak üyeler <span class="muted" style="font-weight:600">${debtors.length} kişi · toplam ${TL(debtors.reduce((s, x) => s + x.d.total, 0))}</span></h2>
    ${debtors.length ? `<p class="muted" style="margin-top:-6px;font-size:.86rem">Vadesi geçmiş ya da 15 gün içinde dolacak ödenmemiş aidatlar.</p><div class="tbl-wrap"><table><thead><tr><th>Üye</th><th>Ödenmemiş</th><th class="num">Borç</th><th>Telefon</th><th></th></tr></thead><tbody>
    ${debtors.map(({ m, d }) => `<tr><td>${person(m)}</td><td>${d.open.map(c => `<span class="tag ${c.due.due_date < today() ? "bad" : ""}">${esc(c.due.label)}</span>`).join(" ")}</td><td class="num"><b>${TL(d.total)}</b></td>
      <td>${waNumber(m.phone) ? esc(m.phone) : '<span class="tag warn">Telefon yok</span>'}</td>
      <td><button type="button" class="btn wa sm" data-wa="${m.id}" ${waNumber(m.phone) ? "" : "disabled"}>WhatsApp'tan hatırlat</button></td></tr>`).join("")}
    </tbody></table></div>` : `<p class="muted" style="margin:0">Herkesin aidatı ödenmiş. 🎉</p>`}
  </div>`;
  const pay = document.getElementById("pay"), ptpl = document.getElementById("ptpl");
  const roWa = !can(me, "wa-aidat", "edit");
  pay.oninput = () => gfill();
  // Ödeme bilgisi kilitli durur; "Değiştir" ile düzenlenir, "Kaydet" ile herkes için güncellenir.
  {
    const ed = document.getElementById("pay-edit"), sv = document.getElementById("pay-save"), cn = document.getElementById("pay-cancel");
    let before = pay.value;
    const mode = on => { pay.readOnly = !on; ed.hidden = on; sv.hidden = !on; cn.hidden = !on; if (on) pay.focus(); };
    ed.onclick = () => { before = pay.value; mode(true); };
    cn.onclick = () => { pay.value = before; mode(false); gfill(); };
    sv.onclick = async () => {
      sv.disabled = true;
      try { await store.setSetting("wa_pay", pay.value.trim()); before = pay.value; mode(false); toast("Ödeme bilgisi kaydedildi.", "ok"); }
      catch (e) { toast(esc(e.message), "bad"); }
      finally { sv.disabled = false; }
    };
    if (roWa) ed.hidden = true;
  }
  ptpl.oninput = () => lsSet("ar-wa-ptpl3", ptpl.value);
  document.getElementById("preset").onclick = () => { ptpl.value = DEF_PERSONAL; lsSet("ar-wa-ptpl3", DEF_PERSONAL); };
  const gsel = document.getElementById("gdue"), gtext = document.getElementById("gtext");
  function gfill() {
    if (!gsel) return;
    const d = dues.find(x => x.id === gsel.value);
    // Kulübün sabit aidat hatırlatma şablonu: yalnızca taksit numarası, son gün ve tutar aidattan gelir.
    const no = (d.label.match(/(\d+)\s*\./) || [])[1];
    const what = no ? `${no}. taksit` : d.label;
    gtext.value = [
      "Sevgili Anıttepe Ailesi,", "",
      `${what} ödemeleri için son tarih ${longDate(d.due_date)} günüdür. ${Math.round(+d.amount)}₺ tutarındaki ödemeyi belirtilen hesaba aktarmanız önemle rica olur.`, "",
      ...(pay.value.trim() ? [pay.value.trim(), ""] : []),
      "En derin Rotaractor sevgi ve saygılarımızla,", "",
      "Rtc. Umut Ekin Akkuş",
      "Ankara Anıttepe Rotaract Kulübü",
      "2026-27 Dönem Saymanı",
    ].join("\n");
  }
  if (gsel) {
    gsel.onchange = gfill; gfill();
    document.getElementById("gsend").onclick = () => { waOpen(gtext.value); toast("WhatsApp açıldı. Kulüp grubunu seçip gönder."); };
    document.getElementById("gcopy").onclick = () => copyText(gtext.value, "Hatırlatma metni");
  }
  if (roWa) { lockView(v); return; }
  v.querySelectorAll("[data-wa]").forEach(b => b.onclick = () => {
    const { m, d } = debtors.find(x => x.m.id === b.dataset.wa);
    const text = ptpl.value
      .replaceAll("{ad}", m.full_name.split(" ")[0])
      .replaceAll("{borc}", TL(d.total))
      .replaceAll("{kalemler}", (() => { const ns = d.open.map(c => (c.due.label.match(/^(\d+)\.\s*taksit/) || [])[1]); if (ns.every(Boolean)) { const s = ns.map(n => n + "."); return (s.length > 1 ? s.slice(0, -1).join(", ") + " ve " + s.at(-1) : s[0]) + " taksit"; } return d.open.map(c => c.due.label).join(", "); })())
      .replaceAll("{odeme}", pay.value.trim())
      .replaceAll("{imza}", "Rtc. Umut Ekin Akkuş"+String.fromCharCode(10)+"Ankara Anıttepe Rotaract Kulübü"+String.fromCharCode(10)+"2026-27 Dönem Saymanı")
      .replace(/\n{3,}/g, "\n\n");
    waOpen(text, waNumber(m.phone));
    sent.add(m.id); b.textContent = "Tekrar gönder"; b.classList.add("ghost");
    toast(`${esc(m.full_name)} için WhatsApp açıldı. Gönder'e bas.`);
  });
}

/* ---------------------------- Fotoğraf arşivi ---------------------------- */
const ALBUM_TYPES = { toplanti: ["Toplantılar", "Toplantı"], ocakbasi: ["Ocakbaşları", "Ocakbaşı"], proje: ["Projeler", "Proje"], etkinlik: ["Etkinlik ve organizasyonlar", "Etkinlik / organizasyon"], diger: ["Diğer", "Diğer"] };
const uploadLink = id => `${location.origin}${location.pathname}${location.search}#yukle/${id}`;
const albumHref = a => `#arsiv/${a.type}/${a.id}`;
const canManageAlbums = () => can(me, "arsiv-yonetim", "edit");
const crumbs = list => `<nav class="crumbs" aria-label="Konum">${list.map(([href, label], i) => i < list.length - 1 ? `<a href="${href}">${esc(label)}</a><span aria-hidden="true">›</span>` : `<span aria-current="page">${esc(label)}</span>`).join("")}</nav>`;
const shareLinkBox = a => `<div class="linkbox">
    <label class="f">Yükleme linki<input type="text" readonly value="${esc(uploadLink(a.id))}" id="ul-${a.id}"></label>
    <div class="row"><button type="button" class="btn sm" data-copy="${a.id}">Linki kopyala</button><button type="button" class="btn wa sm" data-wash="${a.id}">WhatsApp'ta paylaş</button><a class="btn ghost sm" href="#yukle/${a.id}">Yükleme sayfasını aç</a></div>
  </div>`;
function bindShare(root, albums) {
  root.querySelectorAll("[data-copy]").forEach(b => b.onclick = () => copyText(uploadLink(b.dataset.copy), "Yükleme linki"));
  root.querySelectorAll("[data-wash]").forEach(b => b.onclick = () => {
    const a = albums.find(x => x.id === b.dataset.wash);
    waOpen(`📸 *${a.name}* (${trDate(a.date)}) fotoğraflarını arşivimize yükleyelim!\n\nÜye hesabınla giriş yapıp telefonundan fotoğrafları seçmen yeterli:\n${uploadLink(a.id)}`);
  });
}

async function viewArchive(v) {
  const [type, albumId] = route;
  if (albumId) return viewAlbum(v, albumId);
  const albums = await store.listAlbums();
  const manager = canManageAlbums();

  if (type && ALBUM_TYPES[type]) {
    const list = albums.filter(a => a.type === type).sort((a, b) => b.date.localeCompare(a.date));
    v.innerHTML = crumbs([["#arsiv", "Fotoğraf arşivi"], ["", ALBUM_TYPES[type][0]]]) + header(ALBUM_TYPES[type][0], `${list.length} etkinlik · ${list.reduce((s, a) => s + a.photo_count, 0)} fotoğraf`) +
      (list.length ? `<div class="album-grid">${list.map(a => `<a class="album-card" href="${albumHref(a)}">
        <div class="cover">${a.cover_url ? `<img src="${esc(a.cover_url)}" alt="" loading="lazy">` : `<span class="empty">Henüz fotoğraf yok</span>`}</div>
        <div class="meta"><b>${esc(a.name)}</b><span>${trDate(a.date)} · ${a.photo_count} fotoğraf</span></div></a>`).join("")}</div>`
        : `<div class="card"><p class="muted" style="margin:0">Bu klasörde henüz etkinlik yok.${manager ? " Fotoğraf arşivi ana sayfasından yükleme linki oluşturabilirsin." : ""}</p></div>`);
    return;
  }

  v.innerHTML = header("Fotoğraf arşivi", "Toplantı, ocakbaşı, proje ve etkinliklerde çekilen fotoğraflar.") +
    (manager ? `<form class="card" id="f-album">
      <h2>Yeni yükleme linki</h2>
      <p class="muted" style="margin-top:-6px;font-size:.88rem">Etkinliği oluştur, linki paylaş. Üyeler giriş yapıp fotoğraflarını telefonlarından doğrudan yükler.</p>
      <div class="grid g3">
        <label class="f">Etkinlik türü<select name="type" required>${Object.entries(ALBUM_TYPES).map(([k, [, one]]) => `<option value="${k}">${one}</option>`).join("")}</select></label>
        <label class="f">Etkinlik adı<input type="text" name="name" required placeholder="ör. Kitap toplama kampanyası"></label>
        <label class="f">Tarih<input type="date" name="date" required value="${today()}"></label>
      </div>
      <div class="row" style="margin-top:14px"><button class="btn">Link oluştur</button></div>
      <div id="newlink"></div>
    </form>` : "") +
    `<div class="folder-grid">${Object.entries(ALBUM_TYPES).map(([k, [label]]) => {
      const list = albums.filter(a => a.type === k), cover = list.find(a => a.cover_url);
      if (k === "diger" && !list.length) return "";
      return `<a class="folder" href="#arsiv/${k}">
        <div class="cover">${cover ? `<img src="${esc(cover.cover_url)}" alt="" loading="lazy">` : `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>`}</div>
        <div class="meta"><b>${label}</b><span>${list.length} etkinlik · ${list.reduce((s, a) => s + a.photo_count, 0)} fotoğraf</span></div></a>`;
    }).join("")}</div>`;

  const f = document.getElementById("f-album");
  if (f) f.onsubmit = async e => {
    e.preventDefault();
    const btn = f.querySelector("button"); btn.disabled = true;
    try {
      const a = await store.createAlbum({ type: f.type.value, name: f.name.value, date: f.date.value });
      document.getElementById("newlink").innerHTML = `<div class="banner info" style="margin-top:14px"><b>${esc(a.name)}</b> için yükleme linki hazır. Kulüp grubunda paylaşabilirsin.</div>` + shareLinkBox(a);
      bindShare(f, [a]);
      f.name.value = "";
      toast("Yükleme linki oluşturuldu.");
    } catch (er) { fail(er); }
    btn.disabled = false;
  };
}

async function viewAlbum(v, albumId) {
  const album = await store.getAlbum(albumId);
  if (!album) { v.innerHTML = crumbs([["#arsiv", "Fotoğraf arşivi"], ["", "Bulunamadı"]]) + `<div class="card"><p class="muted" style="margin:0">Bu albüm bulunamadı ya da silinmiş.</p></div>`; return; }
  const photos = await store.listPhotos(albumId);
  const manager = canManageAlbums();
  const T = ALBUM_TYPES[album.type] || ALBUM_TYPES.diger;
  v.innerHTML = crumbs([["#arsiv", "Fotoğraf arşivi"], [`#arsiv/${album.type}`, T[0]], ["", album.name]]) +
    header(esc(album.name), `${T[1]} · ${trDate(album.date)} · ${photos.length} fotoğraf`, `<a class="btn" href="#yukle/${album.id}">Fotoğraf yükle</a>`) +
    (manager ? `<details class="card"><summary style="cursor:pointer;font-weight:700">Yükleme linki ve albüm ayarları</summary>${shareLinkBox(album)}
      <div class="row" style="margin-top:14px"><button type="button" class="btn danger sm" id="delalbum">Albümü ve tüm fotoğrafları sil</button></div></details>` : "") +
    (photos.some(p => p.uploaded_by === me.id) ? `<p class="muted" style="font-size:.86rem;margin:4px 0 0">Kendi yüklediğin fotoğrafların köşesinde silme düğmesi var; yanlış yüklediğini oradan kaldırabilirsin.</p>` : "") +
    (photos.length ? `<div class="photo-grid">${photos.map((p, i) => `<div class="ph-wrap"><button type="button" class="ph" data-i="${i}" aria-label="Fotoğraf ${i + 1}${p.uploader ? ", yükleyen " + esc(p.uploader) : ""}"><img src="${esc(p.thumb_url)}" alt="" loading="lazy"></button>${p.uploaded_by === me.id ? `<button type="button" class="ph-del" data-del="${i}" aria-label="Yüklediğin ${i + 1}. fotoğrafı sil" title="Sil">✕</button>` : ""}</div>`).join("")}</div>`
      : `<div class="card"><p class="muted" style="margin:0">Bu albümde henüz fotoğraf yok. İlk yükleyen sen ol.</p></div>`) +
    `<dialog id="lb" class="lightbox"></dialog>`;
  bindShare(v, [album]);
  const del = document.getElementById("delalbum");
  if (del) del.onclick = async () => {
    if (!confirm(`"${album.name}" albümü ve içindeki ${photos.length} fotoğraf kalıcı olarak silinsin mi? Bu geri alınamaz.`)) return;
    try { await store.deleteAlbum(album.id); toast("Albüm silindi."); location.hash = `#arsiv/${album.type}`; } catch (e) { fail(e); }
  };
  const lb = document.getElementById("lb");
  let cur = 0;
  const show = i => {
    cur = (i + photos.length) % photos.length; const p = photos[cur];
    const mine = p.uploaded_by === me.id;
    lb.innerHTML = `<div class="lb-top"><span>${cur + 1} / ${photos.length}${p.uploader ? " · " + esc(p.uploader) : ""}</span><div class="spacer"></div>
      <a class="btn ghost sm" href="${esc(p.url)}" target="_blank" rel="noopener">Tam boy aç</a>
      ${mine || manager ? `<button type="button" class="btn ghost sm" id="lb-del">Sil</button>` : ""}
      <button type="button" class="btn ghost sm" id="lb-x" aria-label="Kapat">Kapat</button></div>
      <div class="lb-body"><button type="button" class="lb-nav" id="lb-prev" aria-label="Önceki">‹</button><img src="${esc(p.url)}" alt="${esc(album.name)} fotoğrafı ${cur + 1}"><button type="button" class="lb-nav" id="lb-next" aria-label="Sonraki">›</button></div>`;
    lb.querySelector("#lb-x").onclick = () => lb.close();
    lb.querySelector("#lb-prev").onclick = () => show(cur - 1);
    lb.querySelector("#lb-next").onclick = () => show(cur + 1);
    const d = lb.querySelector("#lb-del");
    if (d) d.onclick = async () => { if (!confirm("Bu fotoğraf silinsin mi?")) return; try { await store.deleteAlbumPhoto(p); lb.close(); toast("Fotoğraf silindi."); viewAlbum(v, albumId); } catch (e) { fail(e); } };
    if (!lb.open) lb.showModal();
  };
  lb.addEventListener("keydown", e => { if (e.key === "ArrowLeft") show(cur - 1); if (e.key === "ArrowRight") show(cur + 1); });
  let x0 = null;
  lb.addEventListener("touchstart", e => { x0 = e.touches[0].clientX; }, { passive: true });
  lb.addEventListener("touchend", e => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 50) show(cur + (dx < 0 ? 1 : -1)); x0 = null; });
  v.querySelectorAll(".ph").forEach(b => b.onclick = () => show(+b.dataset.i));
  // Üye yalnızca kendi yüklediği fotoğrafı ızgaradan silebilir
  v.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
    const p = photos[+b.dataset.del];
    if (!confirm("Yüklediğin bu fotoğraf silinsin mi?")) return;
    try { await store.deleteAlbumPhoto(p); toast("Fotoğraf silindi."); viewAlbum(v, albumId); } catch (e) { fail(e); }
  });
}

async function viewUpload(v) {
  const [albumId] = route;
  const album = albumId ? await store.getAlbum(albumId) : null;
  if (!album) { v.innerHTML = header("Fotoğraf yükle") + `<div class="card"><p class="muted" style="margin:0">Bu yükleme linki geçersiz ya da albüm silinmiş. Linki paylaşan kişiye sorabilirsin.</p><p style="margin:12px 0 0"><a href="#arsiv">Fotoğraf arşivine git</a></p></div>`; return; }
  const T = ALBUM_TYPES[album.type] || ALBUM_TYPES.diger;
  v.innerHTML = header("Fotoğraf yükle", `${T[1]} · ${esc(album.name)} · ${trDate(album.date)}`) + `
  <div class="card upload-card">
    <label class="drop" id="drop">
      <input type="file" accept="image/*" multiple id="files" class="sr">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M12 4v12M7 9l5-5 5 5"/></svg>
      <b>Fotoğrafları seç</b>
      <span>Telefonundan birden fazla fotoğrafı aynı anda seçebilirsin.</span>
    </label>
    <div id="up-status" class="up-status" aria-live="polite"></div>
    <div class="photo-grid sm" id="up-grid"></div>
    <div class="row" style="margin-top:14px"><a class="btn ghost" href="${albumHref(album)}">Albümü gör</a></div>
  </div>`;
  const input = document.getElementById("files"), status = document.getElementById("up-status"), grid = document.getElementById("up-grid"), drop = document.getElementById("drop");
  let done = 0, failed = 0, total = 0, busy = 0;
  const paint = () => { status.innerHTML = total ? `<div class="bar"><i style="width:${Math.round((done + failed) / total * 100)}%"></i></div><p>${done} / ${total} fotoğraf yüklendi${failed ? ` · <span style="color:var(--bad)">${failed} yüklenemedi</span>` : ""}${done + failed === total ? " · tamamlandı ✓" : "…"}</p>` : ""; };
  const run = async files => {
    const list = [...files].filter(f => f.type.startsWith("image/") || /\.(jpe?g|png|heic|heif|webp)$/i.test(f.name));
    if (!list.length) return;
    total += list.length; paint();
    const queue = [...list];
    const worker = async () => {
      while (queue.length) {
        const f = queue.shift(); busy++;
        try {
          const row = await store.uploadAlbumPhoto(album.id, f);
          done++;
          const u = URL.createObjectURL(f); const im = document.createElement("img"); im.src = u; im.alt = ""; im.onload = () => URL.revokeObjectURL(u);
          const c = document.createElement("div"); c.className = "ph-wrap";
          const ph = document.createElement("div"); ph.className = "ph"; ph.appendChild(im); c.appendChild(ph);
          // Yanlış yüklenen fotoğraf hemen geri alınabilir
          const x = document.createElement("button"); x.type = "button"; x.className = "ph-del"; x.textContent = "✕"; x.title = "Sil"; x.setAttribute("aria-label", "Bu fotoğrafı sil");
          x.onclick = async () => {
            if (!confirm("Bu fotoğraf silinsin mi?")) return;
            try { await store.deleteAlbumPhoto(row); c.remove(); done--; total--; paint(); toast("Fotoğraf silindi."); } catch (e) { fail(e); }
          };
          c.appendChild(x); grid.prepend(c);
        } catch (e) { failed++; console.error(e); if (failed === 1) toast(`Bir fotoğraf yüklenemedi: ${esc(e.message)}`, "bad"); }
        busy--; paint();
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    if (!busy && done + failed === total) toast(`${done} fotoğraf "${esc(album.name)}" albümüne eklendi.`);
  };
  input.onchange = () => { run(input.files); input.value = ""; };
  drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", e => { e.preventDefault(); drop.classList.remove("over"); run(e.dataTransfer.files); });
}

/* ------------------------------- Bağışlar ------------------------------- */
const COMMITTEES = ["Hizmet Projeleri", "Üyelik ve Üyeliği Geliştirme", "Uluslararası Hizmetler", "Halkla İlişkiler ve Tanıtım", "Kulüp Hizmetleri", "Afet", "Meslek Hizmetleri", "Interact", "Hobi", "Diğer"];
async function viewDonations(v) {
  const ro = !can(me, "bagis", "edit");
  const list = await store.listDonations();
  const total = list.reduce((s, d) => s + +d.amount, 0);
  const pending = list.filter(d => !d.district_form_at).length;
  const byFund = {}; list.forEach(d => { const k = d.fund || "Belirtilmedi"; byFund[k] = (byFund[k] || 0) + +d.amount; });
  v.innerHTML = header("Bağışlar", "Rotary Vakfı ve benzeri fonlara yapılan bağışlar; kim adına, ne kadar ve bölge formunun girilip girilmediği.") + roBanner("bagis") + `
  <div class="stats">
    <div class="stat hl"><span>Toplam bağış</span><b>${TL(total)}</b></div>
    <div class="stat"><span>Bağış sayısı</span><b>${list.length}</b></div>
    <div class="stat"><span>Bölge formu bekleyen</span><b>${pending}</b></div>
    <div class="stat"><span>Bölge formu girilen</span><b>${list.length - pending}</b></div>
  </div>
  <div class="card"><p class="muted" style="margin:0;font-size:.9rem">Kulüp kasasına <b>Gider → Bağış – (fon adı)</b> kaleminde bir hareket eklendiğinde bağış bu listeye kendiliğinden düşer. Fon kalemden gelir; kimin adına yapıldığını kasaya girerken ya da buradan düzenleyebilirsin.</p></div>
  ${Object.keys(byFund).length ? `<div class="card"><h2>Fonlara göre</h2>${Object.entries(byFund).sort((a, b) => b[1] - a[1]).map(([k, a]) => `<div style="margin-bottom:10px"><div class="row" style="font-size:.9rem"><span>${esc(k)}</span><div class="spacer"></div><b>${TL(a)}</b></div><div class="bar"><i style="width:${a / Math.max(...Object.values(byFund)) * 100}%"></i></div></div>`).join("")}</div>` : ""}
  <div class="card"><h2>Bağış listesi</h2>
    ${list.length ? `<div class="tbl-wrap"><table><thead><tr><th>Tarih</th><th>Fon</th><th>Kim adına</th><th class="num">Tutar</th><th>Bölge formu girildi</th></tr></thead><tbody>
    ${list.map(d => `<tr data-id="${d.id}">
      <td>${trDate(d.date)}</td>
      <td>${ro ? esc(d.fund || "–") : `<select data-f="fund" aria-label="Fon"><option value="">Seç…</option>${FUNDS.map(f => `<option ${d.fund === f ? "selected" : ""}>${f}</option>`).join("")}${d.fund && !FUNDS.includes(d.fund) ? `<option selected>${esc(d.fund)}</option>` : ""}</select>`}</td>
      <td>${ro ? esc(d.on_behalf || "–") : `<input type="text" data-f="on_behalf" value="${esc(d.on_behalf || "")}" placeholder="ör. Kulüp adına / Ad Soyad" aria-label="Kim adına">`}</td>
      <td class="num"><b>${TL(d.amount)}</b>${d.note ? `<br><small class="muted">${esc(d.note)}</small>` : ""}</td>
      <td><label class="check" style="margin:0"><input type="checkbox" data-form ${d.district_form_at ? "checked" : ""} ${ro ? "disabled" : ""}> ${d.district_form_at ? (ro ? `<span>${trDate(d.district_form_at)}</span>` : "") : '<span class="muted">Girilmedi</span>'}</label>${d.district_form_at && !ro ? `<input type="date" data-fd value="${d.district_form_at}" aria-label="Bölge formunun girildiği tarih" style="margin-top:6px">` : ""}</td>
    </tr>`).join("")}</tbody></table></div>` : `<p class="muted" style="margin:0">Henüz bağış yok. Kulüp kasasına "Bağış – …" kaleminde gider eklendiğinde burada görünür.</p>`}
  </div>`;
  if (ro) return;
  const save = async (id, patch, msg) => { try { await store.updateDonation(id, patch); if (msg) toast(msg); viewDonations(v); } catch (e) { fail(e); } };
  v.querySelectorAll("tr[data-id]").forEach(tr => {
    const id = tr.dataset.id;
    tr.querySelector('[data-f="fund"]').onchange = e => save(id, { fund: e.target.value || null }, "Fon kaydedildi.");
    const ob = tr.querySelector('[data-f="on_behalf"]'); ob.onchange = () => save(id, { on_behalf: ob.value.trim() || null }, "Kaydedildi.");
    const fd = tr.querySelector("[data-fd]"); if (fd) fd.onchange = () => fd.value && save(id, { district_form_at: fd.value }, "Tarih kaydedildi.");
    tr.querySelector("[data-form]").onchange = e => save(id, { district_form_at: e.target.checked ? today() : null }, e.target.checked ? "Bölge formu girildi olarak işaretlendi." : "İşaret kaldırıldı.");
  });
}

/* ----------------------------- Proje formları ----------------------------- */
let pfFilter = "hepsi", pfCom = "";
async function viewProjectForms(v) {
  const ro = !can(me, "proje-form", "edit");
  const all = await store.listProjects();
  // Yapılan projeler: tarihi gelmiş ya da proje formu girilmiş olanlar
  const done = all.filter(p => p.status !== "iptal" && (p.form_submitted_at || (p.date && p.date <= today())))
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const withForm = done.filter(p => p.form_submitted_at);
  const comOf = p => p.committee || "Belirtilmedi";
  const byCom = {};
  done.forEach(p => { const k = comOf(p); byCom[k] ||= { done: 0, form: 0 }; byCom[k].done++; if (p.form_submitted_at) byCom[k].form++; });
  const shown = done.filter(p => (!pfCom || comOf(p) === pfCom) && (pfFilter === "hepsi" || (pfFilter === "girildi" ? p.form_submitted_at : !p.form_submitted_at)));
  const comOptions = [...COMMITTEES, ...(byCom["Belirtilmedi"] ? ["Belirtilmedi"] : [])];
  v.innerHTML = header("Proje formları", "Yapılan projeler, hangi komiteden yapıldığı ve bölgeye proje formunun girildiği tarih.", ro ? "" : `<button class="btn" id="pf-add">Proje ekle</button>`) + roBanner("proje-form") + `
  <div class="stats">
    <div class="stat hl"><span>Yapılan proje</span><b>${done.length}</b></div>
    <div class="stat"><span>Proje formu girilen</span><b>${withForm.length}</b></div>
    <div class="stat"><span>Form bekleyen</span><b>${done.length - withForm.length}</b></div>
    <div class="stat"><span>Proje yapan komite</span><b>${Object.keys(byCom).filter(k => k !== "Belirtilmedi").length}</b></div>
  </div>
  <div class="card"><h2>Komitelere göre</h2>
    <p class="muted" style="margin:-6px 0 10px;font-size:.88rem">Bir komiteye tıklayınca aşağıdaki liste o komiteye göre süzülür.</p>
    ${Object.keys(byCom).length ? `<div class="tbl-wrap"><table><thead><tr><th>Komite</th><th class="num">Yapılan proje</th><th class="num">Proje formu girilen</th><th class="num">Form bekleyen</th><th>Oran</th></tr></thead><tbody>
    ${Object.entries(byCom).sort((a, b) => b[1].done - a[1].done).map(([k, c]) => `<tr class="pf-com ${pfCom === k ? "sel" : ""}" data-com="${esc(k)}" tabindex="0" role="button" aria-pressed="${pfCom === k}"><td><b>${esc(k)}</b></td><td class="num">${c.done}</td><td class="num">${c.form}</td><td class="num">${c.done - c.form}</td><td><div class="row" style="flex-wrap:nowrap"><div class="bar" style="flex:1"><i style="width:${c.form / c.done * 100}%"></i></div><b style="min-width:44px;text-align:right">${pct(c.form / c.done)}</b></div></td></tr>`).join("")}
    </tbody></table></div>` : `<p class="muted" style="margin:0">Henüz proje yok.${ro ? "" : ' "Proje ekle" ile ilkini gir.'}</p>`}
  </div>
  <div class="card">
    <div class="row" style="margin-bottom:12px;align-items:flex-end"><h2 style="margin:0">Projeler</h2><div class="spacer"></div>
      <label class="f" style="min-width:220px">Komite<select id="pf-com"><option value="">Tüm komiteler</option>${comOptions.map(c => `<option ${pfCom === c ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></label>
      <div class="seg" role="group" aria-label="Proje formu durumu" style="margin-bottom:4px">${[["hepsi", "Hepsi"], ["girildi", "Form girilen"], ["bekleyen", "Form bekleyen"]].map(([k, l]) => `<button type="button" data-pf="${k}" aria-pressed="${pfFilter === k}">${l}</button>`).join("")}</div>
    </div>
    <p class="muted" style="margin:-4px 0 12px;font-size:.88rem">${shown.length} proje gösteriliyor${pfCom ? ` · ${esc(pfCom)}` : ""}. Hizmet projeleri sayfasında tarihi gelen projeler de buraya kendiliğinden düşer.</p>
    ${shown.length ? `<div class="tbl-wrap"><table><thead><tr><th>Proje</th><th>Komite</th><th>Proje tarihi</th><th>Proje formu girildi</th>${ro ? "" : "<th></th>"}</tr></thead><tbody>
    ${shown.map(p => `<tr data-id="${p.id}">
      <td><b>${esc(p.title)}</b>${p.owner ? `<br><small class="muted">${esc(p.owner)}</small>` : ""}</td>
      <td>${p.committee ? esc(p.committee) : '<span class="muted">Belirtilmedi</span>'}</td>
      <td>${p.date ? trDate(p.date) : "–"}</td>
      <td>${p.form_submitted_at ? `<span class="tag ok">${trDate(p.form_submitted_at)}</span>` : (ro ? '<span class="muted">Girilmedi</span>' : '<button type="button" class="btn ghost sm" data-today>Bugün girildi</button>')}</td>
      ${ro ? "" : '<td><button type="button" class="btn ghost sm" data-edit>Düzenle</button></td>'}
    </tr>`).join("")}</tbody></table></div>` : '<p class="muted" style="margin:0">Bu filtrede proje yok.</p>'}
  </div>
  <dialog id="dlg"></dialog>`;

  const rerender = () => viewProjectForms(v);
  v.querySelectorAll("[data-pf]").forEach(b => b.onclick = () => { pfFilter = b.dataset.pf; rerender(); });
  document.getElementById("pf-com").onchange = e => { pfCom = e.target.value; rerender(); };
  v.querySelectorAll("tr.pf-com").forEach(tr => {
    const pick = () => { pfCom = pfCom === tr.dataset.com ? "" : tr.dataset.com; rerender(); };
    tr.onclick = pick; tr.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } };
  });
  if (ro) return;
  document.getElementById("pf-add").onclick = () => projectFormDialog(null, rerender);
  v.querySelectorAll("tr[data-id]").forEach(tr => {
    const p = done.find(x => x.id === tr.dataset.id);
    tr.querySelector("[data-edit]").onclick = () => projectFormDialog(p, rerender);
    const t = tr.querySelector("[data-today]");
    if (t) t.onclick = async () => { try { await store.updateProjectForm(p.id, { form_submitted_at: today() }); toast("Proje formu bugün girildi olarak kaydedildi."); rerender(); } catch (e) { fail(e); } };
  });
}
// Proje ekle / düzenle: proje adı, komite, proje tarihi, proje formunun girildiği tarih
function projectFormDialog(p, after) {
  const isNew = !p;
  p ||= { title: "", committee: pfCom && pfCom !== "Belirtilmedi" ? pfCom : "", date: today(), form_submitted_at: "" };
  const dlg = document.getElementById("dlg");
  dlg.innerHTML = `<form method="dialog" id="f-pf">
    <h2>${isNew ? "Proje ekle" : "Projeyi düzenle"}</h2>
    <label class="f">Proje adı<input type="text" name="title" value="${esc(p.title)}" required></label>
    <div class="grid g2">
      <label class="f">Hangi komiteden<select name="committee" required><option value="">Seç…</option>${COMMITTEES.map(c => `<option ${p.committee === c ? "selected" : ""}>${c}</option>`).join("")}</select></label>
      <label class="f">Proje hangi tarihte yapıldı<input type="date" name="date" value="${esc(p.date || "")}" required></label>
      <label class="f">Proje formu hangi tarihte girildi <small>Girilmediyse boş bırak</small><input type="date" name="form_submitted_at" value="${esc(p.form_submitted_at || "")}"></label>
    </div>
    <p class="err" id="pf-err" role="alert" hidden></p>
    <div class="row"><button class="btn" value="save">Kaydet</button><button class="btn ghost" value="cancel" formnovalidate>Vazgeç</button></div>
  </form>`;
  if (!dlg.open) dlg.showModal();
  dlg.querySelector("form").onsubmit = async e => {
    if (e.submitter?.value !== "save") return;
    e.preventDefault();
    const fd = new FormData(e.target), d = Object.fromEntries(fd);
    const err = document.getElementById("pf-err");
    if (!d.title.trim() || !d.committee || !d.date) { err.textContent = "Proje adı, komite ve proje tarihi zorunlu."; err.hidden = false; return; }
    if (d.form_submitted_at && d.form_submitted_at < d.date) { err.textContent = "Proje formu, projeden önceki bir tarihte girilmiş olamaz."; err.hidden = false; return; }
    const row = { title: d.title.trim(), committee: d.committee, date: d.date, form_submitted_at: d.form_submitted_at || null };
    try {
      if (isNew) await store.createProjectForm(row); else await store.updateProjectForm(p.id, row);
      dlg.close(); toast(isNew ? "Proje eklendi." : "Proje güncellendi."); after();
    } catch (er) { err.textContent = er.message; err.hidden = false; }
  };
}

boot();
