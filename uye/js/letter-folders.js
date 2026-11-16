// Başkan Mektubu: "Yapay zekâ ile oluştur" klasörleri.
// letter-editor.js bağlar: mountFolders(host, ctx). ctx; mektubu, klasörleri,
// fotoğraf yükleme, kişi seçici ve onay penceresini sağlar (bkz. editörde `ctx`).
// Ayrıca künye, isim/unvan biçimi ve madde eşleme gibi saf yardımcılar burada.

import { esc } from "../../assets/js/letter-render.js?v=202611161810";
import { defaultFolders, meetingLabel, missingFor, wordCount, assemblePages, LONG_WORDS } from "../../assets/js/letter-assemble.js?v=202611161810";

export const CLUB = "Ankara Anıttepe Rotaract Kulübü";
const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const MONTHS_LC = MONTHS.map(m => m.toLocaleLowerCase("tr"));
export const KIND = { toplanti: "Toplantı", proje: "Proje", etkinlik: "Etkinlik", ocakbasi: "Ocakbaşı" };
const KIND_CLS = { toplanti: "toplanti", proje: "hizmet", etkinlik: "etkinlik", ocakbasi: "ocakbasi" };
const AI_BATCH = 20; // letter-ai tek istekte en fazla 20 madde kabul eder (MAX_ITEMS)
const NEW_TITLE = { proje: "Yeni proje", etkinlik: "Yeni etkinlik", ocakbasi: "Ocakbaşı buluşması" };
const BOARD = [["baskan", "Dönem Başkanı", "Başkanı"], ["asbaskan", "Dönem Asbaşkanı", "Asbaşkanı"], ["sekreter", "Dönem Sekreteri", "Sekreteri"], ["sayman", "Dönem Saymanı", "Saymanı"]];

const uid = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
// Kayıtlı kimlikler HTML niteliklerine ve seçicilere girer: biçimi bozuksa yenisi verilir.
export const safeId = id => (typeof id === "string" && /^[\w-]+$/.test(id) ? id : uid());
const str = v =>(v == null ? "" : String(v));
const blank = v => str(v).trim() === "";
export const norm = s => str(s).trim().replace(/\s+/g, " ").toLocaleLowerCase("tr");
const pad = n => String(n).padStart(2, "0");
const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// ---------------------------------------------------------------- saf yardımcılar

// "Simay Oğuzkurt" → "Rtc. Simay OĞUZKURT" (örnek mektuptaki gibi soyadı büyük harf).
export function rtcName(full, rtc = true) {
  const w = str(full).replace(/\s*\([^)]*\)\s*/g, " ").trim().split(/\s+/).filter(Boolean);
  if (!w.length) return "";
  const last = w.length > 1 ? w.pop().toLocaleUpperCase("tr") : w.pop();
  const name = [...w, last].join(" ");
  return rtc ? `Rtc. ${name}` : name;
}

// "2026-27" → "2026-2027"
export function termLong(term) {
  const n = str(term?.name);
  const m = /^(\d{4})\s*[-–]\s*(\d{2})$/.exec(n);
  return m ? `${m[1]}-${m[1].slice(0, 2)}${m[2]}` : n;
}

// İmzadaki unvan satırı: "2026-2027 Dönem Başkanı" gibi.
export function roleFor(m, term) {
  const pre = termLong(term) ? `${termLong(term)} Dönem ` : "Dönem ";
  const b = BOARD.find(([r]) => (m?.roles || []).includes(r));
  if (b) return pre + b[2];
  const t = str(m?.title).trim();
  if (!t || t === "Üye") return "Kulüp Üyesi";
  if (/^geçmiş dönem/i.test(norm(t))) return t;
  return pre + t;
}

// Ayardaki künye (Rotary yöneticileri): JSON metni ya da dizi; bozuksa boş.
export function parseKunye(v) {
  try {
    const a = typeof v === "string" ? JSON.parse(v) : v;
    return Array.isArray(a) ? a.filter(r => r && typeof r === "object").map(r => ({ title: str(r.title), name: str(r.name) })) : [];
  } catch { return []; }
}

// Kulüp yönetim kurulu: başkan, asbaşkan, sekreter, sayman ve "Yönetim Kurulu Üyesi" unvanlılar.
export function boardRows(members) {
  const act = (members || []).filter(m => m && m.status === "active");
  const rows = [], seen = new Set();
  const add = (title, m) => { const k = title + "|" + m.id; if (seen.has(k)) return; seen.add(k); rows.push({ title, name: rtcName(m.full_name) }); };
  for (const [r, title] of BOARD) act.filter(m => (m.roles || []).includes(r)).forEach(m => add(title, m));
  act.filter(m => norm(m.title).includes("yönetim kurulu üyesi")).forEach(m => add("Yönetim Kurulu Üyesi", m));
  return rows;
}
export const kunyeDefaults = refs => [...(refs.kunye || []), ...boardRows(refs.members)].map(r => ({ ...r }));

// "Eylül - Ekim 2026" → { from: "2026-09-01", to: "2026-10-31" }; anlaşılmazsa null.
export function periodRange(text) {
  const words = str(text).toLocaleLowerCase("tr").split(/[^a-zçğıöşüâî]+/);
  const found = words.map(w => MONTHS_LC.indexOf(w)).filter(i => i >= 0);
  if (!found.length) return null;
  const years = (str(text).match(/\d{4}/g) || []).map(Number);
  const m1 = found[0], m2 = found[found.length - 1];
  const y2 = years.length ? years[years.length - 1] : new Date().getFullYear();
  const y1 = years.length > 1 ? years[0] : m1 > m2 ? y2 - 1 : y2;
  return { from: isoDate(new Date(y1, m1, 1)), to: isoDate(new Date(y2, m2 + 1, 0)) };
}
function recentRange() {
  const d = new Date();
  return { from: isoDate(new Date(d.getFullYear(), d.getMonth() - 1, 1)), to: isoDate(new Date(d.getFullYear(), d.getMonth() + 1, 0)) };
}
// Yeni sayı için dönem yazısı önerisi: bu ay ve sonraki ay.
export function suggestPeriod(d = new Date()) {
  const a = new Date(d.getFullYear(), d.getMonth(), 1), b = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return a.getFullYear() === b.getFullYear()
    ? `${MONTHS[a.getMonth()]} - ${MONTHS[b.getMonth()]} ${b.getFullYear()}`
    : `${MONTHS[a.getMonth()]} ${a.getFullYear()} - ${MONTHS[b.getMonth()]} ${b.getFullYear()}`;
}

const meetingOf = (it, meetings) => (meetings || []).find(m => (it.meeting_id && m.id === it.meeting_id) || (!it.meeting_id && (meetingLabel(m) === it.title || meetingLabel(m) === it.label)));
const touched = it => (it.photos && it.photos.length) || !blank(it.notes) || !blank(it.text);

// Tarihi olanlar tarih sırasıyla; tarihsizler eklendikleri sırayla sonda.
function sortItems(items) {
  const k = it => it.date || "9999-99-99";
  items.splice(0, items.length, ...items.map((it, i) => [it, i]).sort((a, b) => (k(a[0]) < k(b[0]) ? -1 : k(a[0]) > k(b[0]) ? 1 : a[1] - b[1])).map(x => x[0]));
}

// Tarih aralığı değişince toplantı maddeleri: aralığa yeni girenler eklenir,
// dokunulmuşlar (fotoğraf, not, metin) kalır, dokunulmamış aralık dışılar çıkar.
export function syncMeetings(f, meetings) {
  const inRange = (meetings || []).filter(m => m && m.date >= f.from && m.date <= f.to);
  f.items = f.items.filter(it => {
    if (it.kind !== "toplanti") return true;
    const m = meetingOf(it, meetings);
    return (m && inRange.includes(m)) || touched(it);
  });
  for (const m of inRange) {
    if (f.items.some(it => it.kind === "toplanti" && meetingOf(it, meetings) === m)) continue;
    f.items.push({ id: uid(), kind: "toplanti", meeting_id: m.id, title: meetingLabel(m), label: meetingLabel(m), date: m.date, photos: [], star: null, notes: "", text: "" });
  }
  sortItems(f.items);
}

// Mektubun klasörleri: kayıtlı ve geçerliyse onu tamamlar, yoksa varsayılanı kurar.
export function ensureFolders(letter, refs) {
  const f = letter.folders;
  if (f && typeof f === "object" && !Array.isArray(f) && f.cover) {
    f.kunye ||= { rows: [] };
    f.president ||= { photo: null, body: "", name: "", role: "", club: CLUB };
    for (const k of ["board", "corner", "items"]) if (!Array.isArray(f[k])) f[k] = [];
    for (const k of ["board", "corner"]) f[k].forEach(p => { p.id = safeId(p.id); });
    f.items.forEach(it => { it.id = safeId(it.id); if (!Array.isArray(it.photos)) it.photos = []; });
    if (!f.from || !f.to) Object.assign(f, periodRange(letter.period) || recentRange());
    return f;
  }
  const { from, to } = periodRange(letter.period) || recentRange();
  const nf = defaultFolders({ issue_no: letter.issue_no, period: letter.period, from, to, meetings: refs.meetings, kunye: refs.kunye, board: boardRows(refs.members) });
  nf.from = from; nf.to = to;
  nf.items.forEach(it => { const m = meetingOf(it, refs.meetings); if (m) it.meeting_id = m.id; });
  const pres = (refs.members || []).find(m => m.status === "active" && (m.roles || []).includes("baskan"));
  nf.president.club = CLUB;
  if (pres) Object.assign(nf.president, { name: rtcName(pres.full_name), role: roleFor(pres, refs.term), member_id: pres.id });
  return nf;
}

// letter-ai fonksiyonuna giden madde.
export function aiItem(it, meetings) {
  const o = { kind: it.kind || "etkinlik", title: str(it.title), label: str(it.label || it.title), date: str(it.date), notes: str(it.notes) };
  if (o.kind === "toplanti") {
    const m = meetingOf(it, meetings);
    if (m) { o.club_no = m.club_no; o.term_no = m.term_no; }
  }
  if (o.kind === "ocakbasi" && !blank(it.host)) o.host = str(it.host);
  return o;
}

// Elle düzenleyicideki bir etiketi klasördeki maddeye eşler.
export function findItem(folders, label) {
  const k = norm(label);
  if (!k) return null;
  return (folders?.items || []).find(it => norm(it.label || it.title) === k || norm(it.title) === k) || null;
}

// Klasörde karşılığı yoksa etiketten tahmin: "603 / 4. Toplantımız" → toplantı.
export function guessItem(label) {
  const s = str(label).trim();
  const m = /^(\d+)\s*\/\s*(\d+)\./.exec(s);
  if (m) return { kind: "toplanti", title: s, label: s, date: "", club_no: +m[1], term_no: +m[2], notes: "" };
  const kind = /ocakba/i.test(s) ? "ocakbasi" : /proje/i.test(s) ? "proje" : "etkinlik";
  return { kind, title: s, label: s, date: "", notes: "" };
}

// Satır listesi düzenleyicisi (künye satırları, içindekiler başlıkları).
// cols: [["title","Unvan"],["name","İsim"]] ya da metin satırları için [["","Başlık"]].
export function rowsHtml(rows, cols, ro) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return `<p class="le-rows-empty">Henüz satır yok.</p>`;
  return `<ol class="le-rows">${list.map((r, i) => `<li class="le-row" data-row="${i}"><span class="le-row-no" aria-hidden="true">${i + 1}</span><span class="le-row-in">${cols.map(([k, lab]) => {
    const v = k ? r?.[k] : typeof r === "string" ? r : r?.title;
    return `<input type="text" data-row-k="${k}" value="${esc(v ?? "")}" placeholder="${esc(lab)}" aria-label="${i + 1}. satır: ${esc(lab)}"${ro ? " disabled" : ""}>`;
  }).join("")}</span>${ro ? "" : `<span class="le-row-acts"><button type="button" class="le-ib" data-row-act="up" aria-label="${i + 1}. satırı yukarı taşı"${i === 0 ? " disabled" : ""}>↑</button><button type="button" class="le-ib" data-row-act="down" aria-label="${i + 1}. satırı aşağı taşı"${i === list.length - 1 ? " disabled" : ""}>↓</button><button type="button" class="le-ib le-ib-del" data-row-act="del" aria-label="${i + 1}. satırı sil">✕</button></span>`}</li>`).join("")}</ol>`;
}
export function rowsAction(rows, act, i, empty) {
  const a = [...(Array.isArray(rows) ? rows : [])];
  if (act === "add") a.push(empty);
  else if (act === "del") a.splice(i, 1);
  else if (act === "up" && i > 0) [a[i - 1], a[i]] = [a[i], a[i - 1]];
  else if (act === "down" && i < a.length - 1) [a[i + 1], a[i]] = [a[i], a[i + 1]];
  return a;
}
export function rowsInput(rows, i, k, v) {
  const a = [...(Array.isArray(rows) ? rows : [])];
  a[i] = k ? { ...(a[i] && typeof a[i] === "object" ? a[i] : {}), [k]: v } : v;
  return a;
}

const isStar = (r, star) => star != null && r != null && (r === star || (r.path != null && r.path === star) || (star.path != null && r.path === star.path));
const hasFiles = e => [...(e.dataTransfer?.types || [])].includes("Files");

// ---------------------------------------------------------------- klasör ekranı

export function mountFolders(host, ctx) {
  const ro = ctx.ro;
  const open = ctx.openFolders || (ctx.openFolders = new Set(["cover"]));
  const wrap = document.createElement("div");
  wrap.className = "lf";
  host.replaceChildren(wrap);
  let genBusy = false, gone = false;

  const F = () => ctx.folders;
  const members = () => ctx.refs.members || [];
  const memberOf = p => (p?.member_id ? members().find(m => m.id === p.member_id) : null);

  // "cover", "president", "board:<id>", "corner:<id>", "item:<id>"
  function holder(h) {
    const f = F();
    if (h === "cover" || h === "president") return f[h];
    const [k, id] = h.split(":");
    const list = k === "item" ? f.items : f[k];
    return Array.isArray(list) ? list.find(x => x.id === id) || null : null;
  }

  // ---------- parçalar
  const badge = (cls, text) => `<span class="lf-badge ${cls}">${cls === "ok" ? "✓ " : ""}${esc(text)}</span>`;
  function badges() {
    const f = F(), miss = missingFor(f);
    const itemMiss = miss.filter(m => !m.startsWith("Başkan Mektubu")).length;
    return {
      cover: !blank(f.cover.period) && !blank(f.cover.issue) ? badge("ok", "Hazır") : badge("warn", "Sayı ya da dönem eksik"),
      president: !blank(f.president.body) ? badge("ok", "Hazır") : badge("warn", "Metin eksik"),
      board: f.board.length ? badge("info", `${f.board.length} mesaj`) : badge("", "İsteğe bağlı"),
      corner: f.corner.length ? badge("info", `${f.corner.length} yazı`) : badge("", "İsteğe bağlı"),
      items: !f.items.length ? badge("warn", "Madde yok") : itemMiss ? badge("warn", `${itemMiss} eksik`) : badge("ok", `${f.items.length} madde hazır`),
    };
  }
  function updateBadges() {
    const b = badges();
    for (const [k, v] of Object.entries(b)) { const el = wrap.querySelector(`[data-badge="${k}"]`); if (el) el.innerHTML = v; }
    for (const it of F().items) { const el = wrap.querySelector(`[data-ib="${CSS.escape(it.id)}"]`); if (el) el.outerHTML = itemBadge(it); }
    const sum = wrap.querySelector("#lf-go-sum");
    if (sum) {
      const miss = missingFor(F()).length, n = F().items.length;
      sum.textContent = `${n} madde · ${miss ? `${miss} eksik` : "eksik yok"}`;
    }
  }
  const itemMissing = it => [...(it.photos?.length ? [] : ["Fotoğraf yok"]), ...(blank(it.notes) && blank(it.text) ? ["Açıklama yok"] : [])];
  const itemBadge = it => { const m = itemMissing(it); return `<span class="lf-badge ${m.length ? "warn" : "ok"}" data-ib="${esc(it.id)}">${m.length ? esc(m.join(" · ")) : "✓ Hazır"}</span>`; };
  const wc = (v, long = Infinity) => { const n = wordCount(v); return `<small class="le-wc${n > long ? " is-long" : ""}" data-wc>${n} kelime</small>`; };

  const avatar = (name, url) => `<span class="lf-av">${url ? `<img src="${esc(url)}" alt="">` : esc(str(name).replace(/^Rtc\.\s*/, "").split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join("").toLocaleUpperCase("tr") || "?")}</span>`;

  function photoOne(h, { avatarFor = null, label = "Fotoğraf" } = {}) {
    const ref = holder(h)?.photo, url = ctx.photoUrl(ref);
    const av = !ro && !url && avatarFor?.photo_url ? `<button type="button" class="btn ghost sm" data-a="avatar" data-h="${esc(h)}">Profil fotoğrafını kullan</button>` : "";
    return `<div class="lf-one${url ? " has" : ""}" data-drop="${esc(h)}">
      ${url ? `<img src="${esc(url)}" alt="${esc(label)}">` : `<span class="lf-one-ph" aria-hidden="true">＋</span>`}
      <div class="lf-one-txt">${url ? `<b>${esc(label)} eklendi</b><small>Konumu ve yakınlığı elle düzenleyicide ayarlanır.</small>` : `<b>${esc(label)} yok</b><small>${ro ? "" : "Sürükleyip bırak ya da seç."}</small>`}</div>
      ${ro ? "" : `<div class="lf-one-acts"><button type="button" class="btn ghost sm" data-a="pick" data-h="${esc(h)}">${url ? "Değiştir" : "Fotoğraf seç"}</button>${url ? `<button type="button" class="btn ghost sm" data-a="unphoto" data-h="${esc(h)}">Kaldır</button>` : ""}${av}</div>`}
    </div>`;
  }

  function photosMany(it) {
    const h = `item:${it.id}`, photos = it.photos || [];
    const hasStar = photos.some(r => isStar(r, it.star));
    return `<div class="lf-photos" data-drop="${esc(h)}" data-multi>
      ${photos.map((r, i) => {
        const on = isStar(r, it.star), auto = !hasStar && i === 0;
        return `<figure class="lf-ph${on ? " is-star" : auto ? " is-auto" : ""}"><img src="${esc(ctx.photoUrl(r))}" alt="${i + 1}. fotoğraf">
          <button type="button" class="lf-star" data-a="star" data-h="${esc(h)}" data-i="${i}" aria-pressed="${on}" aria-label="${i + 1}. fotoğrafı sayfada kullan" title="${on ? "Sayfada bu fotoğraf kullanılacak" : auto ? "Seçim yok: ilk fotoğraf kullanılır" : "Sayfada bunu kullan"}"${ro ? " disabled" : ""}>★</button>
          ${ro ? "" : `<button type="button" class="lf-del" data-a="del-photo" data-h="${esc(h)}" data-i="${i}" aria-label="${i + 1}. fotoğrafı kaldır">✕</button>`}</figure>`;
      }).join("")}
      ${ro ? (photos.length ? "" : `<p class="lf-hint">Fotoğraf yok.</p>`) : `<button type="button" class="lf-add" data-a="pick-multi" data-h="${esc(h)}"><span aria-hidden="true">＋</span>Fotoğraf ekle<small>ya da sürükle</small></button>`}
    </div>`;
  }

  // ---------- klasörler
  function coverBody() {
    const f = F(), c = f.cover;
    return `<div class="grid g2">
        <label class="f">Sayı numarası<input type="number" min="1" step="1" inputmode="numeric" data-h="cover" data-f="issue" value="${esc(c.issue ?? "")}"></label>
        <label class="f">Dönem yazısı <small>Kapakta görünür, ör. "Eylül - Ekim 2026"</small><input type="text" data-h="cover" data-f="period" value="${esc(c.period)}" placeholder="Eylül - Ekim 2026"></label>
        <label class="f">Başlangıç tarihi<input type="date" data-range="from" value="${esc(f.from)}"></label>
        <label class="f">Bitiş tarihi<input type="date" data-range="to" value="${esc(f.to)}"></label>
      </div>
      <p class="lf-hint">Bu aralıktaki toplantılar <b>Neler Yaptık?</b> klasörüne kendiliğinden gelir. Dönem yazısını değiştirince tarihler de ona göre ayarlanır.</p>
      <div class="lf-sub"><h3>Kapak fotoğrafı <small>isteğe bağlı</small></h3>${photoOne("cover", { label: "Kapak fotoğrafı" })}</div>
      <div class="lf-sub"><h3>Künye</h3><p class="lf-hint">Rotary yöneticileri ve kulüp yönetim kurulu. Liste hazır gelir; satırları düzenleyebilir, sıralayabilirsin.</p>
        <div data-rows="kunye">${rowsHtml(f.kunye.rows, [["title", "Unvan"], ["name", "İsim"]], ro)}
        ${ro ? "" : `<div class="row"><button type="button" class="btn ghost sm" data-row-act="add">+ Satır ekle</button><button type="button" class="btn ghost sm" data-row-act="defaults">Varsayılan listeyi getir</button></div>`}</div>
      </div>`;
  }

  function presidentBody() {
    const p = F().president, m = memberOf(p);
    return `<div class="lf-who">${avatar(p.name, m?.photo_url)}<div><b>${esc(p.name || "Kişi seçilmedi")}</b><small>Mektubu yazan</small></div>
        ${ro ? "" : `<button type="button" class="btn ghost sm" data-a="pick-president">Kişiyi değiştir</button>`}</div>
      <div class="le-field"><div class="le-field-h"><label for="lf-pres-body">Mektup</label>${wc(p.body)}</div>
        <textarea id="lf-pres-body" rows="12" data-h="president" data-f="body" placeholder="Kıymetli Rotaract Ailem, …">${esc(p.body)}</textarea>
        <small class="lf-hint">Başkanın kendi yazısı; bu bölümde yapay zekâ kullanılmaz. Boş satır yeni paragraf açar.</small></div>
      <div class="lf-sub"><h3>Portre</h3>${photoOne("president", { avatarFor: m, label: "Portre" })}</div>
      <div class="lf-sub"><h3>İmza</h3><div class="grid g3">
        <label class="f">İsim<input type="text" data-h="president" data-f="name" value="${esc(p.name)}"></label>
        <label class="f">Kulüp<input type="text" data-h="president" data-f="club" value="${esc(p.club ?? CLUB)}"></label>
        <label class="f">Unvan<input type="text" data-h="president" data-f="role" value="${esc(p.role)}"></label>
      </div></div>`;
  }

  function peopleBody(kind) {
    const list = F()[kind], isBoard = kind === "board";
    const cards = list.map((p, i) => {
      const h = `${kind}:${p.id}`, m = memberOf(p);
      return `<article class="lf-card" data-card="${esc(h)}">
        <header class="lf-who">${avatar(p.name, m?.photo_url)}<div><b>${esc(p.name || "İsimsiz")}</b><small>${p.guest ? "Misafir" : "Üye"}</small></div>
          ${ro ? "" : `<span class="lf-card-acts"><button type="button" class="le-ib" data-a="move" data-d="-1" data-h="${esc(h)}" aria-label="Yukarı taşı"${i === 0 ? " disabled" : ""}>↑</button><button type="button" class="le-ib" data-a="move" data-d="1" data-h="${esc(h)}" aria-label="Aşağı taşı"${i === list.length - 1 ? " disabled" : ""}>↓</button><button type="button" class="le-ib le-ib-del" data-a="del-person" data-h="${esc(h)}" aria-label="${esc(p.name || "Kişiyi")} kaldır">✕</button></span>`}
        </header>
        <div class="grid g2">
          <label class="f">İmzadaki isim<input type="text" data-h="${esc(h)}" data-f="name" value="${esc(p.name)}"></label>
          <label class="f">Unvan satırı<input type="text" data-h="${esc(h)}" data-f="role" value="${esc(p.role)}"></label>
        </div>
        <div class="le-field"><div class="le-field-h"><label for="lf-b-${esc(p.id)}">${isBoard ? "Mesaj" : "Yazı"}</label>${wc(p.body)}</div>
          <textarea id="lf-b-${esc(p.id)}" rows="7" data-h="${esc(h)}" data-f="body">${esc(p.body)}</textarea>
          <small class="lf-hint">Kişinin kendi metni; yapay zekâ kullanılmaz.</small></div>
        <div class="lf-sub"><h3>${isBoard ? `Görsel <small>isteğe bağlı; tek kalan mesajın yanında büyük görünür</small>` : `Fotoğraf <small>yuvarlak çerçevede görünür</small>`}</h3>${photoOne(h, { avatarFor: m, label: isBoard ? "Görsel" : "Fotoğraf" })}</div>
      </article>`;
    }).join("");
    return `${cards || `<p class="lf-empty">${isBoard ? "Henüz mesaj yok." : "Henüz yazı yok."}</p>`}
      ${ro ? "" : `<div class="row"><button type="button" class="btn ghost sm" data-a="add-person" data-k="${kind}">+ Kişi ekle</button></div>`}
      <p class="lf-hint">${isBoard ? "Mesajlar ikişer ikişer bir sayfaya yerleşir; tek kalan mesaj görselli sayfaya geçer." : "Yazılar ikişer ikişer, iki sütunlu sayfaya yerleşir. Misafirler de seçilebilir."}</p>`;
  }

  function itemCard(it) {
    const h = `item:${it.id}`;
    return `<article class="lf-item t-${KIND_CLS[it.kind] || "diger"}" data-card="${esc(h)}">
      <header class="lf-item-h">
        <span class="tag t-${KIND_CLS[it.kind] || "diger"}">${esc(KIND[it.kind] || "Madde")}</span>
        <input class="lf-title" type="text" data-h="${esc(h)}" data-f="title" value="${esc(it.title)}" aria-label="Klasör adı (${esc(KIND[it.kind] || "madde")})"${ro ? " disabled" : ""}>
        ${itemBadge(it)}
        ${ro ? "" : `<button type="button" class="le-ib le-ib-del" data-a="del-item" data-h="${esc(h)}" aria-label="${esc(it.title)} klasörünü sil">✕</button>`}
      </header>
      <div class="grid g2">
        <label class="f">Fotoğraf altı etiketi <small>Boşsa klasör adı yazar</small><input type="text" data-h="${esc(h)}" data-f="label" value="${esc(it.label)}" placeholder="${esc(it.title)}"></label>
        <label class="f">Tarih<input type="date" data-h="${esc(h)}" data-f="date" value="${esc(it.date)}"></label>
      </div>
      ${it.kind === "ocakbasi" ? `<div class="lf-host"><span>Ev sahibi</span><b>${esc(it.host || "Seçilmedi")}</b>${ro ? "" : `<button type="button" class="btn ghost sm" data-a="pick-host" data-h="${esc(h)}">${it.host ? "Değiştir" : "Seç"}</button>${it.host ? `<button type="button" class="btn ghost sm" data-a="clear-host" data-h="${esc(h)}">Kaldır</button>` : ""}`}</div>` : ""}
      ${photosMany(it)}
      <div class="le-field"><div class="le-field-h"><label for="lf-n-${esc(it.id)}">Notlar</label>${wc(it.notes)}</div>
        <textarea id="lf-n-${esc(it.id)}" rows="4" data-h="${esc(h)}" data-f="notes" placeholder="Ne yaptık, kimler vardı, öne çıkan an… Yapay zekâ yalnızca bu notları kullanır.">${esc(it.notes)}</textarea></div>
      ${blank(it.text) ? "" : `<details class="lf-ai-text"><summary>✦ Yapay zekâ metni · ${wordCount(it.text)} kelime${wordCount(it.text) > LONG_WORDS ? " · tam sayfa olur" : ""}</summary><p>${esc(it.text)}</p></details>`}
    </article>`;
  }

  function itemsBody() {
    const items = F().items;
    return `<p class="lf-hint">★ ile seçilen fotoğraf sayfada kullanılır; seçim yoksa ilki. ${LONG_WORDS} kelimeyi aşan maddeler tam sayfa olur ve 4 fotoğrafa kadar kolaj kullanır.</p>
      <div class="lf-items">${items.map(itemCard).join("") || `<p class="lf-empty">Bu tarih aralığında toplantı yok. Aşağıdan proje, etkinlik ya da ocakbaşı ekleyebilirsin.</p>`}</div>
      ${ro ? "" : `<div class="row lf-adds"><button type="button" class="btn ghost sm" data-a="add-item" data-k="proje">+ Proje ekle</button><button type="button" class="btn ghost sm" data-a="add-item" data-k="etkinlik">+ Etkinlik ekle</button><button type="button" class="btn ghost sm" data-a="add-item" data-k="ocakbasi">+ Ocakbaşı ekle</button></div>`}`;
  }

  const FOLDERS = [
    ["cover", "Kapak ve Künye", "Sayı, dönem, kapak fotoğrafı ve künye listesi", coverBody],
    ["president", "Başkan Mektubu", "Başkanın kendi yazısı, portresi ve imzası", presidentBody],
    ["board", "Yönetim Kurulu Mesajları", "Yönetim kurulundan kişisel mesajlar", () => peopleBody("board")],
    ["corner", "Anıttepeliler Köşesi", "Üyelerden ve misafirlerden yazılar", () => peopleBody("corner")],
    ["items", "Neler Yaptık?", "Toplantılar, projeler, etkinlikler ve ocakbaşları", itemsBody],
  ];

  function render() {
    if (gone) return;
    const b = badges();
    wrap.innerHTML = `<div class="lf-intro"><b>Klasörleri doldur, sayfalar kendiliğinden kurulsun.</b>
        <span>✦ <b>Yapay zekâ ile oluştur</b> dediğinde sayfalar örnek mektubun düzeninde hazırlanır ve elle düzenleyicide açılır. Yapay zekâ yalnızca <b>Neler Yaptık?</b> metinlerini yazar; kişisel yazılara dokunmaz.</span></div>
      <fieldset class="lf-set"${ro ? " disabled" : ""}><legend class="sr">Mektup klasörleri</legend>${FOLDERS.map(([id, title, sub, body], i) => `<details class="lf-folder" data-folder="${id}"${open.has(id) ? " open" : ""}>
        <summary><span class="lf-num" aria-hidden="true">${i + 1}</span><span class="lf-h"><b>${title}</b><small>${sub}</small></span><span data-badge="${id}">${b[id]}</span><span class="lf-chev" aria-hidden="true"></span></summary>
        <div class="lf-body">${body()}</div></details>`).join("")}</fieldset>
      ${ro ? "" : `<div class="lf-go"><div class="lf-go-t"><b>Hazır olunca</b><span id="lf-go-sum"></span></div><button type="button" class="btn lf-gen" data-a="generate"${genBusy ? " disabled aria-busy=\"true\"" : ""}>${genBusy ? `<i class="le-spin" aria-hidden="true"></i>Yazılıyor…` : "✦ Yapay zekâ ile oluştur"}</button></div>`}`;
    updateBadges();
  }

  function refreshZone(h) {
    const z = wrap.querySelector(`[data-drop="${CSS.escape(h)}"]`);
    if (!z) return render();
    const it = h.startsWith("item:") ? holder(h) : null;
    if (it) z.outerHTML = photosMany(it);
    else {
      const p = holder(h);
      const isBoard = h.startsWith("board:");
      z.outerHTML = photoOne(h, { avatarFor: memberOf(p), label: h === "cover" ? "Kapak fotoğrafı" : h === "president" ? "Portre" : isBoard ? "Görsel" : "Fotoğraf" });
    }
    updateBadges();
  }

  const changed = () => { ctx.markDirty(); updateBadges(); };

  // ---------- fotoğraflar
  async function addPhotos(h, files) {
    const multi = h.startsWith("item:");
    const zone = wrap.querySelector(`[data-drop="${CSS.escape(h)}"]`);
    zone?.classList.add("is-busy"); zone?.setAttribute("aria-busy", "true");
    const refs = await ctx.uploadFiles(files, multi ? Infinity : 1);
    if (gone) return;
    const x = holder(h);
    if (x && refs.length) {
      if (multi) x.photos = [...(x.photos || []), ...refs];
      else x.photo = refs[0];
      ctx.markDirty();
    }
    refreshZone(h);
  }
  async function useAvatar(h, m) {
    if (!m?.photo_url) return;
    const zone = wrap.querySelector(`[data-drop="${CSS.escape(h)}"]`);
    zone?.classList.add("is-busy");
    try {
      const ref = await ctx.copyAvatar(m.photo_url);
      if (gone) return;
      const x = holder(h);
      if (x && !ctx.photoUrl(x.photo)) { x.photo = ref; ctx.markDirty(); }
    } catch (e) { ctx.toast(e.message || "Profil fotoğrafı alınamadı.", "error"); }
    if (!gone) refreshZone(h);
  }

  // ---------- olaylar
  wrap.addEventListener("toggle", e => {
    const d = e.target.closest?.("[data-folder]");
    if (d) d.open ? open.add(d.dataset.folder) : open.delete(d.dataset.folder);
  }, true);

  wrap.addEventListener("input", e => {
    if (ro) return;
    const t = e.target;
    const rowsBox = t.closest("[data-rows]");
    if (rowsBox && t.dataset.rowK != null) {
      const i = +t.closest("[data-row]").dataset.row;
      F().kunye.rows = rowsInput(F().kunye.rows, i, t.dataset.rowK, t.value);
      return changed();
    }
    const h = t.dataset.h, k = t.dataset.f;
    if (!h || !k) return;
    const x = holder(h);
    if (!x) return;
    let v = t.value;
    if (h === "cover" && k === "issue") {
      v = v === "" ? "" : Math.max(1, Math.round(+v) || 1);
      if (v !== "") ctx.letter.issue_no = v;
      ctx.syncHeader();
    }
    if (h === "cover" && k === "period") { ctx.letter.period = v; ctx.syncHeader(); }
    if (k === "title" && h.startsWith("item:")) {
      // Etiket klasör adıyla aynıysa birlikte değişsin.
      if (blank(x.label) || x.label === x.title) {
        x.label = blank(x.label) ? "" : v;
        const li = wrap.querySelector(`[data-h="${CSS.escape(h)}"][data-f="label"]`);
        if (li) { li.value = x.label; li.placeholder = v; }
      }
    }
    if (k === "date") return; // change olayında sıralanır
    x[k] = v;
    const wcEl = t.closest(".le-field")?.querySelector("[data-wc]");
    if (wcEl) wcEl.textContent = `${wordCount(v)} kelime`;
    if (k === "name") { const b = t.closest("[data-card]")?.querySelector(".lf-who b"); if (b) b.textContent = v || "İsimsiz"; }
    changed();
  });

  wrap.addEventListener("change", e => {
    if (ro) return;
    const t = e.target, f = F();
    if (t.dataset.range) {
      const v = t.value;
      if (!v) return;
      f[t.dataset.range] = v;
      if (f.from > f.to) { if (t.dataset.range === "from") f.to = v; else f.from = v; }
      syncMeetings(f, ctx.refs.meetings);
      ctx.markDirty(); open.add("items"); render();
      return;
    }
    if (t.dataset.h === "cover" && t.dataset.f === "period") {
      const r = periodRange(t.value);
      if (r && (r.from !== f.from || r.to !== f.to)) {
        Object.assign(f, r);
        syncMeetings(f, ctx.refs.meetings);
        ctx.markDirty(); render();
        ctx.toast("Tarih aralığı dönem yazısına göre güncellendi; toplantılar eşitlendi.");
      }
      return;
    }
    if (t.dataset.f === "date" && t.dataset.h?.startsWith("item:")) {
      const x = holder(t.dataset.h);
      if (!x) return;
      x.date = t.value;
      sortItems(f.items);
      ctx.markDirty(); render();
    }
  });

  wrap.addEventListener("click", async e => {
    const rb = e.target.closest("[data-row-act]");
    if (rb && rb.closest("[data-rows]") && !ro) {
      const f = F(), act = rb.dataset.rowAct;
      if (act === "defaults") {
        const ok = !f.kunye.rows.length || await ctx.confirmDlg({ title: "Varsayılan künye getirilsin mi?", body: "<p>Şu anki satırların yerine ayarlardaki Rotary yöneticileri ve kulüp yönetim kurulu gelir.</p>", ok: "Getir" });
        if (!ok) return;
        f.kunye.rows = kunyeDefaults(ctx.refs);
      } else {
        const i = +(rb.closest("[data-row]")?.dataset.row ?? -1);
        f.kunye.rows = rowsAction(f.kunye.rows, act, i, { title: "", name: "" });
      }
      ctx.markDirty(); render();
      if (act === "add") { const ins = wrap.querySelectorAll('[data-rows="kunye"] .le-row:last-child input'); ins[0]?.focus(); }
      return;
    }
    const b = e.target.closest("[data-a]");
    if (!b || b.disabled) return;
    const a = b.dataset.a, h = b.dataset.h, f = F();
    if (a === "generate") return generate();
    if (ro) return;
    if (a === "pick" || a === "pick-multi") {
      const files = await ctx.pickFiles(a === "pick-multi");
      if (files.length) await addPhotos(h, files);
      return;
    }
    if (a === "unphoto") { const x = holder(h); if (x) { x.photo = null; ctx.markDirty(); refreshZone(h); } return; }
    if (a === "avatar") return useAvatar(h, memberOf(holder(h)));
    if (a === "star") {
      const x = holder(h), r = x?.photos?.[+b.dataset.i];
      if (!r) return;
      x.star = isStar(r, x.star) ? null : (r.path || r.url || r);
      ctx.markDirty(); refreshZone(h);
      wrap.querySelector(`[data-drop="${CSS.escape(h)}"] [data-a="star"][data-i="${b.dataset.i}"]`)?.focus();
      return;
    }
    if (a === "del-photo") {
      const x = holder(h), i = +b.dataset.i, r = x?.photos?.[i];
      if (!r) return;
      if (isStar(r, x.star)) x.star = null;
      x.photos = x.photos.filter((_, j) => j !== i);
      ctx.markDirty(); refreshZone(h);
      return;
    }
    if (a === "pick-president") {
      const sel = await ctx.pickPerson({ guests: false, title: "Mektubu yazan kişi" });
      if (!sel?.member) return;
      const p = f.president, m = sel.member;
      Object.assign(p, { member_id: m.id, name: rtcName(m.full_name), role: roleFor(m, ctx.refs.term) });
      p.club ||= CLUB;
      ctx.markDirty(); render();
      if (m.photo_url && !ctx.photoUrl(p.photo)) await useAvatar("president", m);
      return;
    }
    if (a === "add-person") {
      const kind = b.dataset.k;
      const sel = await ctx.pickPerson({ guests: kind === "corner", title: kind === "board" ? "Mesaj yazacak kişi" : "Köşe yazarı" });
      if (!sel) return;
      const m = sel.member;
      const p = { id: uid(), member_id: m?.id || null, guest: !m, name: m ? rtcName(m.full_name) : rtcName(sel.name, false), role: m ? roleFor(m, ctx.refs.term) : "Misafir Üye", body: "", photo: null };
      f[kind].push(p);
      open.add(kind); ctx.markDirty(); render();
      wrap.querySelector(`#lf-b-${CSS.escape(p.id)}`)?.focus();
      if (m?.photo_url) await useAvatar(`${kind}:${p.id}`, m);
      return;
    }
    if (a === "move") {
      const [kind, id] = h.split(":"), list = f[kind], i = list.findIndex(x => x.id === id), j = i + +b.dataset.d;
      if (i < 0 || j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
      ctx.markDirty(); render();
      wrap.querySelector(`[data-a="move"][data-h="${CSS.escape(h)}"][data-d="${b.dataset.d}"]:not(:disabled)`)?.focus();
      return;
    }
    if (a === "del-person") {
      const [kind, id] = h.split(":"), x = holder(h);
      if (!x) return;
      if (!blank(x.body) && !(await ctx.confirmDlg({ title: `${x.name || "Bu kişi"} kaldırılsın mı?`, body: "<p>Yazdığı metin de silinir.</p>", ok: "Kaldır", danger: true }))) return;
      f[kind] = f[kind].filter(p => p.id !== id);
      ctx.markDirty(); render();
      return;
    }
    if (a === "add-item") {
      const kind = b.dataset.k;
      const it = { id: uid(), kind, title: NEW_TITLE[kind] || "Yeni madde", label: "", date: "", photos: [], star: null, notes: "", text: "" };
      if (kind === "ocakbasi") it.host = "";
      f.items.push(it);
      open.add("items"); ctx.markDirty(); render();
      const ti = wrap.querySelector(`[data-h="item:${CSS.escape(it.id)}"][data-f="title"]`);
      ti?.scrollIntoView({ block: "center", behavior: "smooth" });
      ti?.focus(); ti?.select();
      return;
    }
    if (a === "del-item") {
      const x = holder(h);
      if (!x) return;
      if (touched(x) && !(await ctx.confirmDlg({ title: `«${x.title}» silinsin mi?`, body: "<p>Klasördeki fotoğraflar ve notlar da kaldırılır.</p>", ok: "Sil", danger: true }))) return;
      f.items = f.items.filter(it => it !== x);
      ctx.markDirty(); render();
      return;
    }
    if (a === "pick-host") {
      const sel = await ctx.pickPerson({ guests: true, title: "Ocakbaşının ev sahibi" });
      const x = holder(h);
      if (!sel || !x) return;
      x.host = sel.member ? sel.member.full_name : str(sel.name).replace(/\s*\([^)]*\)\s*/g, " ").trim();
      ctx.markDirty(); render();
      return;
    }
    if (a === "clear-host") { const x = holder(h); if (x) { x.host = ""; ctx.markDirty(); render(); } }
  });

  // Sürükle-bırak: tek fotoğraflı alanlar ve madde fotoğrafları.
  let overEl = null;
  const setOver = z => { if (overEl === z) return; overEl?.classList.remove("is-over"); overEl = z; z?.classList.add("is-over"); };
  wrap.addEventListener("dragover", e => {
    if (ro || !hasFiles(e)) return;
    const z = e.target.closest("[data-drop]");
    if (!z) return setOver(null);
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setOver(z);
  });
  wrap.addEventListener("dragleave", e => { if (overEl && !overEl.contains(e.relatedTarget)) setOver(null); });
  wrap.addEventListener("drop", async e => {
    const z = e.target.closest("[data-drop]");
    setOver(null);
    if (ro || !z || !hasFiles(e)) return;
    e.preventDefault();
    await addPhotos(z.dataset.drop, [...e.dataTransfer.files]);
  });

  // ---------- oluştur
  async function generate() {
    if (genBusy || ro) return;
    const f = F();
    const miss = missingFor(f);
    if (miss.length && !(await ctx.confirmDlg({
      title: "Bazı klasörlerde eksik var",
      body: `<ul class="lf-miss">${miss.map(m => `<li>${esc(m)}</li>`).join("")}</ul><p class="muted">Eksiklerle de oluşturabilir, sonra elle düzenleyicide tamamlayabilirsin.</p>`,
      ok: "Yine de oluştur", cancel: "Geri dön",
    }))) return;
    if (ctx.hasPages() && !(await ctx.confirmDlg({
      title: "Sayfalar yeniden kurulsun mu?",
      body: "<p><b>Elle yaptığın değişiklikler silinecek.</b> Mevcut sayfaların yerine klasörlerden yeni sayfalar kurulur.</p>",
      ok: "Yeniden oluştur", danger: true,
    }))) return;
    genBusy = true; render();
    let note = "";
    try {
      if (f.items.length) {
        const items = [...f.items]; // beklerken liste değişse de metinler doğru maddeye gitsin
        // Sunucu tek istekte en fazla 20 madde alır: 20'lik gruplar hâlinde sırayla gönder, metinleri sırayla birleştir.
        const payload = items.map(it => aiItem(it, ctx.refs.meetings));
        const texts = [];
        let fellBack = false;
        for (let s = 0; s < payload.length; s += AI_BATCH) {
          const part = payload.slice(s, s + AI_BATCH);
          const res = await ctx.store.letterAi(part);
          if (gone || ctx.folders !== f) return;
          const got = Array.isArray(res?.texts) ? res.texts : [];
          for (let i = 0; i < part.length; i++) texts.push(got[i]);
          if (res?.source === "sablon") fellBack = true;
        }
        // Beklerken ekran kapandıysa ya da başka mektup açıldıysa sonucu uygulama.
        if (gone || ctx.folders !== f) return;
        items.forEach((it, i) => { const t = texts[i]; if (typeof t === "string" && t.trim()) it.text = t.trim(); });
        if (fellBack) note = ctx.isDemo ? " Demo modunda yapay zekâ kapalı; notlardan şablon metin kullanıldı." : " Yapay zekâya ulaşılamadı; notlardan şablon metin kullanıldı.";
      }
      const pages = assemblePages(f);
      genBusy = false;
      ctx.setPages(pages);
      ctx.toast(`${pages.length} sayfa oluşturuldu. Kontrol edip kaydet.${note}`);
    } catch (e) {
      genBusy = false;
      ctx.toast(e.message || "Sayfalar oluşturulamadı.", "error");
      render();
    }
  }

  render();
  return { render, destroy() { gone = true; wrap.remove(); } };
}
