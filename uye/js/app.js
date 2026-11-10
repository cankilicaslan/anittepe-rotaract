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
  { id: "uyeler", label: "Üye listesi", show: () => true },
  { grp: "Yönetim" },
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
  const fn = { profil: viewProfile, uyeler: viewMembers, yoklama: viewAttendance, aidat: viewDues, kasa: viewTreasury, projeler: viewProjects, instagram: viewInstagram }[id];
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
  const [meetings, att, charges, dues] = await Promise.all([store.listMeetings(), store.listAttendance(), store.listCharges(), store.listDues()]);
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
        <td>${trDate(m.joined_at)}</td>
        <td><span class="tag ${STATUS[m.status]?.[1] || ""}">${STATUS[m.status]?.[0] || esc(m.status)}</span>${(m.roles || []).map(r => ` <span class="tag cran">${ROLE_LABELS[r]}</span>`).join("")}${m.past_president ? ' <span class="tag">GDB</span>' : ""}</td>
        ${seeDebt ? `<td class="num">${d.total ? `<b>${TL(d.total)}</b>${d.overdue.length ? ' <span class="tag bad">Gecikmiş</span>' : ""}` : '<span class="tag ok">Yok</span>'}</td>` : ""}
        ${admin ? `<td><button class="btn ghost sm" data-edit="${m.id}">Düzenle</button></td>` : ""}
      </tr>`;
    }).join("");
  v.innerHTML = header("Üye listesi", `${members.filter(m => m.status === "active").length} aktif üye`, `<input type="search" id="q" placeholder="İsim, görev, telefon ara" style="max-width:280px" aria-label="Üye ara">`) +
    (admin && pending.length ? `<div class="card" style="margin-bottom:16px"><h2>Onay bekleyen hesaplar</h2>${pending.map(m => `<div class="pay-row">${person(m)}<span class="muted">${esc(m.email)} · ${esc(m.phone)}</span><button class="btn sm" data-approve="${m.id}">Onayla</button><button class="btn danger sm" data-reject="${m.id}">Pasife al</button></div>`).join("")}</div>` : "") +
    `<div class="tbl-wrap"><table><thead><tr><th>Üye</th><th>Telefon</th><th>E-posta</th><th>Doğum tarihi</th><th>Meslek / okul</th><th>Üyelik</th><th>Durum</th>${seeDebt ? '<th class="num">Aidat borcu</th>' : ""}${admin ? "<th></th>" : ""}</tr></thead><tbody id="tb">${rows("")}</tbody></table></div>
    <dialog id="dlg"></dialog>`;
  const tb = document.getElementById("tb");
  const bind = () => tb.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => editMember(members.find(m => m.id === b.dataset.edit)));
  document.getElementById("q").oninput = e => { tb.innerHTML = rows(e.target.value.trim().toLocaleLowerCase("tr")); bind(); };
  bind();
  v.querySelectorAll("[data-approve]").forEach(b => b.onclick = async () => { try { await store.approveMember(b.dataset.approve); toast("Üye onaylandı."); refresh(); } catch (e) { fail(e); } });
  v.querySelectorAll("[data-reject]").forEach(b => b.onclick = async () => { try { await store.updateMember(b.dataset.reject, { status: "passive" }); toast("Hesap pasife alındı."); refresh(); } catch (e) { fail(e); } });
}

function editMember(m) {
  const dlg = document.getElementById("dlg");
  dlg.innerHTML = `<form method="dialog" id="f-em">
    <h2>${esc(m.full_name)}</h2>
    <div class="grid g2">
      <label class="f">Ad soyad<input type="text" name="full_name" value="${esc(m.full_name)}"></label>
      <label class="f">Görev<input type="text" name="title" value="${esc(m.title)}" list="titles"></label>
      <label class="f">Telefon<input type="tel" name="phone" value="${esc(m.phone)}"></label>
      <label class="f">E-posta<input type="email" name="email" value="${esc(m.email)}"></label>
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
    const patch = { full_name: fd.get("full_name"), title: fd.get("title"), phone: fd.get("phone"), email: fd.get("email"), status: fd.get("status"), joined_at: fd.get("joined_at") || null, roles: fd.getAll("role"), past_president: fd.has("past_president") };
    try { await store.updateMember(m.id, patch); if (m.id === me.id) me = await store.me(); toast("Üye bilgileri kaydedildi."); refresh(); } catch (er) { fail(er); }
  };
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
function editProject(p, v) {
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
      viewProjects(v);
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

boot();
