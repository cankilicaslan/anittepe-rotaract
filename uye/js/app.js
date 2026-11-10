import { createStore, trDate } from "./store.js";
import { can, hasRole, ROLE_LABELS } from "./roles.js";

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
let toastT;
export function toast(msg, kind = "") {
  const t = document.getElementById("toast");
  t.innerHTML = msg; t.className = "show " + kind;
  clearTimeout(toastT); toastT = setTimeout(() => (t.className = ""), 4200);
}
const fail = e => toast(esc(e?.message || e), "bad");

/* ------------------------------ Açılış ------------------------------ */
async function boot() {
  try {
    store = await createStore();
    me = await store.me();
  } catch (e) {
    app.innerHTML = `<div class="pending card"><h1>Panel açılamadı</h1><p>${esc(e.message)}</p><p class="muted">İnternet bağlantınızı ve <code>js/config.js</code> ayarlarını kontrol edin.</p></div>`;
    return;
  }
  window.addEventListener("hashchange", render);
  render();
}

function render() {
  if (!me) return authView();
  if (me.status === "pending") return pendingView();
  if (me.status === "passive") return pendingView(true);
  shell();
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
  if (lf) lf.onsubmit = async e => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(lf));
    try { me = await store.signIn(d.email, d.password); location.hash = "#profil"; render(); } catch (er) { authView("giris", er.message); }
  };
  const sf = document.getElementById("f-signup");
  if (sf) sf.onsubmit = async e => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(sf));
    if (!d.full_name || !d.phone || !d.email || !d.password) return authView("kayit", "Tüm alanları doldurun.");
    try {
      me = await store.signUp(d);
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
    box.querySelectorAll(".chip").forEach(c => c.onclick = async () => { me = await store.signIn(c.dataset.e, store.demoPassword); location.hash = "#profil"; render(); });
  });
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
  { grp: "Yönetim" },
  { id: "duyurular", label: "Duyurular", panel: "duyuru" },
  { id: "yoklama", label: "Yoklama", panel: "yoklama" },
  { id: "aidat", label: "Aidat", panel: "aidat" },
  { id: "kasa", label: "Kulüp kasası", panel: "kasa" },
  { id: "projeler", label: "Hizmet projeleri", panel: "projeler" },
  { id: "instagram", label: "Instagram paylaşımı", panel: "instagram" }
];
const visible = p => p.panel ? can(me, p.panel, "view") : p.show?.();

let composerInst = null;
function shell() {
  try { composerInst?.destroy?.(); } catch {} composerInst = null;
  let id = (location.hash || "#profil").slice(1);
  const page = PAGES.find(p => p.id === id);
  if (!page || !visible(page)) id = "profil";
  const nav = PAGES.filter(p => p.grp || visible(p));
  const navHtml = nav.map((p, i) => p.grp
    ? (nav.slice(i + 1).some(x => !x.grp) ? `<div class="grp">${p.grp}</div>` : "")
    : `<a href="#${p.id}" ${p.id === id ? 'aria-current="page"' : ""}>${p.label}${p.panel && !can(me, p.panel, "edit") ? '<span class="ro" title="Yalnızca görüntüleme">Görüntüle</span>' : ""}</a>`).join("");
  app.innerHTML = `
  <div class="shell">
    <aside class="side" id="side">
      <a href="../"><img class="logo" src="../assets/logo-cranberry.webp" alt="Rotaract Ankara Anıttepe, kulüp sitesine dön"></a>
      <nav aria-label="Panel">${navHtml}</nav>
      <div class="who">${avatar(me)}<div style="min-width:0"><b>${esc(me.full_name)}</b><span>${esc(me.title || "Üye")}</span></div></div>
      <button class="btn ghost sm" id="logout">Çıkış yap</button>
    </aside>
    <div>
      <div class="topbar"><button class="btn ghost sm" id="menu" aria-controls="side" aria-expanded="false">Menü</button><img src="../assets/logo-cranberry.webp" alt="Rotaract Ankara Anıttepe"></div>
      <main class="main" id="main" tabindex="-1">
        ${store.mode === "demo" ? `<div class="banner">Demo modundasın: örnek verilerle çalışıyor, değişiklikler yalnızca bu tarayıcıda saklanıyor. <button class="btn ghost sm" id="reset">Örnek verileri sıfırla</button></div>` : ""}
        <div id="view"><p class="muted">Yükleniyor…</p></div>
      </main>
    </div>
  </div>`;
  document.getElementById("logout").onclick = async () => { await store.signOut(); me = null; location.hash = ""; render(); };
  const side = document.getElementById("side"), mb = document.getElementById("menu");
  mb.onclick = () => { const o = side.classList.toggle("open"); mb.setAttribute("aria-expanded", o); };
  side.querySelectorAll("nav a").forEach(a => a.addEventListener("click", () => side.classList.remove("open")));
  const rs = document.getElementById("reset");
  if (rs) rs.onclick = () => { if (confirm("Örnek veriler ilk haline dönsün mü? Bu tarayıcıdaki demo değişiklikleri silinir.")) { store.resetDemo(); location.hash = ""; location.reload(); } };
  const view = document.getElementById("view");
  const fn = { profil: viewProfile, takvim: viewCalendar, kulupler: viewClubEvents, duyurular: viewAnnounce, uyeler: viewMembers, yoklama: viewAttendance, aidat: viewDues, kasa: viewTreasury, projeler: viewProjects, instagram: viewInstagram }[id];
  fn(view).catch(e => { view.innerHTML = `<div class="err">${esc(e.message)}</div>`; });
}
const header = (title, sub = "", actions = "") => `<div class="page-h"><div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ""}</div><div class="spacer"></div>${actions}</div>`;
const roBanner = panel => can(me, panel, "edit") ? "" : `<div class="banner info">Bu bölümü geçmiş dönem başkanı olarak yalnızca görüntüleyebilirsin.</div>`;
const refresh = () => shell();

/* --------------------------- Yardımcı hesaplar --------------------------- */
function attendanceStats(memberId, meetings, att) {
  const held = meetings.filter(m => m.date <= today());
  const ids = new Set(held.map(m => m.id));
  const mine = att.filter(a => a.member_id === memberId && ids.has(a.meeting_id));
  const c = { geldi: 0, gelmedi: 0, mazeretli: 0 };
  mine.forEach(a => c[a.status]++);
  const n = held.length;
  return { held: n, ...c, isaretsiz: n - mine.length, oran: n ? c.geldi / n : 0, oranMazeretHaric: (n - c.mazeretli) ? c.geldi / (n - c.mazeretli) : 0 };
}
function debtOf(memberId, charges, dues) {
  const dmap = Object.fromEntries(dues.map(d => [d.id, d]));
  const open = charges.filter(c => c.member_id === memberId && !c.paid_at).map(c => ({ ...c, due: dmap[c.due_id] })).filter(c => c.due);
  return { total: open.reduce((s, c) => s + +c.amount, 0), open, overdue: open.filter(c => c.due.due_date < today()) };
}

/* ------------------------------ Profil ------------------------------ */
async function viewProfile(v) {
  const [meetings, att, charges, dues, priv] = await Promise.all([store.listMeetings(), store.listAttendance(), store.listCharges(), store.listDues(), store.getPrivate(me.id)]);
  const st = attendanceStats(me.id, meetings, att);
  const debt = debtOf(me.id, charges, dues);
  const roles = (me.roles || []).map(r => `<span class="tag cran">${ROLE_LABELS[r]}</span>`).join(" ") + (me.past_president ? ` <span class="tag">Geçmiş dönem başkanı</span>` : "");
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
  </form>`;
  document.getElementById("photo").onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { await store.uploadPhoto(me.id, f); me = await store.me(); toast("Profil fotoğrafın güncellendi."); refresh(); } catch (er) { fail(er); }
  };
  document.getElementById("f-me").onsubmit = async e => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)); d.birth_date ||= null;
    try { await store.updateMember(me.id, d); me = await store.me(); toast("Bilgilerin kaydedildi."); refresh(); } catch (er) { fail(er); }
  };
}

/* ---------------------------- Üye listesi ---------------------------- */
async function viewMembers(v) {
  const admin = hasRole(me, "baskan");
  const seeDebt = can(me, "aidat", "view");
  const [members, charges, dues] = await Promise.all([store.listMembers(), seeDebt ? store.listCharges() : [], seeDebt ? store.listDues() : []]);
  const pending = members.filter(m => m.status === "pending");
  const STATUS = { active: ["Aktif", "ok"], pending: ["Onay bekliyor", "warn"], passive: ["Pasif", ""] };
  const rows = q => members.filter(m => m.status !== "pending" || admin)
    .filter(m => !q || [m.full_name, m.title, m.email, m.phone, m.profession].join(" ").toLocaleLowerCase("tr").includes(q))
    .sort((a, b) => (a.status === "active" ? 0 : 1) - (b.status === "active" ? 0 : 1) || a.full_name.localeCompare(b.full_name, "tr"))
    .map(m => {
      const d = seeDebt ? debtOf(m.id, charges, dues) : null;
      return `<tr>
        <td>${person(m)}</td>
        <td>${m.phone ? `<a href="tel:${esc(m.phone.replace(/\s/g, ""))}">${esc(m.phone)}</a>` : '<span class="muted">Eklenmedi</span>'}</td>
        <td>${m.email ? `<a href="mailto:${esc(m.email)}">${esc(m.email)}</a>` : ""}</td>
        <td>${m.birth_date ? trDate(m.birth_date) : '<span class="muted">Eklenmedi</span>'}</td>
        <td>${esc(m.profession) || '<span class="muted">Eklenmedi</span>'}</td>
        <td>${m.instagram ? `<a href="https://instagram.com/${esc(m.instagram.replace(/^@/, ""))}" target="_blank" rel="noopener">@${esc(m.instagram.replace(/^@/, ""))}</a>` : '<span class="muted">Eklenmedi</span>'}</td>
        <td>${trDate(m.joined_at)}</td>
        <td><span class="tag ${STATUS[m.status]?.[1] || ""}">${STATUS[m.status]?.[0] || esc(m.status)}</span>${(m.roles || []).map(r => ` <span class="tag cran">${ROLE_LABELS[r]}</span>`).join("")}${m.past_president ? ' <span class="tag">GDB</span>' : ""}</td>
        ${seeDebt ? `<td class="num">${d.total ? `<b>${TL(d.total)}</b>${d.overdue.length ? ' <span class="tag bad">Gecikmiş</span>' : ""}` : '<span class="tag ok">Yok</span>'}</td>` : ""}
        ${admin ? `<td><button class="btn ghost sm" data-edit="${m.id}">Düzenle</button></td>` : ""}
      </tr>`;
    }).join("");
  v.innerHTML = header("Üye listesi", `${members.filter(m => m.status === "active").length} aktif üye`, `<div class="row"><input type="search" id="q" placeholder="İsim, görev, telefon ara" style="max-width:260px" aria-label="Üye ara">${admin ? `<button class="btn" id="addm">Yeni üye ekle</button><label class="btn ghost" style="cursor:pointer">Excel'den bilgileri al<input type="file" id="xls" accept=".xlsx,.xls,.csv" class="sr"></label>` : ""}</div>`) +
    (admin ? `<p class="muted" style="margin:-8px 0 16px;font-size:.86rem">Excel'den alma yalnızca listedeki mevcut üyelerin telefon, e-posta, doğum tarihi, meslek, Instagram ve kan grubu bilgilerini günceller; yeni kişi eklemez. Dosya bu tarayıcıda okunur, hiçbir yere yüklenmez.</p>` : "") +
    (admin && pending.length ? `<div class="card" style="margin-bottom:16px"><h2>Onay bekleyen hesaplar</h2>${pending.map(m => `<div class="pay-row">${person(m)}<span class="muted">${esc(m.email)} · ${esc(m.phone)}</span><button class="btn sm" data-approve="${m.id}">Onayla</button><button class="btn danger sm" data-reject="${m.id}">Pasife al</button></div>`).join("")}</div>` : "") +
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
  const priv = isNew ? {} : await store.getPrivate(m.id);
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
    </div>
    <datalist id="titles">${["Başkan", "Asbaşkan", "Sekreter", "Sayman", "Yönetim Kurulu Üyesi", "Geçmiş Dönem Başkanı", "Hizmet Projeleri Komitesi Başkanı", "Halkla İlişkiler ve Tanıtım Komitesi Başkanı", "Üye"].map(t => `<option value="${t}">`).join("")}</datalist>
    <fieldset><legend style="font-weight:700;margin-bottom:6px">Panel yetkileri</legend><div class="grid g2">
      ${Object.entries(ROLE_LABELS).map(([k, l]) => `<label class="check"><input type="checkbox" name="role" value="${k}" ${(m.roles || []).includes(k) ? "checked" : ""}> ${l}</label>`).join("")}
      <label class="check"><input type="checkbox" name="past_president" ${m.past_president ? "checked" : ""}> Geçmiş dönem başkanı (tüm panelleri görür)</label>
    </div></fieldset>
    <div class="row"><button class="btn" value="save">Kaydet</button><button class="btn ghost" value="cancel" formnovalidate>Vazgeç</button></div>
  </form>`;
  dlg.showModal();
  dlg.querySelector("form").onsubmit = async e => {
    if (e.submitter?.value !== "save") return;
    const fd = new FormData(e.target);
    const patch = { full_name: fd.get("full_name"), title: fd.get("title"), phone: fd.get("phone"), email: fd.get("email"), birth_date: fd.get("birth_date") || null, profession: fd.get("profession"), instagram: fd.get("instagram"), blood_type: fd.get("blood_type"), status: fd.get("status"), joined_at: fd.get("joined_at") || null, roles: fd.getAll("role"), past_president: fd.has("past_president") };
    try {
      if (isNew) {
        const { roles, past_president, status, ...base } = patch;
        const created = await store.addMember(base);
        if (created?.id && (roles.length || past_president || status !== "active")) await store.updateMember(created.id, { roles, past_president, status });
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
  const [term, meetings, att, all] = await Promise.all([store.getTerm(), store.listMeetings(), store.listAttendance(), store.listMembers()]);
  const members = all.filter(m => m.status === "active").sort((a, b) => a.full_name.localeCompare(b.full_name, "tr"));
  if (!meetings.length) { v.innerHTML = header("Yoklama", `${esc(term.name)} dönemi`) + `<div class="card"><p class="muted" style="margin:0">Bu dönem için henüz toplantı tanımlanmamış.</p></div>`; return; }
  const held = meetings.filter(m => m.date <= today());
  if (!selMeeting || !meetings.find(m => m.id === selMeeting)) selMeeting = (held.at(-1) || meetings[0])?.id;
  const cur = meetings.find(m => m.id === selMeeting);
  const amap = new Map(att.map(a => [a.meeting_id + "|" + a.member_id, a]));
  const stats = members.map(m => ({ m, s: attendanceStats(m.id, meetings, att) }));
  const avg = stats.length ? stats.reduce((x, y) => x + y.s.oran, 0) / stats.length : 0;
  const curMarks = members.map(m => amap.get(cur.id + "|" + m.id)?.status);
  const cnt = k => curMarks.filter(x => x === k).length;
  const SEG = [["geldi", "Geldi"], ["gelmedi", "Gelmedi"], ["mazeretli", "Mazeretli"]];
  const SHORT = { geldi: "✓", gelmedi: "✕", mazeretli: "M" };

  v.innerHTML = header("Yoklama", `${esc(term.name)} dönemi · ${term.meeting_count} toplantı · toplantılar iki haftada bir perşembe 19.30`) + roBanner("yoklama") + `
  <div class="stats">
    <div class="stat hl"><span>Yapılan toplantı</span><b>${held.length} / ${term.meeting_count}</b></div>
    <div class="stat"><span>Kulübün toplantı sayısı</span><b>${held.at(-1)?.club_no ?? "–"}</b></div>
    <div class="stat"><span>Ortalama devam</span><b>${pct(avg)}</b></div>
    <div class="stat"><span>Aktif üye</span><b>${members.length}</b></div>
  </div>
  <div class="card">
    <div class="row" style="margin-bottom:14px">
      <label class="f" style="min-width:260px;flex:1">Toplantı
        <select id="msel">${meetings.map(m => `<option value="${m.id}" ${m.id === cur.id ? "selected" : ""}>${m.term_no}. toplantı (kulübün ${m.club_no}.) · ${trDate(m.date)}${m.date > today() ? " · ileride" : ""}</option>`).join("")}</select>
      </label>
      <fieldset ${ro ? "disabled" : ""} class="row" style="align-items:flex-end">
        <label class="f">Tarih<input type="date" id="mdate" value="${cur.date}"></label>
        <label class="f" style="min-width:200px">Not<input type="text" id="mnote" value="${esc(cur.note)}" placeholder="Konuk, konu…"></label>
        <button class="btn ghost sm" id="msave" style="margin-bottom:4px">Kaydet</button>
      </fieldset>
    </div>
    <div class="row" style="margin-bottom:12px">
      <span class="tag ok">Geldi ${cnt("geldi")}</span><span class="tag bad">Gelmedi ${cnt("gelmedi")}</span><span class="tag warn">Mazeretli ${cnt("mazeretli")}</span><span class="tag">İşaretsiz ${curMarks.filter(x => !x).length}</span>
      <div class="spacer"></div>
      ${ro ? "" : `<button class="btn ghost sm" id="allin">İşaretsizleri "geldi" yap</button>`}
    </div>
    <div class="att-list">${members.map(m => {
      const s = amap.get(cur.id + "|" + m.id)?.status;
      return `<div class="att-row">${person(m)}<div class="seg" role="group" aria-label="${esc(m.full_name)} yoklama">${SEG.map(([k, l]) => `<button type="button" data-m="${m.id}" data-v="${k}" aria-pressed="${s === k}" ${ro ? "disabled" : ""}>${l}</button>`).join("")}</div></div>`;
    }).join("")}</div>
  </div>
  <div class="card"><h2>Üyelerin devam durumu</h2>
    <p class="muted" style="margin-top:-6px">Oran, bugüne kadar yapılan ${held.length} toplantıya göre hesaplanır.</p>
    <div class="tbl-wrap"><table><thead><tr><th>Üye</th><th class="num">Geldi</th><th class="num">Gelmedi</th><th class="num">Mazeretli</th><th class="num">İşaretsiz</th><th>Devam oranı</th><th class="num">Mazeret hariç</th></tr></thead><tbody>
    ${stats.sort((a, b) => b.s.oran - a.s.oran).map(({ m, s }) => `<tr><td>${person(m)}</td><td class="num">${s.geldi}</td><td class="num">${s.gelmedi}</td><td class="num">${s.mazeretli}</td><td class="num">${s.isaretsiz}</td>
      <td><div class="row" style="flex-wrap:nowrap"><div class="bar" style="flex:1"><i style="width:${s.oran * 100}%"></i></div><b style="min-width:44px;text-align:right">${pct(s.oran)}</b></div></td><td class="num">${pct(s.oranMazeretHaric)}</td></tr>`).join("")}
    </tbody></table></div>
  </div>
  <details class="card"><summary style="cursor:pointer;font-weight:700">Dönemin tamamı (${term.meeting_count} toplantı tablosu)</summary>
    <div class="legend" style="margin:12px 0"><span><span class="cell geldi">✓</span>Geldi</span><span><span class="cell gelmedi">✕</span>Gelmedi</span><span><span class="cell mazeretli">M</span>Mazeretli</span><span><span class="cell">·</span>İşaretsiz</span>${ro ? "" : "<span>Hücreye tıklayınca durum değişir.</span>"}</div>
    <div class="tbl-wrap"><table class="matrix"><thead><tr><th>Üye</th>${meetings.map(m => `<th class="${m.date > today() ? "future" : ""}" title="${trDate(m.date)}">${m.term_no}</th>`).join("")}</tr></thead><tbody>
    ${members.map(p => `<tr><td>${esc(p.full_name)}</td>${meetings.map(m => { const s = amap.get(m.id + "|" + p.id)?.status; return `<td class="${m.date > today() ? "future" : ""}"><button class="cell ${s || ""}" data-cm="${m.id}" data-cp="${p.id}" ${ro ? "disabled" : ""} aria-label="${esc(p.full_name)}, ${m.term_no}. toplantı: ${s || "işaretsiz"}">${s ? SHORT[s] : "·"}</button></td>`; }).join("")}</tr>`).join("")}
    </tbody></table></div>
  </details>`;

  document.getElementById("msel").onchange = e => { selMeeting = e.target.value; refreshKeep(v, viewAttendance); };
  if (ro) return;
  document.getElementById("msave").onclick = async () => { try { await store.updateMeeting(cur.id, { date: document.getElementById("mdate").value, note: document.getElementById("mnote").value }); toast("Toplantı bilgisi kaydedildi."); refreshKeep(v, viewAttendance); } catch (e) { fail(e); } };
  v.querySelectorAll(".seg button").forEach(b => b.onclick = async () => {
    const was = b.getAttribute("aria-pressed") === "true";
    try { await store.setAttendance(cur.id, b.dataset.m, was ? null : b.dataset.v); refreshKeep(v, viewAttendance); } catch (e) { fail(e); }
  });
  document.getElementById("allin").onclick = async () => {
    try { for (const m of members) if (!amap.get(cur.id + "|" + m.id)) await store.setAttendance(cur.id, m.id, "geldi"); refreshKeep(v, viewAttendance); } catch (e) { fail(e); }
  };
  const order = [undefined, "geldi", "gelmedi", "mazeretli"];
  v.querySelectorAll("[data-cm]").forEach(b => b.onclick = async () => {
    const s = amap.get(b.dataset.cm + "|" + b.dataset.cp)?.status;
    const next = order[(order.indexOf(s) + 1) % order.length] || null;
    try { await store.setAttendance(b.dataset.cm, b.dataset.cp, next); refreshKeep(v, viewAttendance, true); } catch (e) { fail(e); }
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
    <div class="stat hl"><span>Bekleyen</span><b>${TL(total - paid)}</b></div>
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
  ${ro ? "" : `<form class="card" id="f-month"><h2>Dönemin her ayı için aidat oluştur</h2>
    <p class="muted" style="margin-top:-6px">Temmuz’dan Haziran’a kadar, henüz aidatı olmayan her ay için aynı tutar ve aynı son ödeme günüyle aidat açılır. Takvimde de her ayın aidat günü görünür.</p>
    <div class="grid g3"><label class="f">Aylık tutar (TL)<input type="number" name="amount" min="0" step="0.01" required></label>
      <label class="f">Son ödeme günü <small>Ayın kaçı</small><input type="number" name="day" min="1" max="28" value="15" required></label>
      <div class="f" style="align-self:end"><button class="btn" type="submit">Eksik ayları oluştur</button></div></div>
  </form>`}
  <div class="card"><h2>Aidat dönemleri</h2>
    ${dues.length ? dues.slice().sort((a, b) => (b.due_date || "").localeCompare(a.due_date || "")).map(d => {
      const cs = charges.filter(c => c.due_id === d.id).sort((a, b) => (mmap[a.member_id]?.full_name || "").localeCompare(mmap[b.member_id]?.full_name || "", "tr"));
      const p = cs.filter(c => c.paid_at).length;
      return `<details class="due"><summary><b>${esc(d.label)}</b><span class="muted">${TL(d.amount)} · son ödeme ${trDate(d.due_date)}</span><div class="spacer"></div>
        <span class="tag ${p === cs.length ? "ok" : d.due_date < today() ? "bad" : "warn"}">${p}/${cs.length} ödendi</span></summary>
        <div class="body">${cs.map(c => `<div class="pay-row">${person(mmap[c.member_id] || { full_name: "Silinmiş üye" })}
          ${c.paid_at ? `<span class="tag ok">Ödendi · ${trDate(c.paid_at)}</span>` : `<span class="tag ${d.due_date < today() ? "bad" : "warn"}">${d.due_date < today() ? "Gecikti" : "Bekliyor"}</span>`}
          ${ro ? "" : c.paid_at ? `<button class="btn ghost sm" data-unpay="${c.id}">Geri al</button>` : `<input type="date" value="${today()}" data-pd="${c.id}" aria-label="Ödeme tarihi" style="width:auto;min-height:32px"><button class="btn sm" data-pay="${c.id}">Ödendi</button>`}
        </div>`).join("")}
        ${ro ? "" : `<div class="row" style="margin-top:10px"><button class="btn danger sm" data-deldue="${d.id}">Bu aidat dönemini sil</button></div>`}</div></details>`;
    }).join("") : `<p class="muted">Henüz aidat girilmedi.</p>`}
  </div>
  <div class="card"><h2>Üye bazında borç</h2><div class="tbl-wrap"><table><thead><tr><th>Üye</th><th class="num">Ödenmemiş dönem</th><th class="num">Gecikmiş</th><th class="num">Toplam borç</th></tr></thead><tbody>
    ${members.map(m => ({ m, d: debtOf(m.id, charges, dues) })).sort((a, b) => b.d.total - a.d.total).map(({ m, d }) => `<tr><td>${person(m)}</td><td class="num">${d.open.length}</td><td class="num">${d.overdue.length ? `<span class="tag bad">${d.overdue.length}</span>` : 0}</td><td class="num"><b>${TL(d.total)}</b></td></tr>`).join("")}
  </tbody></table></div></div>`;
  if (ro) return;
  document.getElementById("f-month").onsubmit = async e => {
    e.preventDefault(); const fd = new FormData(e.target), amount = +fd.get("amount"), day = String(+fd.get("day")).padStart(2, "0");
    const term = await store.getTerm(); const [sy, sm] = term.start_date.split("-").map(Number);
    const have = new Set(dues.map(d => d.period));
    const ids = members.filter(m => m.status === "active").map(m => m.id);
    let n = 0;
    try {
      for (let i = 0; i < 12; i++) {
        const d = new Date(sy, sm - 1 + i, 1), period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        if (have.has(period)) continue;
        await store.createDue({ label: `${MONTHS[d.getMonth()]} ${d.getFullYear()} aidatı`, period, amount, due_date: `${period}-${day}`, member_ids: ids }); n++;
      }
      toast(n ? `${n} ay için aidat oluşturuldu.` : "Dönemin bütün aylarında zaten aidat var."); refresh();
    } catch (er) { fail(er); }
  };
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
const CATS = { gelir: ["Bağış", "Sponsorluk", "Etkinlik geliri", "Proje geliri", "Diğer gelir"], gider: ["Etkinlik", "Proje", "Bölge katkı payı", "Malzeme", "Ulaşım", "İkram", "Diğer gider"] };
async function viewTreasury(v) {
  const ro = !can(me, "kasa", "edit");
  const [term, txs, charges, dues] = await Promise.all([store.getTerm(), store.listTransactions(), store.listCharges(), store.listDues()]);
  // Yalnızca bu dönemin aidat tahsilatları kasaya gelir yazılır (dönem başı kasa da bu döneme ait).
  const duesIncome = dues.filter(d => d.term_id === term.id).map(d => { const cs = charges.filter(c => c.due_id === d.id && c.paid_at); return { id: "d-" + d.id, date: cs.map(c => c.paid_at).sort().at(-1) || d.due_date, kind: "gelir", category: "Aidat", description: `${d.label} tahsilatı (${cs.length} üye)`, amount: cs.reduce((s, c) => s + +c.amount, 0), auto: true }; }).filter(x => x.amount > 0);
  const rows = [...txs, ...duesIncome].sort((a, b) => b.date.localeCompare(a.date));
  const inc = rows.filter(r => r.kind === "gelir").reduce((s, r) => s + +r.amount, 0);
  const exp = rows.filter(r => r.kind === "gider").reduce((s, r) => s + +r.amount, 0);
  const bal = +term.opening_balance + inc - exp;
  const byCat = {}; rows.filter(r => r.kind === "gider").forEach(r => byCat[r.category] = (byCat[r.category] || 0) + +r.amount);
  const maxCat = Math.max(1, ...Object.values(byCat));
  v.innerHTML = header("Kulüp kasası", `${esc(term.name)} dönemi`) + roBanner("kasa") + `
  <div class="stats">
    <div class="stat"><span>Dönem başı kasa</span><b>${TL(term.opening_balance)}</b></div>
    <div class="stat"><span>Toplam gelir</span><b>${TL(inc)}</b></div>
    <div class="stat"><span>Toplam gider</span><b>${TL(exp)}</b></div>
    <div class="stat hl"><span>Güncel kasa</span><b>${TL(bal)}</b></div>
  </div>
  <div class="grid g2">
    ${ro ? "" : `<form class="card" id="f-tx"><h2>Hareket ekle</h2>
      <div class="seg" role="group" aria-label="Tür" style="margin-bottom:12px"><button type="button" data-k="gider" aria-pressed="true">Gider</button><button type="button" data-k="gelir" aria-pressed="false">Gelir</button></div>
      <input type="hidden" name="kind" value="gider">
      <div class="grid g2">
        <label class="f">Tarih<input type="date" name="date" value="${today()}" required></label>
        <label class="f">Tutar (TL)<input type="number" name="amount" min="0.01" step="0.01" required></label>
        <label class="f">Kategori<select name="category" id="cat">${CATS.gider.map(c => `<option>${c}</option>`).join("")}</select></label>
        <label class="f">Açıklama<input type="text" name="description" required placeholder="Ne için?"></label>
      </div>
      <div class="row" style="margin-top:14px"><button class="btn" type="submit">Ekle</button></div>
      <p class="muted" style="font-size:.84rem;margin:12px 0 0">Ödenen aidatlar kasaya kendiliğinden gelir olarak eklenir.</p>
    </form>`}
    <div class="card"><h2>Giderlerin dağılımı</h2>
      ${Object.keys(byCat).length ? Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([c, a]) => `<div style="margin-bottom:10px"><div class="row" style="font-size:.9rem"><span>${esc(c)}</span><div class="spacer"></div><b>${TL(a)}</b></div><div class="bar"><i style="width:${a / maxCat * 100}%"></i></div></div>`).join("") : '<p class="muted">Henüz gider yok.</p>'}
      <form id="f-open" class="row" style="margin-top:16px;align-items:flex-end"><fieldset ${ro ? "disabled" : ""} class="row" style="align-items:flex-end;flex:1">
        <label class="f" style="flex:1">Dönem başı kasa (TL)<input type="number" step="0.01" name="opening_balance" value="${term.opening_balance}"></label>
        <button class="btn ghost sm" style="margin-bottom:4px">Güncelle</button></fieldset></form>
    </div>
  </div>
  <div class="card"><h2>Kasa hareketleri</h2><div class="tbl-wrap"><table><thead><tr><th>Tarih</th><th>Açıklama</th><th>Kategori</th><th class="num">Tutar</th>${ro ? "" : "<th></th>"}</tr></thead><tbody>
    ${rows.length ? rows.map(r => `<tr><td>${trDate(r.date)}</td><td>${esc(r.description)}</td><td><span class="tag ${r.kind === "gelir" ? "ok" : ""}">${esc(r.category)}</span></td><td class="num" style="color:${r.kind === "gelir" ? "var(--ok)" : "var(--bad)"};font-weight:700">${r.kind === "gelir" ? "+" : "−"}${TL(r.amount)}</td>${ro ? "" : `<td>${r.auto ? '<span class="muted" style="font-size:.8rem">Aidattan</span>' : `<button class="btn danger sm" data-deltx="${r.id}">Sil</button>`}</td>`}</tr>`).join("") : `<tr><td colspan="5" class="muted">Henüz hareket yok.</td></tr>`}
  </tbody></table></div></div>`;
  if (ro) return;
  const f = document.getElementById("f-tx");
  f.querySelectorAll("[data-k]").forEach(b => b.onclick = () => {
    f.querySelectorAll("[data-k]").forEach(x => x.setAttribute("aria-pressed", x === b));
    f.kind.value = b.dataset.k; document.getElementById("cat").innerHTML = CATS[b.dataset.k].map(c => `<option>${c}</option>`).join("");
  });
  f.onsubmit = async e => { e.preventDefault(); const d = Object.fromEntries(new FormData(f)); d.amount = +d.amount; try { await store.addTransaction(d); toast("Kasa hareketi eklendi."); refresh(); } catch (er) { fail(er); } };
  document.getElementById("f-open").onsubmit = async e => { e.preventDefault(); try { await store.updateTerm({ opening_balance: +e.target.opening_balance.value }); toast("Dönem başı kasa güncellendi."); refresh(); } catch (er) { fail(er); } };
  v.querySelectorAll("[data-deltx]").forEach(b => b.onclick = async () => { if (!confirm("Bu kasa hareketi silinsin mi?")) return; try { await store.deleteTransaction(b.dataset.deltx); toast("Hareket silindi."); refresh(); } catch (e) { fail(e); } });
}

/* ------------------------------ Projeler ------------------------------ */
const KIND = { hizmet: "Hizmet projesi", etkinlik: "Etkinlik", ocakbasi: "Ocakbaşı", diger: "Diğer" };
const PSTAT = { planlandi: ["Planlandı", "warn"], devam: ["Devam ediyor", "cran"], tamamlandi: ["Tamamlandı", "ok"], iptal: ["İptal", "bad"] };
let projMode = "liste", calMonth = today().slice(0, 7);
async function viewProjects(v) {
  const ro = !can(me, "projeler", "edit");
  const [projects, meetings] = await Promise.all([store.listProjects(), store.listMeetings()]);
  projects.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const up = projects.filter(p => p.date >= today() && p.status !== "iptal");
  v.innerHTML = header("Hizmet projeleri", "Projeleri planla; liste ve takvim birlikte güncellenir.", ro ? "" : `<button class="btn" id="newp">Yeni proje</button>`) + roBanner("projeler") + `
  <div class="stats">
    <div class="stat hl"><span>Yaklaşan</span><b>${up.length}</b></div>
    <div class="stat"><span>Planlanan</span><b>${projects.filter(p => p.status === "planlandi").length}</b></div>
    <div class="stat"><span>Tamamlanan</span><b>${projects.filter(p => p.status === "tamamlandi").length}</b></div>
    <div class="stat"><span>Sitede görünen</span><b>${projects.filter(p => p.public).length}</b></div>
  </div>
  <div class="row" style="margin-bottom:14px"><div class="seg" role="group" aria-label="Görünüm"><button data-mode="liste" aria-pressed="${projMode === "liste"}">Liste</button><button data-mode="takvim" aria-pressed="${projMode === "takvim"}">Takvim</button></div></div>
  <div id="pbody"></div><dialog id="dlg"></dialog>`;
  const body = document.getElementById("pbody");
  if (projMode === "liste") {
    body.innerHTML = `<div class="card">${projects.length ? projects.map(p => {
      const d = p.date ? new Date(p.date + "T12:00:00") : null;
      return `<div class="proj"><div class="date">${d ? `<b>${d.getDate()}</b><span>${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}</span>` : "<span>Tarih yok</span>"}</div>
        <div><h3>${esc(p.title)}</h3><div class="row"><span class="tag ${PSTAT[p.status]?.[1]}">${PSTAT[p.status]?.[0]}</span><span class="tag">${KIND[p.kind] || ""}</span>${p.public ? '<span class="tag cran">Sitede</span>' : ""}<span class="muted" style="font-size:.86rem">${[p.time, p.location, p.owner].filter(Boolean).map(esc).join(" · ")}</span></div>
        ${p.description ? `<p>${esc(p.description)}</p>` : ""}${p.plan ? `<p class="muted" style="white-space:pre-line"><b style="color:var(--ink)">Nasıl yapılacak:</b> ${esc(p.plan)}</p>` : ""}</div>
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
      ${projects.filter(p => p.date === k).map(p => `<button class="ev ${p.status === "tamamlandi" ? "done" : ""}" data-ep="${p.id}" title="${esc(p.title)}">${esc(p.title)}</button>`).join("")}</div>`; }).join("")}</div>`;
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
      <label class="f">Saat<input type="time" name="time" value="${esc(p.time)}"></label>
      <label class="f">Yer<input type="text" name="location" value="${esc(p.location)}"></label>
      <label class="f">Sorumlu<input type="text" name="owner" value="${esc(p.owner)}"></label>
      <label class="f">Durum<select name="status">${Object.entries(PSTAT).map(([k, [l]]) => `<option value="${k}" ${p.status === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
    </div>
    <label class="f">Kısa açıklama<textarea name="description" rows="2">${esc(p.description)}</textarea></label>
    <label class="f">Nasıl yapılacak? <small>Adımlar, ihtiyaçlar, görev dağılımı</small><textarea name="plan" rows="4">${esc(p.plan)}</textarea></label>
    <label class="check"><input type="checkbox" name="public" ${p.public ? "checked" : ""}> Kulüp sitesindeki takvimde göster</label>
    <div class="row"><button class="btn" value="save">Kaydet</button><button class="btn ghost" value="cancel" formnovalidate>Vazgeç</button><div class="spacer"></div>${p.id ? `<button class="btn danger" value="delete" formnovalidate>Sil</button>` : ""}</div>
  </form>`;
  dlg.showModal();
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
async function viewInstagram(v) {
  v.innerHTML = header("Instagram paylaşımı", "Fotoğrafı sürükle, türü seç, bilgileri gir; görsel ve açıklama hazırlansın.") + roBanner("instagram") +
    (store.mode === "demo" ? `<div class="banner info">Demo modunda Instagram'a doğrudan paylaşım ve yapay zekâ kapalı. Görseli indirip açıklamayı kopyalayabilirsin. Gerçek paylaşım için kurulum rehberine bak.</div>` : "") + `<div id="composer"></div>`;
  const { mountComposer } = await import("./composer.js");
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
  meetings.forEach(m => items.push({ date: m.date, type: "toplanti", time: "19.30", title: `${m.term_no}. toplantı`, sub: `Kulübümüzün ${m.club_no}. toplantısı · Hybrid Hub${m.note ? " · " + m.note : ""}`, ref: m }));
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
    ${cells.map(d => { const k = iso(d); return `<div class="day ${d.getMonth() !== m - 1 ? "out" : ""} ${k === today() ? "today" : ""}"><span class="n">${d.getDate()}</span>
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
  v.querySelectorAll("[data-i]").forEach(b => b.onclick = () => calDetail(items[+b.dataset.i], v));
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
  dlg.showModal();
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
        ${e.description ? `<p>${esc(e.description)}</p>` : ""}${e.link ? `<p><a href="${esc(e.link)}" target="_blank" rel="noopener">Etkinlik bağlantısı</a></p>` : ""}
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
  dlg.showModal();
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
  if (it.type === "kulup") return { kind: "etkinlik", subject: `${it.title} · ${when}`, body: `Merhaba,\n\n${it.title} etkinliği ${when}${it.sub ? ", " + it.sub : ""}.${it.desc ? "\n\n" + it.desc : ""}\n\nKatılıp katılamayacağını üye panelindeki "Diğer kulüplerin etkinlikleri" sayfasından işaretleyebilirsin: https://www.anitteperotaract.org/uye/#kulupler` + SIGN };
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
      <button type="button" class="btn" id="s-sms">SMS gönder</button>
      ${store.mode === "supabase" ? `<button type="button" class="btn ghost" id="s-server">Sunucudan gönder (e-posta + SMS)</button>` : ""}
      <div class="spacer"></div>
      <button type="button" class="btn ghost sm" id="c-mail">E-postaları kopyala</button>
      <button type="button" class="btn ghost sm" id="c-tel">Numaraları kopyala</button>
    </div>
    <p class="muted" style="font-size:.84rem;margin:10px 0 0">E-postada alıcılar gizli (BCC) eklenir, birbirlerinin adresini görmezler. SMS, telefondan açıldığında mesaj uygulamanda toplu mesaj olarak hazırlanır.</p>
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
  document.getElementById("s-mail").onclick = async () => {
    if (!f.reportValidity()) return;
    const to = sel().map(m => m.email).filter(Boolean);
    if (!to.length) return toast("Seçili üyelerin hiçbirinin e-postası yok.", "bad");
    const url = `mailto:${CLUB_MAIL}?bcc=${to.map(encodeURIComponent).join(",")}&subject=${encodeURIComponent(f.subject.value)}&body=${encodeURIComponent(f.body.value)}`;
    if (url.length > 1900) toast("Alıcı çok fazla olduğu için bazı e-posta uygulamaları kesebilir; gerekirse adresleri kopyalayıp yapıştır.");
    location.href = url; await log1(["email"], "cihaz"); toast(`E-posta uygulaman ${to.length} alıcıyla açıldı. Gönder'e bastığında duyuru gider.`);
  };
  document.getElementById("s-sms").onclick = async () => {
    if (!f.reportValidity()) return;
    const nums = sel().map(m => smsNumber(m.phone)).filter(Boolean);
    if (!nums.length) return toast("Seçili üyelerin hiçbirinin telefonu yok.", "bad");
    const body = encodeURIComponent(f.body.value);
    if (!isPhone()) { await copy(nums.join(", "), `${nums.length} telefon numarası`); toast("SMS telefonda açılır. Bu sayfayı telefondan açıp tekrar dene; numaralar şimdilik panoya kopyalandı."); return; }
    location.href = isIOS() ? `sms:/open?addresses=${nums.join(",")}&body=${body}` : `sms:${nums.join(",")}?body=${body}`;
    await log1(["sms"], "cihaz"); toast(`Mesaj uygulaman ${nums.length} alıcıyla açıldı. Gönder'e bastığında SMS gider.`);
  };
  const srv = document.getElementById("s-server");
  if (srv) srv.onclick = async () => {
    if (!f.reportValidity()) return;
    srv.disabled = true; srv.textContent = "Gönderiliyor…";
    try {
      const r = await store.sendAnnouncement({ subject: f.subject.value, body: f.body.value, recipient_ids: sel().map(m => m.id), channels: ["email", "sms"] });
      toast(`Gönderildi: ${r.email?.sent ?? 0} e-posta, ${r.sms?.sent ?? 0} SMS.${(r.email?.failed || r.sms?.failed) ? " Bazıları gönderilemedi." : ""}`);
      viewAnnounce(v);
    } catch (e) { fail(e); srv.disabled = false; srv.textContent = "Sunucudan gönder (e-posta + SMS)"; }
  };
  document.getElementById("c-mail").onclick = () => copy(sel().map(m => m.email).filter(Boolean).join(", "), "E-posta adresleri");
  document.getElementById("c-tel").onclick = () => copy(sel().map(m => smsNumber(m.phone)).filter(Boolean).join(", "), "Telefon numaraları");
}

boot();
