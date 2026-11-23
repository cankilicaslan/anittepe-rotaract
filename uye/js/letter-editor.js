// Başkan Mektubu: üye paneli ekranı.
// mountLetterEditor(root, { store, me, toast, readOnly, letterId }) => { destroy(), isDirty() }
//
// Bölümler: yardımcılar · fotoğraf · pencereler · liste · mektup kabuğu (üst çubuk,
// kaydet/yayınla) · elle düzenleyici · yazdırma (PDF).
// "Yapay zekâ ile oluştur" klasörleri: letter-folders.js.
// Sayfa çizimi assets/js/letter-render.js, klasör → sayfa assets/js/letter-assemble.js.

import { LAYOUTS, renderPage, renderLetter, tocFromPages, MAX_PHOTOS, esc } from "../../assets/js/letter-render.js?v=202611231411";
import { LONG_WORDS, wordCount } from "../../assets/js/letter-assemble.js?v=202611231411";
import { hasRole } from "./roles.js?v=202611231411";
import {
  mountFolders, ensureFolders, aiItem, findItem, guessItem, kunyeDefaults, suggestPeriod, norm,
  rowsHtml, rowsAction, rowsInput, parseKunye, safeId, CLUB,
} from "./letter-folders.js?v=202611231411";

// ---------------------------------------------------------------- yardımcılar

const LOGO = new URL("../../assets/logo-beyaz.webp", import.meta.url).href;
const uid = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const clone = x => JSON.parse(JSON.stringify(x ?? null));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const photoUrl = ref => (ref && typeof ref === "object" ? ref.url || "" : typeof ref === "string" ? ref : "");
const mkRef = r => ({ path: r.path, url: r.url, pos: { x: 0.5, y: 0.5 }, zoom: 1 });
const dateTime = s => (s ? new Date(s).toLocaleString("tr-TR", { dateStyle: "medium", timeStyle: "short" }) : "");
const hasFiles = e => [...(e.dataTransfer?.types || [])].includes("Files");
const statusChip = s => (s === "yayinda" ? `<span class="tag ok">Yayında</span>` : `<span class="tag">Taslak</span>`);
// Anahtar sırasından bağımsız karşılaştırma (jsonb anahtarları yeniden sıralar).
const stable = v => JSON.stringify(v ?? null, (k, x) => (x && typeof x === "object" && !Array.isArray(x)
  ? Object.keys(x).sort().reduce((o, key) => ((o[key] = x[key]), o), {}) : x));

// Kayıtlı sayfalar: nesne olmayanlar atılır, kimliği bozuk olanlara yenisi verilir.
const normPages = pages => (Array.isArray(pages) ? pages : [])
  .filter(p => p && typeof p === "object")
  .map(p => ({ ...p, id: safeId(p.id), fields: p.fields && typeof p.fields === "object" ? p.fields : {} }));

const GROUP_NAMES ={ "neler-2": "madde", "mesaj-2": "mesaj", kose: "yazı" };
const LAYOUT_HINT = {
  kapak: "Sayı ve dönem boşsa mektubun bilgileri yazılır.",
  kunye: "Rotary yöneticileri ve kulüp yönetim kurulu.",
  icindekiler: "Boş bırakırsan başlıklar sayfalardan otomatik gelir.",
  baskan: "Başkanın kendi yazısı. Boş satır yeni paragraf açar.",
  "mesaj-2": "İki yönetim kurulu mesajı ve imzaları.",
  "mesaj-1": "Tek mesaj ve yanında büyük görsel.",
  kose: "İki sütun: yazı, imza ve yuvarlak fotoğraf.",
  "neler-2": `Etiket fotoğrafın altında yazar. ${LONG_WORDS} kelimeyi aşan metin tam sayfaya taşınabilir.`,
  "neler-1": `Tek madde, büyük fotoğraf. ${LONG_WORDS} kelimeyi aşan metin tam sayfaya taşınabilir.`,
  "neler-tam": `Uzun metinli madde ve en fazla ${MAX_PHOTOS} fotoğraflık kolaj.`,
  serbest: `Başlık, metin ve en fazla ${MAX_PHOTOS} fotoğraf.`,
};

export function mountLetterEditor(root, { store, me, toast: toastFn, readOnly = false, letterId = null } = {}) {
  const toast = (m, k = "") => toastFn?.(String(m ?? ""), k);
  const ro = !!readOnly;
  const canPublish = !ro && hasRole(me, "baskan");
  const isDemo = store.mode === "demo";
  let destroyed = false;
  const cleanups = [];
  const on = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); cleanups.push(() => t.removeEventListener(ev, fn, o)); };
  root.classList.add("le-root");
  root.classList.toggle("le-ro", ro);

  // ---------------------------------------------------------------- fotoğraf

  // Görseli tarayıcıda küçültüp JPEG yapar (uzun kenar ≤1600 px). Demo modunda
  // fotoğraflar tarayıcı deposunda tutulduğu için daha küçük tutulur.
  function loadImg(file) {
    return new Promise((res, rej) => {
      const u = URL.createObjectURL(file), i = new Image();
      i.onload = () => { URL.revokeObjectURL(u); res(i); };
      i.onerror = () => { URL.revokeObjectURL(u); rej(new Error("Bu görsel açılamadı. JPG ya da PNG deneyin.")); };
      i.src = u;
    });
  }
  async function compress(file) {
    const max = isDemo ? 1000 : 1600, q = isDemo ? 0.78 : 0.85;
    let src;
    try { src = await createImageBitmap(file, { imageOrientation: "from-image" }); } catch { src = await loadImg(file); }
    const w = src.width || src.naturalWidth, h = src.height || src.naturalHeight;
    const k = Math.min(1, max / Math.max(w, h));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
    const g = c.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(src, 0, 0, c.width, c.height);
    src.close?.();
    return new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error("Görsel hazırlanamadı."))), "image/jpeg", q));
  }

  let busy = 0;
  const setBusy = d => { busy = Math.max(0, busy + d); renderTop(); };
  async function uploadFiles(files, max = Infinity) {
    if (ro || !E) return [];
    const all = [...(files || [])];
    const imgs = all.filter(f => /^image\//.test(f.type));
    if (imgs.length < all.length) toast("Yalnızca görsel dosyaları eklenebilir (JPG, PNG, WEBP…).", "error");
    if (imgs.length > max) toast(max === 1 ? "Bu alana tek fotoğraf konur; ilki alındı." : `En fazla ${max} fotoğraf alınabildi.`, "error");
    const list = imgs.slice(0, max), out = [], id = E.letter.id;
    if (!list.length) return out;
    setBusy(list.length);
    for (const f of list) {
      try { out.push(mkRef(await store.uploadLetterPhoto(id, await compress(f)))); }
      catch (e) { if (!destroyed) toast(e.message || "Fotoğraf yüklenemedi.", "error"); }
      finally { if (!destroyed) setBusy(-1); }
    }
    return out;
  }
  async function copyAvatar(url) {
    setBusy(1);
    try { return mkRef(await store.copyAvatarToLetter(E.letter.id, new URL(url, location.href).href)); }
    finally { if (!destroyed) setBusy(-1); }
  }

  const filePicker = Object.assign(document.createElement("input"), { type: "file", accept: "image/*", hidden: true });
  document.body.appendChild(filePicker);
  cleanups.push(() => filePicker.remove());
  function pickFiles(multiple) {
    return new Promise(res => {
      filePicker.multiple = !!multiple;
      filePicker.value = "";
      filePicker.onchange = () => res([...filePicker.files]);
      filePicker.oncancel = () => res([]);
      filePicker.click();
    });
  }

  // ---------------------------------------------------------------- pencereler

  function dialog(inner, { wide = false, init } = {}) {
    return new Promise(resolve => {
      const d = document.createElement("dialog");
      d.className = "le-dlg" + (wide ? " wide" : "");
      d.innerHTML = inner;
      document.body.appendChild(d);
      let val;
      const done = v => { val = v; d.close(); };
      d.addEventListener("close", () => { d.remove(); resolve(val !== undefined ? val : d.returnValue || null); });
      cleanups.push(() => { if (d.isConnected) d.close(); });
      init?.(d, done);
      d.showModal();
    });
  }
  // Fotoğraf arşivinden seç: ana klasör → etkinlik klasörü → fotoğraflar. Seçilenler dosya olarak döner;
  // yükleme (sıkıştırma + mektup deposuna kopya) her zamanki yoldan yapılır, böylece yayımlanan mektupta da görünür.
  const ARCH_TYPES = { toplanti: "Toplantılar", ocakbasi: "Ocakbaşları", proje: "Projeler", etkinlik: "Etkinlik ve organizasyonlar", diger: "Diğer" };
  async function pickArchive(max = 1) {
    let albums = [];
    try { albums = await store.listAlbums(); } catch (e) { toast(e.message || "Fotoğraf arşivi açılamadı.", "error"); return []; }
    const chosen = await dialog(`<form method="dialog" class="le-arch"><div class="le-arch-h"><h2>Fotoğraf arşivinden seç</h2><button class="btn ghost sm" value="">Kapat</button></div>
      <nav class="le-arch-crumbs" aria-label="Konum"></nav><div class="le-arch-body"></div>
      <div class="row le-dlg-acts"><button type="button" class="btn" data-arch="ok" disabled>Seçilenleri ekle</button><span class="muted le-arch-n"></span></div></form>`, {
      wide: true,
      init(d, done) {
        const body = d.querySelector(".le-arch-body"), crumbs = d.querySelector(".le-arch-crumbs"), okB = d.querySelector("[data-arch=ok]"), nEl = d.querySelector(".le-arch-n");
        const sel = new Map(); // id → url (tam boy)
        const upd = () => { okB.disabled = !sel.size; okB.textContent = sel.size ? `Seçilenleri ekle (${sel.size})` : "Seçilenleri ekle"; nEl.textContent = max > 1 && max < Infinity ? `En fazla ${max} fotoğraf` : max === 1 ? "Tek fotoğraf seçilir" : ""; };
        const crumb = list => { crumbs.innerHTML = list.map(([l, fn], i) => i < list.length - 1 ? `<button type="button" class="le-arch-c" data-c="${i}">${esc(l)}</button><span aria-hidden="true">›</span>` : `<b>${esc(l)}</b>`).join(""); crumbs.querySelectorAll("[data-c]").forEach(b => b.onclick = () => list[+b.dataset.c][1]()); };
        const showTypes = () => {
          crumb([["Fotoğraf arşivi", showTypes]]);
          const types = Object.entries(ARCH_TYPES).filter(([k]) => albums.some(a => a.type === k));
          body.innerHTML = types.length ? `<div class="le-arch-grid">${types.map(([k, l]) => { const list = albums.filter(a => a.type === k), cov = list.find(a => a.cover_url); return `<button type="button" class="le-arch-f" data-t="${k}"><span class="le-arch-cov">${cov ? `<img src="${esc(cov.cover_url)}" alt="" loading="lazy">` : ""}</span><b>${esc(l)}</b><small>${list.length} klasör</small></button>`; }).join("")}</div>` : `<p class="muted">Arşivde henüz fotoğraf yok.</p>`;
          body.querySelectorAll("[data-t]").forEach(b => b.onclick = () => showAlbums(b.dataset.t));
        };
        const showAlbums = t => {
          crumb([["Fotoğraf arşivi", showTypes], [ARCH_TYPES[t], () => showAlbums(t)]]);
          const list = albums.filter(a => a.type === t).sort((x, y) => String(y.date).localeCompare(String(x.date)));
          body.innerHTML = `<div class="le-arch-grid">${list.map(a => `<button type="button" class="le-arch-f" data-a="${esc(a.id)}"><span class="le-arch-cov">${a.cover_url ? `<img src="${esc(a.cover_url)}" alt="" loading="lazy">` : ""}</span><b>${esc(a.name)}</b><small>${a.photo_count ?? ""} fotoğraf</small></button>`).join("")}</div>`;
          body.querySelectorAll("[data-a]").forEach(b => b.onclick = () => showPhotos(t, list.find(a => a.id === b.dataset.a)));
        };
        const showPhotos = async (t, al) => {
          crumb([["Fotoğraf arşivi", showTypes], [ARCH_TYPES[t], () => showAlbums(t)], [al.name, () => showPhotos(t, al)]]);
          body.innerHTML = `<p class="muted">Yükleniyor…</p>`;
          let ph = [];
          try { ph = await store.listPhotos(al.id); } catch (e) { body.innerHTML = `<p class="muted">${esc(e.message || "Fotoğraflar açılamadı.")}</p>`; return; }
          body.innerHTML = ph.length ? `<div class="le-arch-photos">${ph.map(p => `<button type="button" class="le-arch-p${sel.has(p.id) ? " is-sel" : ""}" data-p="${esc(p.id)}" aria-pressed="${sel.has(p.id)}"><img src="${esc(p.thumb_url || p.url)}" alt="" loading="lazy"><span class="le-arch-tick" aria-hidden="true">✓</span></button>`).join("")}</div>` : `<p class="muted">Bu klasörde fotoğraf yok.</p>`;
          body.querySelectorAll("[data-p]").forEach(b => b.onclick = () => {
            const p = ph.find(x => x.id === b.dataset.p);
            if (sel.has(p.id)) sel.delete(p.id);
            else {
              if (max === 1) { sel.clear(); body.querySelectorAll(".le-arch-p.is-sel").forEach(x => { x.classList.remove("is-sel"); x.setAttribute("aria-pressed", "false"); }); }
              else if (sel.size >= max) { toast(`En fazla ${max} fotoğraf seçebilirsin.`, "error"); return; }
              sel.set(p.id, p.url || p.thumb_url);
            }
            b.classList.toggle("is-sel", sel.has(p.id)); b.setAttribute("aria-pressed", String(sel.has(p.id))); upd();
          });
        };
        okB.onclick = () => done([...sel.values()]);
        upd(); showTypes();
      },
    });
    if (!Array.isArray(chosen) || !chosen.length) return [];
    setBusy(chosen.length);
    const files = [];
    for (const u of chosen) {
      try { const r = await fetch(u); if (!r.ok) throw new Error(); const b = await r.blob(); files.push(new File([b], "arsiv.jpg", { type: b.type || "image/jpeg" })); }
      catch { toast("Bir fotoğraf arşivden alınamadı.", "error"); }
      finally { if (!destroyed) setBusy(-1); }
    }
    return files;
  }
  async function confirmDlg({ title, body = "", ok = "Tamam", cancel = "Vazgeç", danger = false }) {
    const r = await dialog(`<form method="dialog"><h2>${esc(title)}</h2>${body}
      <div class="row le-dlg-acts"><button class="btn${danger ? " le-danger" : ""}" value="ok">${esc(ok)}</button><button class="btn ghost" value="no">${esc(cancel)}</button></div></form>`);
    return r === "ok";
  }
  const initials = n => String(n || "?").split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join("").toLocaleUpperCase("tr");
  function pickPerson({ guests = false, title = "Kişi seç" } = {}) {
    const mem = (E?.refs.members || []).filter(m => m.status === "active");
    const gs = guests ? E?.refs.guests || [] : [];
    const row = (attr, name, sub, url) => `<button type="button" class="le-person" ${attr} data-q="${esc(norm(name))}">
      <span class="lf-av">${url ? `<img src="${esc(url)}" alt="">` : esc(initials(name))}</span><span><b>${esc(name)}</b><small>${esc(sub)}</small></span></button>`;
    return dialog(`<form method="dialog" class="le-pick"><h2>${esc(title)}</h2>
      <input type="search" class="le-pick-q" placeholder="İsim ara" aria-label="İsim ara" autocomplete="off">
      <div class="le-pick-list">
        ${mem.length ? `<p class="le-pick-grp">Üyeler</p>${mem.map((m, i) => row(`data-m="${i}"`, m.full_name, m.title || "Üye", m.photo_url)).join("")}` : ""}
        ${gs.length ? `<p class="le-pick-grp">Misafirler</p>${gs.map((g, i) => row(`data-g="${i}"`, g, "Misafir", "")).join("")}` : ""}
        <p class="muted le-pick-none" hidden>Eşleşen kişi yok.</p>
      </div>
      <div class="row"><button class="btn ghost" value="">Vazgeç</button></div></form>`, {
      init(d, done) {
        const q = d.querySelector(".le-pick-q");
        q.addEventListener("input", () => {
          const k = norm(q.value);
          let n = 0;
          d.querySelectorAll(".le-person").forEach(b => { const hit = !k || b.dataset.q.includes(k); b.hidden = !hit; n += hit; });
          d.querySelectorAll(".le-pick-grp").forEach(g => { let s = g.nextElementSibling, any = false; while (s && s.classList.contains("le-person")) { any ||= !s.hidden; s = s.nextElementSibling; } g.hidden = !any; });
          d.querySelector(".le-pick-none").hidden = n > 0;
        });
        q.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); d.querySelector(".le-person:not([hidden])")?.click(); } });
        d.addEventListener("click", e => {
          const b = e.target.closest(".le-person");
          if (!b) return;
          done(b.dataset.m != null ? { member: mem[+b.dataset.m] } : { name: gs[+b.dataset.g] });
        });
        setTimeout(() => q.focus());
      },
    });
  }

  // ---------------------------------------------------------------- liste

  async function showList() {
    root.innerHTML = `<div class="ll">
      <div class="ll-head"><p class="muted">Her sayı önce taslak olarak hazırlanır; Başkan yayınlayınca sitede <b>/mektup/</b> adresinde görünür.</p>
        ${ro ? "" : `<button type="button" class="btn" data-ll="new">+ Yeni sayı</button>`}</div>
      <div class="ll-grid" aria-busy="true"><p class="muted">Sayılar yükleniyor…</p></div></div>`;
    const grid = root.querySelector(".ll-grid");
    let list;
    try { list = await store.listLetters(); }
    catch (e) { if (!destroyed) grid.innerHTML = `<div class="err">${esc(e.message)}</div>`; return; }
    if (destroyed) return;
    list = [...(list || [])].sort((a, b) => b.issue_no - a.issue_no);
    grid.removeAttribute("aria-busy");
    const canDelete = !ro && hasRole(me, "baskan");
    grid.innerHTML = list.length ? list.map(l => `<div class="ll-item"><a class="ll-card" href="#mektup/${encodeURIComponent(l.id)}" aria-label="Sayı ${esc(l.issue_no)}, ${esc(l.period || "")}, ${l.status === "yayinda" ? "yayında" : "taslak"}">
        <div class="ll-cover" data-cover="${esc(l.id)}" aria-hidden="true">${renderPage({ layout: "kapak", fields: {} }, { logoUrl: LOGO, letter: { issue_no: l.issue_no, period: l.period } })}</div>
        <div class="ll-meta"><b>Sayı ${esc(l.issue_no)}</b><span>${esc(l.period || "Dönem yazılmadı")}</span>
          <div class="ll-foot">${statusChip(l.status)}<small>Son güncelleme: ${esc(dateTime(l.updated_at))}</small></div></div></a>${canDelete ? `<button type="button" class="ll-del" data-del="${esc(l.id)}" aria-label="Sayı ${esc(l.issue_no)} sil">Sil</button>` : ""}</div>`).join("")
      : `<div class="ll-empty"><b>Bu dönem henüz sayı yok.</b><span>${ro ? "Hazırlanan sayılar burada görünecek." : "“+ Yeni sayı” ile ilk mektubu başlat."}</span></div>`;
    const btn = root.querySelector('[data-ll="new"]');
    if (btn) btn.onclick = () => newIssue(list);
    grid.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
      const l = list.find(x => x.id === b.dataset.del); if (!l) return;
      const live = l.status === "yayinda";
      const yes = await confirmDlg({
        title: `Sayı ${l.issue_no} silinsin mi?`,
        body: `<p>Sayı ${esc(l.issue_no)}${l.period ? ` (${esc(l.period)})` : ""}, sayfaları ve fotoğraflarıyla birlikte kalıcı olarak silinecek.${live ? " <b>Sitede yayında olduğu için /mektup/ sayfasından da kalkacak.</b>" : ""} Bu işlem geri alınamaz.</p>`,
        ok: "Kalıcı olarak sil", danger: true,
      });
      if (!yes || destroyed) return;
      b.disabled = true;
      try { await store.deleteLetter(l.id); toast(`Sayı ${l.issue_no} silindi.`); if (!destroyed) showList(); }
      catch (e) { b.disabled = false; toast(e.message || "Silinemedi.", "error"); }
    });
    // Kapak küçük resmi: liste sorgusu sayfaları getirmez; her sayının ilk sayfası sonradan çizilir.
    for (const l of list) {
      store.getLetter(l.id).then(full => {
        const p = Array.isArray(full?.pages) ? full.pages[0] : null;
        const box = !destroyed && p && grid.querySelector(`[data-cover="${CSS.escape(l.id)}"]`);
        if (box) box.innerHTML = renderPage(p, { photoUrl, logoUrl: LOGO, letter: { issue_no: full.issue_no, period: full.period }, toc: tocFromPages(full.pages) });
      }).catch(() => {});
    }
  }

  async function newIssue(list) {
    const next = (list.reduce((m, l) => Math.max(m, +l.issue_no || 0), 0) || 0) + 1;
    await dialog(`<form method="dialog" class="le-new"><h2>Yeni sayı</h2>
      <div class="grid g2">
        <label class="f">Sayı numarası<input type="number" name="issue_no" min="1" step="1" value="${next}" required></label>
        <label class="f">Dönem <small>Kapakta yazar</small><input type="text" name="period" value="${esc(suggestPeriod())}" placeholder="Eylül - Ekim 2026" required></label>
      </div>
      <p class="muted" style="margin:0">Dönem yazısındaki aylar, toplantıların otomatik geleceği tarih aralığını da belirler.</p>
      <div class="err" hidden></div>
      <div class="row"><button class="btn" value="ok">Oluştur</button><button class="btn ghost" value="" formnovalidate>Vazgeç</button></div></form>`, {
      init(d, done) {
        const form = d.querySelector("form"), err = d.querySelector(".err");
        form.addEventListener("submit", async e => {
          if (e.submitter?.value !== "ok") return;
          e.preventDefault();
          const fd = new FormData(form), issue_no = Math.round(+fd.get("issue_no")), period = String(fd.get("period") || "").trim();
          if (!(issue_no >= 1) || !period) { err.hidden = false; err.textContent = "Sayı numarası ve dönem gerekli."; return; }
          e.submitter.disabled = true;
          try {
            const l = await store.createLetter({ issue_no, period });
            done("ok");
            location.hash = `#mektup/${encodeURIComponent(l.id)}`;
          } catch (er) { err.hidden = false; err.textContent = er.message || "Oluşturulamadı."; e.submitter.disabled = false; }
        });
      },
    });
  }

  // ---------------------------------------------------------------- mektup kabuğu

  let E = null; // açık mektup: { letter, rev, savedRev, tab, sel, refs, saving, folders, photoSel }
  const isDirty = () => !!E && E.rev !== E.savedRev;
  let topT = 0;
  function markDirty() {
    if (!E) return;
    E.rev++;
    clearTimeout(topT);
    if (E.rev - E.savedRev === 1) renderTop(); else topT = setTimeout(renderTop, 300);
  }

  async function loadRefs() {
    const safe = (fn, d) => Promise.resolve().then(fn).then(x => x ?? d).catch(() => d);
    const [members, guests, meetings, term, kunyeRaw] = await Promise.all([
      safe(() => store.listMembers(), []), safe(() => store.listGuestNames(), []), safe(() => store.listMeetings(), []),
      safe(() => store.getTerm(), null), safe(() => store.getSetting("letter_kunye"), null),
    ]);
    return { members, guests, meetings, term, kunye: parseKunye(kunyeRaw) };
  }

  const ctx = {
    store, toast, ro, isDemo, photoUrl,
    get letter() { return E.letter; },
    get folders() { return E.letter.folders; },
    get refs() { return E.refs; },
    markDirty, syncHeader: () => renderTop(),
    uploadFiles, pickFiles, pickArchive, copyAvatar, pickPerson, confirmDlg,
    hasPages: () => E.letter.pages.length > 0,
    setPages(pages) { E.letter.pages = pages; E.sel = 0; markDirty(); E.tab = "manual"; renderTop(); renderTab(); },
  };

  async function openLetter(id) {
    root.innerHTML = `<p class="muted">Mektup yükleniyor…</p>`;
    let letter, refs;
    try { [letter, refs] = await Promise.all([store.getLetter(id), loadRefs()]); }
    catch (e) {
      if (!destroyed) root.innerHTML = `<div class="err">${esc(e.message)}</div><p><a class="btn ghost sm" href="#mektup">← Sayılara dön</a></p>`;
      return;
    }
    if (destroyed) return;
    letter.pages = normPages(letter.pages);
    letter.folders = ensureFolders(letter, refs);
    E = { letter, rev: 0, savedRev: 0, tab: letter.pages.length ? "manual" : "ai", sel: 0, refs, saving: false, folders: null, photoSel: {} };
    root.innerHTML = `<div class="le">
      <div class="le-top" id="le-top"></div>
      <div class="le-tabs" role="tablist" aria-label="Düzenleme biçimi">
        <button type="button" role="tab" id="le-tab-ai" data-tab="ai" aria-controls="le-panel">✦ Yapay zekâ ile oluştur</button>
        <button type="button" role="tab" id="le-tab-manual" data-tab="manual" aria-controls="le-panel">Elle düzenle</button>
      </div>
      <div id="le-panel" role="tabpanel"></div></div>`;
    const le = root.querySelector(".le"), top = root.querySelector("#le-top");
    const tabs = root.querySelector(".le-tabs");
    tabs.addEventListener("click", e => { const b = e.target.closest("[data-tab]"); if (b && b.dataset.tab !== E.tab) { E.tab = b.dataset.tab; renderTab(); } });
    tabs.addEventListener("keydown", e => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      E.tab = E.tab === "ai" ? "manual" : "ai"; renderTab();
      tabs.querySelector(`[data-tab="${E.tab}"]`).focus();
    });
    top.addEventListener("click", e => {
      const b = e.target.closest("[data-top]");
      if (!b || b.disabled) return;
      ({ save, pdf: printPdf, publish: () => publish(false), republish: () => publish(true), unpublish })[b.dataset.top]?.();
    });
    // Üst çubuğun yüksekliği yapışkan sütunların üst boşluğunu belirler.
    const ro2 = new ResizeObserver(() => le.style.setProperty("--le-top-h", `${top.offsetHeight}px`));
    ro2.observe(top);
    cleanups.push(() => ro2.disconnect());
    on(window, "beforeunload", e => { if (isDirty()) { e.preventDefault(); e.returnValue = ""; } });
    on(document, "keydown", e => { if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "s") { e.preventDefault(); save(); } });
    // Sürüklenen dosya yanlış yere bırakılırsa tarayıcı sayfadan çıkmasın.
    on(window, "dragover", e => { if (hasFiles(e) && !e.defaultPrevented) { e.preventDefault(); e.dataTransfer.dropEffect = "none"; } });
    on(window, "drop", e => { if (hasFiles(e)) e.preventDefault(); });
    on(window, "resize", fitStage);
    renderTop();
    renderTab();
  }

  function renderTop() {
    if (!E || destroyed) return;
    const top = root.querySelector("#le-top");
    if (!top) return;
    const L = E.letter, dirty = isDirty(), pub = L.status === "yayinda";
    const changed = pub && stable(L.pages) !== stable(L.published_pages || []);
    const focused = top.contains(document.activeElement) ? document.activeElement.dataset.top : null;
    const noPages = !L.pages.length;
    top.innerHTML = `<a class="le-back" href="#mektup"><span aria-hidden="true">←</span> Sayılar</a>
      <div class="le-title">
        <h1>Sayı ${esc(L.issue_no)}<span> · ${esc(L.period || "Dönem yazılmadı")}</span></h1>
        <div class="le-state" role="status">${statusChip(L.status)}
          ${changed ? `<span class="le-note">Yayından sonra değişiklik var</span>` : ""}
          ${dirty ? `<span class="le-note le-unsaved">Kaydedilmemiş değişiklik</span>` : ""}
          ${busy ? `<span class="le-note le-busy"><i class="le-spin" aria-hidden="true"></i>Fotoğraf yükleniyor (${busy})…</span>` : ""}</div>
      </div>
      <div class="le-acts">
        ${ro ? "" : `<button type="button" class="btn" data-top="save" title="Kaydet (Ctrl+S)"${!dirty || busy || E.saving ? " disabled" : ""}>${E.saving ? "Kaydediliyor…" : "Kaydet"}</button>`}
        <button type="button" class="btn ghost" data-top="pdf"${noPages ? ' disabled title="Önce sayfa ekle"' : ""}>PDF indir</button>
        ${!canPublish ? "" : pub
          ? `${changed ? `<button type="button" class="btn ghost" data-top="republish">Güncel hâli yayınla</button>` : ""}<button type="button" class="btn ghost le-danger-ghost" data-top="unpublish">Yayından kaldır</button>`
          : `<button type="button" class="btn ghost le-pub" data-top="publish"${noPages ? " disabled" : ""}>Yayınla</button>`}
      </div>`;
    if (focused) top.querySelector(`[data-top="${focused}"]:not(:disabled)`)?.focus();
  }

  function renderTab() {
    if (!E) return;
    const panel = root.querySelector("#le-panel");
    root.querySelectorAll(".le-tabs [role=tab]").forEach(b => {
      const sel = b.dataset.tab === E.tab;
      b.setAttribute("aria-selected", String(sel));
      b.tabIndex = sel ? 0 : -1;
    });
    panel.setAttribute("aria-labelledby", `le-tab-${E.tab}`);
    E.folders?.destroy();
    E.folders = null;
    stageObs?.disconnect();
    if (E.tab === "ai") E.folders = mountFolders(panel, ctx);
    else renderManual();
  }

  async function save() {
    if (ro || !E || E.saving || !isDirty()) return !isDirty();
    if (busy) { toast("Fotoğraflar yüklenirken kaydedilemez; biraz bekle.", "error"); return false; }
    const L = E.letter;
    if (!(+L.issue_no >= 1)) { toast("Sayı numarası 1 ya da daha büyük olmalı.", "error"); return false; }
    const rev = E.rev;
    E.saving = true; renderTop();
    try {
      const row = await store.saveLetter({ id: L.id, issue_no: +L.issue_no, period: L.period, pages: L.pages, folders: L.folders }, L.updated_at);
      if (destroyed) return true;
      L.updated_at = row?.updated_at ?? L.updated_at;
      E.savedRev = rev;
      toast("Kaydedildi.");
      return true;
    } catch (e) {
      if (destroyed) return false;
      if (e?.code !== "conflict") { toast(e.message || "Kaydedilemedi.", "error"); return false; }
    } finally {
      if (!destroyed && E) { E.saving = false; renderTop(); }
    }
    return resolveConflict();
  }

  // Araya başka bir kayıt girdi: onunkini yükle, benimkini üstüne yaz ya da düzenlemeye dön.
  async function resolveConflict() {
    const r = await dialog(`<form method="dialog"><h2>Başka biri bu sayıyı kaydetti.</h2>
      <p>Sen düzenlerken bu sayı başka bir yerden kaydedildi. Ne yapmak istersin?</p>
      <p><b>Onun hâlini yükle:</b> son kaydedilen hâl açılır; <b>senin kaydedilmemiş değişikliklerin silinir.</b></p>
      <p><b>Benimkini yine de kaydet:</b> senin hâlin kaydedilir; onun yaptığı değişiklikler kaybolur.</p>
      <div class="row le-dlg-acts"><button class="btn ghost" value="theirs">Onun hâlini yükle</button><button class="btn" value="mine">Benimkini yine de kaydet</button><button class="btn ghost" value="">Vazgeç</button></div></form>`);
    if (destroyed || !E) return false;
    if (r === "theirs") {
      try { await reread(); toast("Son kaydedilen hâl yüklendi."); }
      catch (e) { if (!destroyed) toast(e.message || "Yüklenemedi.", "error"); }
      return false;
    }
    if (r !== "mine") return false;
    const id = E.letter.id;
    try {
      const cur = await store.getLetter(id);
      if (destroyed || !E || E.letter.id !== id) return false;
      E.letter.updated_at = cur.updated_at;
    } catch (e) { if (!destroyed) toast(e.message || "Kaydedilemedi.", "error"); return false; }
    return save();
  }

  async function reread() {
    const fresh = await store.getLetter(E.letter.id);
    if (destroyed) return;
    fresh.pages = normPages(fresh.pages);
    fresh.folders = ensureFolders(fresh, E.refs);
    E.letter = fresh;
    E.rev = E.savedRev = 0;
    renderTop(); renderTab();
  }

  // Yayın işlemi sürerken yazılan değişiklikler kaybolmasın: o durumda yalnızca yayın alanları tazelenir.
  async function afterPublishChange(rev) {
    if (destroyed || !E) return;
    if (E.rev === rev) return reread();
    const L = E.letter;
    const fresh = await store.getLetter(L.id);
    if (destroyed || !E || E.letter !== L) return;
    Object.assign(L, { status: fresh.status, published_pages: fresh.published_pages, published_at: fresh.published_at, updated_at: fresh.updated_at });
    renderTop();
  }

  const savingNow = () => { if (!E?.saving) return false; toast("Kayıt sürüyor, birazdan tekrar dene.", "error"); return true; };

  async function publish(again) {
    if (savingNow()) return;
    const L = E.letter;
    const ok = await confirmDlg({
      title: again ? "Güncel hâli yayınlansın mı?" : `Sayı ${L.issue_no} yayınlansın mı?`,
      body: `<p>Mektup sitede <b>/mektup/</b> adresinde herkese açık olur.${again ? " Sitedeki eski hâlin yerini alır." : ""}</p>${isDirty() ? `<p class="muted">Kaydedilmemiş değişiklikler önce kaydedilecek.</p>` : ""}`,
      ok: "Yayınla",
    });
    if (!ok || destroyed || savingNow() || (isDirty() && !(await save()))) return;
    const rev = E.rev;
    try { await store.publishLetter(L.id); }
    catch (e) { toast(e.message || "Yayınlanamadı.", "error"); return; }
    toast("Mektup yayınlandı.");
    await afterPublishChange(rev).catch(() => { if (!destroyed) toast("Yayın durumu ekranda yenilenemedi; sayfayı yenile.", "error"); });
  }
  async function unpublish() {
    if (savingNow()) return;
    const L = E.letter;
    const ok = await confirmDlg({ title: `Sayı ${L.issue_no} yayından kaldırılsın mı?`, body: "<p>Sitede artık görünmez; mektup taslak olarak kalır ve yeniden yayınlanabilir.</p>", ok: "Yayından kaldır", danger: true });
    if (!ok || destroyed || savingNow()) return;
    if (isDirty() && !(await save())) return;
    const rev = E.rev;
    try { await store.unpublishLetter(L.id); }
    catch (e) { toast(e.message || "Yayından kaldırılamadı.", "error"); return; }
    toast("Mektup yayından kaldırıldı.");
    await afterPublishChange(rev).catch(() => { if (!destroyed) toast("Yayın durumu ekranda yenilenemedi; sayfayı yenile.", "error"); });
  }

  // ---------------------------------------------------------------- elle düzenleyici

  let stageObs = null, auxT = 0, dragMoved = false;
  const panelEl = () => root.querySelector("#le-panel");
  const curPage = () => E.letter.pages[E.sel];
  const layoutOf = p => LAYOUTS[p?.layout] || LAYOUTS.serbest;
  const fieldDef = (p, key) => layoutOf(p).fields.find(f => f.key === key);
  const pageOpts = editable => ({ photoUrl, logoUrl: LOGO, editable, letter: { period: E.letter.period, issue_no: E.letter.issue_no }, toc: tocFromPages(E.letter.pages) });

  // Taşma: sayfalar gizli bir kapta gerçek ölçüde çizilip ölçülür.
  function overflowOf(pages) {
    const box = document.createElement("div");
    box.className = "le-measure";
    box.setAttribute("aria-hidden", "true");
    const o = pageOpts(false);
    box.innerHTML = pages.map(p => renderPage(p, o)).join("");
    document.body.appendChild(box);
    const res = [...box.children].map(sec => [...sec.querySelectorAll("[data-overflow-check]")].some(el => el.scrollHeight > el.clientHeight + 2));
    box.remove();
    return res;
  }

  function renderManual() {
    const panel = panelEl(), L = E.letter;
    if (!L.pages.length) {
      panel.innerHTML = `<div class="le-empty"><div class="le-empty-art" aria-hidden="true">${renderPage({ layout: "kapak", fields: {} }, { logoUrl: LOGO, letter: { issue_no: L.issue_no, period: L.period } })}</div>
        <div><h2>Henüz sayfa yok</h2><p class="muted">Klasörleri doldurup sayfaları yapay zekâyla kurabilir ya da düzen seçerek sayfa sayfa ilerleyebilirsin.</p>
        <div class="row">${ro ? "" : `<button type="button" class="btn" data-m="go-ai">✦ Klasörlere git</button><button type="button" class="btn ghost" data-m="add">+ Sayfa ekle</button>`}</div></div></div>`;
      panel.querySelector('[data-m="go-ai"]')?.addEventListener("click", () => { E.tab = "ai"; renderTab(); });
      panel.querySelector('[data-m="add"]')?.addEventListener("click", addPage);
      return;
    }
    E.sel = clamp(E.sel, 0, L.pages.length - 1);
    panel.innerHTML = `<div class="le-man">
      <aside class="le-side" aria-label="Sayfalar">
        <div class="le-side-h"><b>Sayfalar</b><span class="muted" id="le-count">${L.pages.length}</span></div>
        <ol class="le-thumbs" id="le-thumbs"></ol>
        ${ro ? "" : `<button type="button" class="btn ghost sm le-add" data-m="add">+ Sayfa ekle</button>`}
      </aside>
      <section class="le-stage" aria-label="Seçili sayfanın önizlemesi">
        <div class="le-sbar" id="le-sbar"></div>
        <div id="le-tips"></div>
        <div class="le-canvas" id="le-canvas"><div class="le-pagebox" id="le-page"></div></div>
        <p class="le-cap">${ro ? "Önizleme" : "Bir alana tıkla, formda açılsın. Fotoğrafı sürükleyerek konumlandır; dosyayı fotoğraf yerine bırak."}</p>
      </section>
      <aside class="le-form" id="le-form" aria-label="Sayfa alanları"></aside>
    </div>`;
    const man = panel.querySelector(".le-man");
    bindThumbs(man.querySelector("#le-thumbs"));
    bindStage(man.querySelector("#le-canvas"));
    bindForm(man.querySelector("#le-form"));
    man.querySelector('[data-m="add"]')?.addEventListener("click", addPage);
    man.querySelector("#le-sbar").addEventListener("click", stageBarClick);
    man.querySelector("#le-tips").addEventListener("click", tipsClick);
    stageObs = new ResizeObserver(fitStage);
    stageObs.observe(man.querySelector("#le-canvas"));
    E.over = overflowOf(L.pages);
    renderThumbs(); renderStage(); renderForm();
  }

  function fitStage() {
    const c = root.querySelector("#le-canvas");
    if (!c) return;
    const wide = matchMedia("(min-width: 901px)").matches;
    let s = c.clientWidth / 810;
    if (wide) s = Math.min(s, Math.max(0.42, (innerHeight - 240) / 1012));
    c.style.setProperty("--lt-scale", clamp(s, 0.2, 1).toFixed(3));
  }

  function select(i, focusThumb = false) {
    E.sel = clamp(i, 0, E.letter.pages.length - 1);
    root.querySelectorAll(".le-thumb").forEach((li, j) => {
      li.classList.toggle("is-sel", j === E.sel);
      li.querySelector(".le-thumb-btn")?.setAttribute("aria-current", String(j === E.sel));
    });
    renderStage(); renderForm();
    const li = root.querySelectorAll(".le-thumb")[E.sel];
    li?.scrollIntoView({ block: "nearest", inline: "nearest" });
    if (focusThumb) li?.querySelector(".le-thumb-btn")?.focus();
  }

  // ---------- küçük resimler
  function thumbHtml(p, i, o) {
    return `<li class="le-thumb${i === E.sel ? " is-sel" : ""}${E.over?.[i] ? " is-over" : ""}" data-i="${i}"${ro ? "" : ' draggable="true"'}>
      <button type="button" class="le-thumb-btn" aria-current="${i === E.sel}" aria-label="${i + 1}. sayfa: ${esc(layoutOf(p).label)}${E.over?.[i] ? " (metin sığmıyor)" : ""}">
        <span class="le-mini" aria-hidden="true">${renderPage(p, o)}</span>
        <span class="le-thumb-cap"><b>${i + 1}</b> ${esc(layoutOf(p).label)}</span>
      </button>
      <span class="le-warn-dot" aria-hidden="true" title="Metin sığmıyor">!</span></li>`;
  }
  function renderThumbs() {
    const ol = root.querySelector("#le-thumbs");
    if (!ol) return;
    const o = pageOpts(true);
    ol.innerHTML = E.letter.pages.map((p, i) => thumbHtml(p, i, o)).join("");
    const c = root.querySelector("#le-count");
    if (c) c.textContent = E.letter.pages.length;
  }
  function refreshThumb(i) {
    const li = root.querySelectorAll(".le-thumb")[i];
    if (!li) return;
    li.querySelector(".le-mini").innerHTML = renderPage(E.letter.pages[i], pageOpts(true));
    li.classList.toggle("is-over", !!E.over?.[i]);
  }

  function bindThumbs(ol) {
    ol.addEventListener("click", e => { const li = e.target.closest(".le-thumb"); if (li) select(+li.dataset.i); });
    ol.addEventListener("keydown", e => {
      const li = e.target.closest(".le-thumb");
      if (!li || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
      e.preventDefault();
      const d = e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 1;
      if (e.altKey && !ro) movePage(+li.dataset.i, d);
      else select(+li.dataset.i + d, true);
    });
    if (ro) return;
    let from = -1, mark = null;
    const horizontal = () => matchMedia("(max-width: 900px)").matches;
    const clear = () => { mark?.classList.remove("drop-before", "drop-after"); mark = null; };
    ol.addEventListener("dragstart", e => {
      const li = e.target.closest(".le-thumb");
      if (!li) return;
      from = +li.dataset.i;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(from));
      li.classList.add("is-dragging");
    });
    ol.addEventListener("dragover", e => {
      if (from < 0) return;
      const li = e.target.closest(".le-thumb");
      if (!li) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const r = li.getBoundingClientRect();
      const after = horizontal() ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2;
      if (mark !== li) clear();
      mark = li;
      li.classList.toggle("drop-after", after);
      li.classList.toggle("drop-before", !after);
    });
    ol.addEventListener("drop", e => {
      if (from < 0 || !mark) return;
      e.preventDefault();
      let to = +mark.dataset.i + (mark.classList.contains("drop-after") ? 1 : 0);
      if (to > from) to--;
      clear();
      const f = from; from = -1;
      if (to !== f) reorder(f, to);
    });
    ol.addEventListener("dragend", () => { clear(); from = -1; ol.querySelector(".is-dragging")?.classList.remove("is-dragging"); });
  }

  function reorder(from, to) {
    const pages = E.letter.pages, selId = pages[E.sel]?.id;
    const [p] = pages.splice(from, 1);
    pages.splice(to, 0, p);
    E.sel = Math.max(0, pages.findIndex(x => x.id === selId));
    afterStructure();
  }
  function movePage(i, d) {
    const j = i + d;
    if (j < 0 || j >= E.letter.pages.length) return;
    reorder(i, j);
    select(E.sel, true);
  }
  // Sayfa ekleme, silme, sıralama sonrası: her şey yeniden çizilir.
  function afterStructure() {
    markDirty();
    E.sel = clamp(E.sel, 0, Math.max(0, E.letter.pages.length - 1));
    if (!E.letter.pages.length) return renderManual();
    E.over = overflowOf(E.letter.pages);
    renderThumbs(); renderStage(); renderForm();
  }

  // ---------- sahne
  function renderStage() {
    const box = root.querySelector("#le-page"), p = curPage();
    if (!box || !p) return;
    box.innerHTML = renderPage(p, pageOpts(true));
    if (!ro) box.querySelectorAll(".lt-slot-empty").forEach(s => { s.setAttribute("role", "button"); s.tabIndex = 0; s.setAttribute("aria-label", "Fotoğraf seç"); });
    fitStage();
    renderStageBar();
    renderTips();
  }
  function renderStageBar() {
    const bar = root.querySelector("#le-sbar"), p = curPage();
    if (!bar || !p) return;
    const n = E.letter.pages.length, i = E.sel;
    bar.innerHTML = `<span class="le-pgno">${i + 1} / ${n}</span><span class="le-pglay">${esc(layoutOf(p).label)}</span>
      ${E.over?.[i] ? `<span class="tag bad le-overflow" role="status">⚠ Metin sayfaya sığmıyor</span>` : ""}
      <span class="spacer"></span>
      ${ro ? "" : `<span class="le-sacts">
        <button type="button" class="le-ib" data-s="up" aria-label="Sayfayı öne al" title="Öne al"${i === 0 ? " disabled" : ""}>↑</button>
        <button type="button" class="le-ib" data-s="down" aria-label="Sayfayı geri al" title="Geri al"${i === n - 1 ? " disabled" : ""}>↓</button>
        <button type="button" class="btn ghost sm" data-s="dup">Çoğalt</button>
        <button type="button" class="btn ghost sm le-danger-ghost" data-s="del">Sil</button></span>`}`;
  }
  async function stageBarClick(e) {
    const b = e.target.closest("[data-s]");
    if (!b || b.disabled || ro) return;
    const a = b.dataset.s, i = E.sel, p = curPage();
    if (a === "up" || a === "down") { movePage(i, a === "up" ? -1 : 1); root.querySelector(`#le-sbar [data-s="${a}"]:not(:disabled)`)?.focus(); return; }
    if (a === "dup") {
      E.letter.pages.splice(i + 1, 0, { ...clone(p), id: uid() });
      E.sel = i + 1; afterStructure();
      toast(`${i + 1}. sayfa çoğaltıldı.`);
      return;
    }
    if (a === "del") {
      const ok = await confirmDlg({ title: `${i + 1}. sayfa silinsin mi?`, body: `<p><b>${esc(layoutOf(p).label)}</b> sayfası ve içindeki yazılar kaldırılır. Kaydetmeden çıkarsan geri gelir.</p>`, ok: "Sayfayı sil", danger: true });
      if (!ok || !E) return;
      const at = E.letter.pages.findIndex(x => x.id === p.id);
      if (at < 0) return;
      E.letter.pages.splice(at, 1);
      E.sel = Math.min(at, E.letter.pages.length - 1);
      afterStructure();
    }
  }

  // Uzun metin önerisi (neler-2 / neler-1): maddeyi tam sayfaya taşı.
  function longItems(p) {
    if (p.layout === "neler-2") return [1, 2].filter(n => wordCount(p.fields?.[`body${n}`]) > LONG_WORDS).map(n => ({ n, sfx: String(n) }));
    if (p.layout === "neler-1") return wordCount(p.fields?.body) > LONG_WORDS ? [{ n: 1, sfx: "" }] : [];
    return [];
  }
  function renderTips() {
    const box = root.querySelector("#le-tips"), p = curPage();
    if (!box || !p) return;
    const list = ro ? [] : longItems(p);
    box.innerHTML = list.map(({ n, sfx }) => {
      const label = p.fields?.[`label${sfx}`] || `${n}. madde`;
      return `<div class="le-tip" role="status"><span class="le-tip-ico" aria-hidden="true">↗</span>
        <span><b>«${esc(label)}»</b> metni ${wordCount(p.fields[`body${sfx}`])} kelime. Bu madde tam sayfaya taşınsın mı?</span>
        <button type="button" class="btn sm" data-tip="${n}">Tam sayfaya taşı</button></div>`;
    }).join("");
  }
  function tipsClick(e) {
    const b = e.target.closest("[data-tip]");
    if (!b) return;
    const i = E.sel, p = curPage(), n = +b.dataset.tip, two = p.layout === "neler-2";
    const sfx = two ? String(n) : "";
    const label = p.fields[`label${sfx}`] || "", body = p.fields[`body${sfx}`] || "", photo = p.fields[`photo${sfx}`];
    const it = findItem(E.letter.folders, label);
    let photos = (it?.photos || []).slice(0, MAX_PHOTOS);
    if (photoUrl(photo) && !photos.some(r => photoUrl(r) === photoUrl(photo))) photos = [photo, ...photos].slice(0, MAX_PHOTOS);
    const full = { id: uid(), layout: "neler-tam", fields: { label, body, photos: clone(photos) } };
    const o = n === 1 ? "2" : "1";
    const other = two ? { label: p.fields[`label${o}`] || "", photo: p.fields[`photo${o}`] || "", body: p.fields[`body${o}`] || "" } : null;
    if (other && (other.label || photoUrl(other.photo) || other.body)) {
      E.letter.pages[i] = { id: p.id, layout: "neler-1", fields: other };
      E.letter.pages.splice(i + 1, 0, full);
      E.sel = i + 1;
    } else {
      E.letter.pages.splice(i, 1, full);
    }
    afterStructure();
    toast("Madde tam sayfaya taşındı.");
  }

  const getRef = (p, key, idx) => (idx != null && idx !== "" ? (Array.isArray(p.fields[key]) ? p.fields[key][+idx] : null) : p.fields[key]);

  function bindStage(canvas) {
    canvas.addEventListener("click", e => {
      if (dragMoved) { dragMoved = false; return; }
      const t = e.target.closest("[data-field]");
      if (!t) return;
      const key = t.dataset.field, idx = t.dataset.index ?? e.target.closest("[data-index]")?.dataset.index;
      if (!ro && t.classList.contains("lt-slot-empty")) return choosePhoto(key, t.dataset.index);
      focusControl(key, idx);
    });
    canvas.addEventListener("keydown", e => {
      const t = e.target.closest(".lt-slot-empty[data-field]");
      if (t && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); choosePhoto(t.dataset.field, t.dataset.index); }
    });
    if (ro) return;
    let over = null;
    const setOver = el => { if (over === el) return; over?.classList.remove("le-over"); over = el; el?.classList.add("le-over"); };
    canvas.addEventListener("dragover", e => {
      if (!hasFiles(e)) return;
      const t = e.target.closest(".lt-slot[data-field]");
      if (!t) return setOver(null);
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setOver(t);
    });
    canvas.addEventListener("dragleave", e => { if (over && !over.contains(e.relatedTarget)) setOver(null); });
    canvas.addEventListener("drop", e => {
      const t = e.target.closest(".lt-slot[data-field]");
      setOver(null);
      if (!t || !hasFiles(e)) return;
      e.preventDefault();
      placePhotos(curPage().id, t.dataset.field, t.dataset.index, [...e.dataTransfer.files]);
    });
    // Fotoğrafı sürükleyerek konumlandırma (pos 0–1).
    canvas.addEventListener("pointerdown", e => {
      if (e.button !== 0) return;
      const slot = e.target.closest(".lt-slot[data-field]"), img = slot?.querySelector("img.lt-img");
      if (!img) return;
      const p = curPage(), key = slot.dataset.field, idx = slot.dataset.index;
      const ref = getRef(p, key, idx);
      if (!ref || typeof ref !== "object") return;
      e.preventDefault();
      slot.setPointerCapture(e.pointerId);
      const r = slot.getBoundingClientRect();
      const nw = img.naturalWidth || 1, nh = img.naturalHeight || 1, z = Math.max(1, +ref.zoom || 1);
      const cover = Math.max(r.width / nw, r.height / nh);
      const ox = nw * cover * z - r.width, oy = nh * cover * z - r.height;
      const sx = e.clientX, sy = e.clientY, px = ref.pos?.x ?? 0.5, py = ref.pos?.y ?? 0.5;
      let moved = false;
      const move = ev => {
        const dx = ev.clientX - sx, dy = ev.clientY - sy;
        if (!moved && Math.hypot(dx, dy) < 4) return;
        moved = true;
        slot.classList.add("is-dragging");
        ref.pos = { x: ox > 1 ? clamp(px - dx / ox, 0, 1) : px, y: oy > 1 ? clamp(py - dy / oy, 0, 1) : py };
        const op = `${(ref.pos.x * 100).toFixed(1)}% ${(ref.pos.y * 100).toFixed(1)}%`;
        img.style.objectPosition = op;
        if (z > 1) img.style.transformOrigin = op;
      };
      const up = () => {
        slot.removeEventListener("pointermove", move);
        slot.removeEventListener("pointerup", up);
        slot.removeEventListener("pointercancel", up);
        slot.classList.remove("is-dragging");
        if (!moved) return;
        dragMoved = true;
        setTimeout(() => { dragMoved = false; }, 0);
        ref.pos = { x: Math.round(ref.pos.x * 1000) / 1000, y: Math.round(ref.pos.y * 1000) / 1000 };
        markDirty();
        scheduleAux();
      };
      slot.addEventListener("pointermove", move);
      slot.addEventListener("pointerup", up);
      slot.addEventListener("pointercancel", up);
    });
  }

  function focusControl(key, idx) {
    const form = root.querySelector("#le-form");
    const ctl = form?.querySelector(`[data-ctl="${CSS.escape(key)}"]`);
    if (!ctl) return;
    if (idx != null && fieldDef(curPage(), key)?.kind === "list") {
      if (key === "photos") { E.photoSel[curPage().id + key] = +idx; renderForm(); return focusControl(key); }
      const row = ctl.querySelector(`[data-row="${+idx}"] input`);
      if (row) { row.focus(); row.scrollIntoView({ block: "nearest" }); flash(ctl); return; }
    }
    ctl.scrollIntoView({ block: "nearest", behavior: "smooth" });
    (ctl.querySelector("textarea, input:not([type=range]), button") || ctl).focus({ preventScroll: true });
    flash(ctl);
  }
  const flash = el => { el.classList.remove("le-flash"); void el.offsetWidth; el.classList.add("le-flash"); };

  async function choosePhoto(key, idx) {
    const def = fieldDef(curPage(), key);
    if (!def) return;
    const files = await pickFiles(def.kind === "list");
    if (files.length) await placePhotos(curPage().id, key, idx, files);
  }

  async function placePhotos(pageId, key, idx, files) {
    const page = E.letter.pages.find(x => x.id === pageId);
    const def = page && fieldDef(page, key);
    if (!def) return;
    const isList = def.kind === "list";
    const cur = isList && Array.isArray(page.fields[key]) ? page.fields[key] : [];
    const at0 = idx == null || idx === "" ? cur.length : +idx;
    const room = isList ? Math.max(1, MAX_PHOTOS - at0) : 1;
    const zone = root.querySelector(`#le-form [data-ctl="${CSS.escape(key)}"]`);
    zone?.classList.add("is-busy");
    const refs = await uploadFiles(files, room);
    if (destroyed || !E) return;
    zone?.classList.remove("is-busy");
    const pg = E.letter.pages.find(x => x.id === pageId);
    if (!pg || !refs.length) return;
    if (isList) {
      const arr = [...(Array.isArray(pg.fields[key]) ? pg.fields[key] : [])];
      let at = Math.min(at0, arr.length);
      for (const r of refs) { arr[at] = r; at++; }
      pg.fields[key] = arr.filter(Boolean).slice(0, MAX_PHOTOS);
      E.photoSel[pg.id + key] = Math.min(at0, pg.fields[key].length - 1);
    } else pg.fields[key] = refs[0];
    markDirty();
    const i = E.letter.pages.indexOf(pg);
    E.over[i] = overflowOf([pg])[0];
    refreshThumb(i);
    if (pg === curPage()) { renderStage(); renderForm(); }
  }

  // Yazarken: önizleme hemen, küçük resim ve taşma denetimi biraz sonra.
  let stageRaf = 0;
  function refreshCurrent() {
    cancelAnimationFrame(stageRaf);
    stageRaf = requestAnimationFrame(renderStage);
    scheduleAux();
  }
  function scheduleAux() {
    clearTimeout(auxT);
    auxT = setTimeout(() => {
      if (!E || destroyed || !curPage()) return;
      E.over[E.sel] = overflowOf([curPage()])[0];
      refreshThumb(E.sel);
      // İçindekiler başka sayfalardan beslenir.
      E.letter.pages.forEach((p, i) => { if (p.layout === "icindekiler" && i !== E.sel) refreshThumb(i); });
      renderStageBar(); renderTips();
    }, 350);
  }

  // ---------- form
  function photoCtl(p, d) {
    const ref = p.fields[d.key], url = photoUrl(ref);
    const z = ref && typeof ref === "object" ? +ref.zoom || 1 : 1;
    return `<div class="le-field le-photo" data-ctl="${esc(d.key)}">
      <div class="le-field-h"><span class="le-lab">${esc(d.label)}</span></div>
      <div class="le-photo-box${url ? "" : " is-empty"}" data-drop-key="${esc(d.key)}">${url ? `<img src="${esc(url)}" alt="">` : `<span>${ro ? "Fotoğraf yok" : "Fotoğrafı buraya bırak"}</span>`}</div>
      ${ro ? "" : `<div class="le-photo-acts"><button type="button" class="btn ghost sm" data-ph="pick" data-key="${esc(d.key)}">${url ? "Değiştir" : "Fotoğraf seç"}</button><button type="button" class="btn ghost sm" data-ph="archive" data-key="${esc(d.key)}">Arşivden seç</button>
        ${url ? `<button type="button" class="btn ghost sm" data-ph="center" data-key="${esc(d.key)}">Ortala</button><button type="button" class="btn ghost sm" data-ph="clear" data-key="${esc(d.key)}">Kaldır</button>` : ""}</div>
      ${url ? `<label class="le-zoom">Yakınlık<input type="range" min="1" max="3" step="0.01" value="${z}" data-zoom="${esc(d.key)}"><output>${Math.round(z * 100)}%</output></label>
        <small class="le-hint">Konum için önizlemedeki fotoğrafı sürükle.</small>` : ""}`}
    </div>`;
  }
  function photoListCtl(p, d) {
    const arr = Array.isArray(p.fields[d.key]) ? p.fields[d.key] : [];
    const sk = p.id + d.key, sel = clamp(E.photoSel[sk] ?? 0, 0, Math.max(0, arr.length - 1));
    const cur = arr[sel], z = cur && typeof cur === "object" ? +cur.zoom || 1 : 1;
    return `<div class="le-field le-photo" data-ctl="${esc(d.key)}">
      <div class="le-field-h"><span class="le-lab">${esc(d.label)}</span><small class="le-wc">${arr.length} / ${MAX_PHOTOS}</small></div>
      <div class="le-phlist" data-drop-key="${esc(d.key)}">
        ${arr.map((r, i) => `<div class="le-phl${i === sel ? " is-sel" : ""}"><button type="button" class="le-phl-img" data-ph="sel" data-key="${esc(d.key)}" data-i="${i}" aria-pressed="${i === sel}" aria-label="${i + 1}. fotoğrafı seç"><img src="${esc(photoUrl(r))}" alt=""></button>
          ${ro ? "" : `<span class="le-phl-acts"><button type="button" class="le-ib" data-ph="left" data-key="${esc(d.key)}" data-i="${i}" aria-label="${i + 1}. fotoğrafı öne al"${i === 0 ? " disabled" : ""}>←</button><button type="button" class="le-ib" data-ph="right" data-key="${esc(d.key)}" data-i="${i}" aria-label="${i + 1}. fotoğrafı geri al"${i === arr.length - 1 ? " disabled" : ""}>→</button><button type="button" class="le-ib le-ib-del" data-ph="del" data-key="${esc(d.key)}" data-i="${i}" aria-label="${i + 1}. fotoğrafı kaldır">✕</button></span>`}</div>`).join("")}
        ${!ro && arr.length < MAX_PHOTOS ? `<button type="button" class="le-phl-add" data-ph="add" data-key="${esc(d.key)}"><span aria-hidden="true">＋</span>Ekle</button><button type="button" class="le-phl-add" data-ph="archive-add" data-key="${esc(d.key)}"><span aria-hidden="true">▦</span>Arşivden</button>` : ""}
        ${ro && !arr.length ? `<span class="muted">Fotoğraf yok</span>` : ""}
      </div>
      ${!ro && cur ? `<label class="le-zoom">${sel + 1}. fotoğraf yakınlığı<input type="range" min="1" max="3" step="0.01" value="${z}" data-zoom="${esc(d.key)}" data-i="${sel}"><output>${Math.round(z * 100)}%</output></label>` : ""}
    </div>`;
  }
  function fieldHtml(p, d) {
    const v = p.fields[d.key], id = `le-f-${d.key}`;
    if (d.kind === "photo") return photoCtl(p, d);
    if (d.kind === "list" && d.key === "photos") return photoListCtl(p, d);
    if (d.kind === "list") {
      const isRows = d.key === "rows";
      const toc = tocFromPages(E.letter.pages);
      return `<div class="le-field" data-ctl="${esc(d.key)}"><div class="le-field-h"><span class="le-lab">${esc(d.label)}</span></div>
        <div data-rows="${esc(d.key)}">${rowsHtml(v, isRows ? [["title", "Unvan"], ["name", "İsim"]] : [["", "Başlık"]], ro)}
        ${ro ? "" : `<div class="row"><button type="button" class="btn ghost sm" data-row-act="add">+ Satır ekle</button>${isRows ? `<button type="button" class="btn ghost sm" data-row-act="defaults">Varsayılan künye</button>` : toc.length ? `<button type="button" class="btn ghost sm" data-row-act="toc">Sayfalardan doldur</button>` : ""}</div>`}</div>
        ${!isRows && toc.length ? `<small class="le-hint">Boşken görünen: ${esc(toc.join(" · "))}</small>` : ""}</div>`;
    }
    const ai = d.ai && d.kind === "long" && !ro;
    const isLongNeler = d.kind === "long" && /^neler-[12]$/.test(p.layout);
    const control = d.kind === "long"
      ? `<textarea id="${id}" data-k="${esc(d.key)}" rows="${d.key.startsWith("body") ? 8 : 4}"${ro ? " disabled" : ""}>${esc(v ?? "")}</textarea>`
      : `<input type="text" id="${id}" data-k="${esc(d.key)}" value="${esc(v ?? "")}"${ro ? " disabled" : ""}>`;
    const n = wordCount(v);
    return `<div class="le-field" data-ctl="${esc(d.key)}"><div class="le-field-h"><label for="${id}">${esc(d.label)}</label>
        ${d.kind === "long" ? `<small class="le-wc${isLongNeler && n > LONG_WORDS ? " is-long" : ""}" data-wc>${n} kelime</small>` : ""}</div>
      ${control}
      ${ai ? `<button type="button" class="btn ghost sm le-ai" data-ai="${esc(d.key)}">✦ Yapay zekâ ile yaz</button>` : ""}</div>`;
  }
  function renderForm() {
    const form = root.querySelector("#le-form"), p = curPage();
    if (!form || !p) return;
    const lay = layoutOf(p), groups = [], loose = [];
    for (const d of lay.fields) {
      const m = GROUP_NAMES[p.layout] && /(\d)$/.exec(d.key);
      if (m) (groups[+m[1]] ||= []).push(d); else loose.push(d);
    }
    const scroll = form.scrollTop;
    form.innerHTML = `<div class="le-form-h"><h2>${esc(lay.label)}</h2><p>${esc(LAYOUT_HINT[p.layout] || "")}</p></div>
      <fieldset class="le-fields"${ro ? " disabled" : ""}><legend class="sr">${esc(lay.label)} alanları</legend>
        ${loose.map(d => fieldHtml(p, d)).join("")}
        ${groups.map((g, n) => (g ? `<section class="le-group"><h3>${n}. ${GROUP_NAMES[p.layout]}</h3>${g.map(d => fieldHtml(p, d)).join("")}</section>` : "")).join("")}
      </fieldset>`;
    form.scrollTop = scroll;
  }

  function bindForm(form) {
    form.addEventListener("input", e => {
      const t = e.target, p = curPage();
      if (!p || ro) return;
      if (t.dataset.k) {
        p.fields[t.dataset.k] = t.value;
        const wc = t.closest(".le-field")?.querySelector("[data-wc]");
        if (wc) { const n = wordCount(t.value); wc.textContent = `${n} kelime`; wc.classList.toggle("is-long", /^neler-[12]$/.test(p.layout) && n > LONG_WORDS); }
      } else if (t.dataset.rowK != null) {
        const key = t.closest("[data-rows]").dataset.rows, i = +t.closest("[data-row]").dataset.row;
        p.fields[key] = rowsInput(p.fields[key], i, t.dataset.rowK, t.value);
      } else if (t.dataset.zoom) {
        const ref = getRef(p, t.dataset.zoom, t.dataset.i);
        if (!ref || typeof ref !== "object") return;
        ref.zoom = clamp(+t.value || 1, 1, 3);
        const out = t.parentElement.querySelector("output");
        if (out) out.textContent = `${Math.round(ref.zoom * 100)}%`;
      } else return;
      markDirty();
      refreshCurrent();
    });
    form.addEventListener("click", async e => {
      const p = curPage();
      if (!p || ro) return;
      const rb = e.target.closest("[data-row-act]");
      if (rb) {
        const key = rb.closest("[data-rows]").dataset.rows, act = rb.dataset.rowAct;
        if (act === "defaults") {
          const cur = Array.isArray(p.fields.rows) ? p.fields.rows : [];
          if (cur.length && !(await confirmDlg({ title: "Varsayılan künye getirilsin mi?", body: "<p>Bu sayfadaki satırların yerine ayarlardaki Rotary yöneticileri ve kulüp yönetim kurulu gelir.</p>", ok: "Getir" }))) return;
          p.fields.rows = kunyeDefaults(E.refs);
        } else if (act === "toc") p.fields[key] = tocFromPages(E.letter.pages);
        else p.fields[key] = rowsAction(p.fields[key], act, +(rb.closest("[data-row]")?.dataset.row ?? -1), key === "rows" ? { title: "", name: "" } : "");
        markDirty(); renderForm(); refreshCurrent();
        if (act === "add") form.querySelector(`[data-rows="${CSS.escape(key)}"] .le-row:last-child input`)?.focus();
        return;
      }
      const ph = e.target.closest("[data-ph]");
      if (ph && !ph.disabled) {
        const key = ph.dataset.key, i = +ph.dataset.i, a = ph.dataset.ph, sk = p.id + key;
        const arr = Array.isArray(p.fields[key]) ? [...p.fields[key]] : null;
        if (a === "pick" || a === "add") return choosePhoto(key, a === "add" ? arr?.length ?? 0 : undefined);
        if (a === "archive" || a === "archive-add") {
          const at = a === "archive-add" ? arr?.length ?? 0 : undefined;
          return pickArchive(a === "archive-add" ? Math.max(1, MAX_PHOTOS - (arr?.length ?? 0)) : 1).then(files => files.length && placePhotos(p.id, key, at, files));
        }
        if (a === "sel") { E.photoSel[sk] = i; renderForm(); form.querySelector(`[data-ph="sel"][data-i="${i}"]`)?.focus(); return; }
        if (a === "clear") p.fields[key] = "";
        if (a === "center") { const r = p.fields[key]; if (r && typeof r === "object") { r.pos = { x: 0.5, y: 0.5 }; r.zoom = 1; } }
        if (a === "del" && arr) { arr.splice(i, 1); p.fields[key] = arr; E.photoSel[sk] = Math.max(0, i - 1); }
        if ((a === "left" || a === "right") && arr) {
          const j = i + (a === "left" ? -1 : 1);
          [arr[i], arr[j]] = [arr[j], arr[i]];
          p.fields[key] = arr; E.photoSel[sk] = j;
        }
        markDirty(); renderForm(); refreshCurrent();
        return;
      }
      const ai = e.target.closest("[data-ai]");
      if (ai) aiWrite(ai.dataset.ai, ai);
    });
    // Form fotoğraf kutularına da dosya bırakılabilir.
    let over = null;
    form.addEventListener("dragover", e => {
      if (ro || !hasFiles(e)) return;
      const z = e.target.closest("[data-drop-key]");
      if (over !== z) { over?.classList.remove("is-over"); over = z; z?.classList.add("is-over"); }
      if (!z) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    });
    form.addEventListener("dragleave", e => { if (over && !over.contains(e.relatedTarget)) { over.classList.remove("is-over"); over = null; } });
    form.addEventListener("drop", e => {
      const z = e.target.closest("[data-drop-key]");
      over?.classList.remove("is-over"); over = null;
      if (ro || !z || !hasFiles(e)) return;
      e.preventDefault();
      const key = z.dataset.dropKey, p = curPage();
      const isList = fieldDef(p, key)?.kind === "list";
      placePhotos(p.id, key, isList ? (Array.isArray(p.fields[key]) ? p.fields[key].length : 0) : undefined, [...e.dataTransfer.files]);
    });
  }

  // "✦ Yapay zekâ ile yaz": tek madde için letter-ai.
  async function aiWrite(key, btn) {
    const p = curPage(), pageId = p.id, sfx = key.replace(/^body/, "");
    const label = String(p.fields[`label${sfx}`] || "");
    const it = findItem(E.letter.folders, label);
    const item = it ? aiItem(it, E.refs.meetings) : guessItem(label);
    const cur = String(p.fields[key] || "").trim();
    item.notes = cur || item.notes || "";
    if (!item.notes.trim()) { toast("Önce kutuya birkaç not yaz; yapay zekâ notlardan metin kurar ve notta olmayanı eklemez.", "error"); return; }
    btn.disabled = true;
    btn.innerHTML = `<i class="le-spin" aria-hidden="true"></i>Yazılıyor…`;
    try {
      const res = await store.letterAi([item]);
      if (destroyed || !E) return;
      const text = res?.texts?.[0];
      const pg = E.letter.pages.find(x => x.id === pageId);
      if (pg && typeof text === "string" && text.trim()) {
        // Kutudaki metin birkaç kelimeden uzunsa (notlar ya da elle yazılmış metin) sormadan silinmesin.
        const before = String(pg.fields[key] || "");
        if (wordCount(before) > 5 && !(await confirmDlg({
          title: "Mevcut metin yapay zekânın metniyle değiştirilsin mi?",
          body: `<p class="muted">Şu anki metin (${wordCount(before)} kelime) silinir. Yeni metin:</p><blockquote class="le-ai-new">${esc(text.trim())}</blockquote>`,
          ok: "Değiştir", cancel: "Mevcut metni koru",
        }))) return;
        if (destroyed || !E) return;
        pg.fields[key] = text.trim();
        if (it) it.text = text.trim();
        markDirty();
        if (pg === curPage()) { renderForm(); refreshCurrent(); }
      }
      toast(res?.source === "sablon" ? (isDemo ? "Demo modunda yapay zekâ kapalı; notlardan şablon metin kullanıldı." : "Yapay zekâya ulaşılamadı; notlardan şablon metin kullanıldı.") : "Metin yazıldı. Okuyup düzeltebilirsin.");
    } catch (e) {
      if (!destroyed) toast(e.message || "Yapay zekâ yanıt vermedi.", "error");
    } finally {
      if (btn.isConnected) { btn.disabled = false; btn.textContent = "✦ Yapay zekâ ile yaz"; }
    }
  }

  // ---------- sayfa ekleme
  function defaultFields(layout) {
    const L = E.letter, f = L.folders || {};
    if (layout === "kapak") return { issue: `Sayı ${L.issue_no}`, period: L.period || "", title: "Başkan Mektubu", photo: "" };
    if (layout === "kunye") return { rows: clone(f.kunye?.rows?.length ? f.kunye.rows : kunyeDefaults(E.refs)) };
    if (layout === "icindekiler") return { items: [] };
    if (layout === "baskan") return { photo: "", body: "", name: f.president?.name || "", club: f.president?.club || CLUB, role: f.president?.role || "" };
    if (layout === "neler-tam" || layout === "serbest") return { photos: [] };
    return {};
  }
  async function addPage() {
    if (ro) return;
    const o = { logoUrl: LOGO, editable: true, letter: { period: E.letter.period, issue_no: E.letter.issue_no }, toc: tocFromPages(E.letter.pages), photoUrl };
    const at = E.letter.pages.length ? E.sel + 1 : 0;
    const layout = await dialog(`<form method="dialog" class="le-picker"><h2>Sayfa ekle</h2>
      <p class="muted">Bir düzen seç. ${E.letter.pages.length ? `Yeni sayfa ${at}. sayfadan sonra eklenir.` : "İlk sayfa olarak eklenir."}</p>
      <div class="le-layouts">${Object.entries(LAYOUTS).map(([k, l]) => `<button class="le-layout" value="${esc(k)}">
        <span class="le-mini" aria-hidden="true">${renderPage({ layout: k, fields: k === "kunye" ? { rows: Array.from({ length: 6 }, () => ({ title: "Unvan", name: "Rtc. İsim SOYAD" })) } : {} }, o)}</span><span>${esc(l.label)}</span></button>`).join("")}</div>
      <div class="row"><button class="btn ghost" value="">Vazgeç</button></div></form>`, { wide: true });
    if (!layout || !E || !Object.hasOwn(LAYOUTS, layout)) return;
    E.letter.pages.splice(at, 0, { id: uid(), layout, fields: defaultFields(layout) });
    E.sel = at;
    if (E.letter.pages.length === 1) { markDirty(); renderManual(); renderTop(); }
    else { afterStructure(); renderTop(); }
    root.querySelectorAll(".le-thumb")[E.sel]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  // ---------------------------------------------------------------- yazdırma (PDF)

  function waitImages(box, ms) {
    const imgs = [...box.querySelectorAll("img")].filter(i => !i.complete);
    const all = Promise.all(imgs.map(i => new Promise(r => { i.addEventListener("load", r, { once: true }); i.addEventListener("error", r, { once: true }); })));
    return Promise.race([all, new Promise(r => setTimeout(r, ms))]);
  }
  async function printPdf() {
    if (!E?.letter.pages.length) return;
    const ok = await dialog(`<form method="dialog"><h2>PDF indir</h2>
      <p>Tarayıcının yazdırma penceresi açılacak. Sayfalar keskin ve yazıları seçilebilir biçimde PDF olur.</p>
      <div class="le-print-tip"><b>Yazdırma penceresinde Hedef: PDF olarak kaydet seç.</b>
        <span>Kenar boşluğu “Yok”, “Arka plan grafikleri” açık olmalı (gerekirse “Diğer ayarlar” altında).</span></div>
      <div class="row"><button class="btn" value="ok">Yazdırma penceresini aç</button><button class="btn ghost" value="">Vazgeç</button></div></form>`);
    if (ok !== "ok" || !E) return;
    document.querySelector(".le-print")?.remove();
    const box = document.createElement("div");
    box.className = "le-print lt-pages";
    box.innerHTML = renderLetter(E.letter, { editable: false, photoUrl, logoUrl: LOGO });
    document.body.appendChild(box);
    document.body.classList.add("le-printing");
    const title = document.title;
    document.title = `Başkan Mektubu - Sayı ${E.letter.issue_no}${E.letter.period ? ` - ${E.letter.period}` : ""}`;
    const done = () => {
      box.remove();
      document.body.classList.remove("le-printing");
      document.title = title;
      window.removeEventListener("afterprint", done);
    };
    window.addEventListener("afterprint", done);
    cleanups.push(done);
    await waitImages(box, 8000);
    await document.fonts?.ready;
    window.print();
  }

  // ---------------------------------------------------------------- başlat / kapat

  if (letterId) openLetter(letterId); else showList();

  return {
    isDirty,
    destroy() {
      destroyed = true;
      clearTimeout(topT); clearTimeout(auxT); cancelAnimationFrame(stageRaf);
      E?.folders?.destroy();
      stageObs?.disconnect();
      cleanups.splice(0).forEach(fn => { try { fn(); } catch { /* yok say */ } });
      root.classList.remove("le-root", "le-ro");
      E = null;
    },
  };
}
