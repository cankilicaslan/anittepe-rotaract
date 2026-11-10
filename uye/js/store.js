// Veri katmanı. Aynı arayüzün iki uygulaması var:
//  - demo: localStorage (yalnızca bu tarayıcı, güvenlik yok, denemek için)
//  - supabase: gerçek kimlik doğrulama + Postgres RLS (asıl yetki sınırı orada)
import { CONFIG } from "./config.js?v=202611102111";
import { can, hasRole } from "./roles.js?v=202611102111";

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36));
// Yerel tarih (toISOString UTC verir; Türkiye UTC+3 olduğu için gece 03.00'ten önce bir önceki günü döndürürdü).
const localISO = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = () => localISO(new Date());
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return localISO(d); };
const TYPE_TR = { toplanti: "toplantı", ocakbasi: "ocakbaşı", proje: "proje", etkinlik: "etkinlik" };
const MONTHS_TR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
export const trDate = iso => { if (!iso) return ""; const d = new Date(iso + "T12:00:00"); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };

// Yapay zekâ bağlı değilken kullanılan şablon. Gerçek modda Edge Function (Claude) yazar.
export function templateCaption({ type, term_no, club_no, ocakbasi_no, summary, date }) {
  const s = (summary || "").trim();
  const when = date ? trDate(date) : "";
  const tags = "#Rotaract #AnıttepeRotaract #Bölge2430 #RotaractAnkara";
  if (type === "toplanti") {
    return `Dönemimizin ${term_no || "?"}. ve kulübümüzün ${club_no || "?"}. toplantısını${when ? " " + when + " tarihinde" : ""} gerçekleştirdik.\n\n${s || "Bu toplantıda kulüp gündemimizi konuştuk."}\n\nBir sonraki toplantıda seni de aramızda görmek isteriz. Toplantılarımız iki haftada bir perşembe 19.30'da.\n\n${tags}`;
  }
  if (type === "ocakbasi") {
    return `Dönemin ${ocakbasi_no || "?"}. ocakbaşında bir araya geldik.\n\n${s || "Sohbet, dostluk ve bol kahkaha."}\n\nDostluğun en güzel hali, aynı masada.\n\n${tags} #Ocakbaşı`;
  }
  return `${s || (type === "proje" ? "Yeni projemizi hayata geçirdik." : "Etkinliğimizde bir araya geldik.")}\n\nEmeği geçen herkese teşekkür ederiz. Bir sonraki ${TYPE_TR[type] || "buluşma"}da sen de yanımızda ol.\n\n${tags}`;
}

async function sha(s) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("ar-panel:" + s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
}

/* ------------------------------ DEMO ------------------------------ */
const KEY = "ar-panel-demo-v1";
const SEED_PEOPLE = [
  ["Simay Oğuzkurt", "Başkan", ["baskan"], false, "simay-oguzkurt"],
  ["Selva Tuluy", "Asbaşkan", [], false, "selva-tuluy"],
  ["Oğulcan Görgülü", "Sekreter", ["sekreter"], false, "ogulcan-gorgulu"],
  ["Umut Ekin Akkuş", "Sayman", ["sayman"], false, "umut-ekin-akkus"],
  ["Can Kılıçaslan", "Yönetim Kurulu Üyesi", [], true, "can-kilicaslan"],
  ["Begüm Gözüpek", "Geçmiş Dönem Başkanı", [], true, "begum-gozupek"],
  ["Melishan Özkan Ağca", "Hizmet Projeleri Komitesi Başkanı", ["hizmet"], false, "melishan-ozkan-agca"],
  ["Muhammed Alperen Çelik", "Halkla İlişkiler ve Tanıtım Komitesi Başkanı", ["pr"], false, "muhammed-alperen-celik"],
  ["Ezgi Erdoğan", "Kulüp Hizmetleri Komitesi Başkanı", [], false, "ezgi-erdogan"],
  ["Gizem Hanoğlu", "Meslek Hizmetleri Komitesi Başkanı", [], false, "gizem-hanoglu"],
  ["Zehra Cansu Taşanlar", "Afet Komitesi Başkanı", [], false, "zehra-cansu-tasanlar"],
  ["Metehan Can Çırak", "Üye", [], false, "metehan-can-cirak"]
];
const DEMO_PASSWORD = "rotaract2430";

function seed() {
  const term = { id: uid(), name: "2026-27", start_date: "2026-07-02", meeting_count: 24, club_meeting_offset: 599, opening_balance: 5000, is_current: true };
  const profiles = SEED_PEOPLE.map(([full_name, title, roles, past, slug]) => ({
    id: uid(), full_name, title, roles, past_president: past, status: "active",
    email: slug.split("-")[0] + "@demo.anitteperotaract", phone: "", photo_url: `../assets/uyeler/${slug}.jpg`,
    birth_date: null, profession: "", joined_at: "2025-10-01", created_at: new Date().toISOString()
  }));
  const meetings = Array.from({ length: 24 }, (_, i) => ({ id: uid(), term_id: term.id, term_no: i + 1, club_no: 600 + i, date: addDays(term.start_date, 14 * i), note: "" }));
  // Örnek yoklama: geçmiş toplantılar için belirlenimci, gerçekçi bir dağılım.
  const attendance = [];
  let r = 7;
  const rnd = () => (r = (r * 9301 + 49297) % 233280) / 233280;
  meetings.filter(m => m.date < today()).forEach(m => profiles.forEach(p => {
    const x = rnd(); attendance.push({ meeting_id: m.id, member_id: p.id, status: x < 0.74 ? "geldi" : x < 0.88 ? "mazeretli" : "gelmedi", note: "" });
  }));
  const dues = [], charges = [];
  [["2026-09", "Eylül 2026 aidatı", "2026-09-15"], ["2026-10", "Ekim 2026 aidatı", "2026-10-15"], ["2026-11", "Kasım 2026 aidatı", "2026-11-15"]].forEach(([period, label, due_date], k) => {
    const d = { id: uid(), term_id: term.id, label, period, amount: 250, due_date, created_at: new Date().toISOString() };
    dues.push(d);
    profiles.forEach((p, i) => charges.push({ id: uid(), due_id: d.id, member_id: p.id, amount: 250, paid_at: (k < 2 && (i + k) % 5 !== 0) ? addDays(due_date, -3) : null }));
  });
  const transactions = [
    { id: uid(), term_id: term.id, date: "2026-07-10", kind: "gider", category: "Etkinlik", description: "Döneme Merhaba Partisi salon kirası", amount: 3500 },
    { id: uid(), term_id: term.id, date: "2026-07-10", kind: "gelir", category: "Etkinlik", description: "Döneme Merhaba Partisi bilet gelirleri", amount: 6200 },
    { id: uid(), term_id: term.id, date: "2026-10-24", kind: "gider", category: "Proje", description: "Dünya Polio Günü stant malzemeleri", amount: 850 }
  ];
  const projects = [
    { id: uid(), title: "Dünya Polio Günü standı", kind: "hizmet", date: "2026-10-24", time: "12:00", location: "Kızılay", description: "Polio farkındalığı için bilgilendirme standı.", plan: "Broşür baskısı, stant izni, iki vardiya gönüllü.", owner: "Melishan Özkan Ağca", status: "tamamlandi", public: true, created_at: new Date().toISOString() },
    { id: uid(), title: "Kitap toplama kampanyası", kind: "hizmet", date: "2026-12-05", time: "14:00", location: "Hybrid Hub", description: "Köy okulu kütüphanesi için kitap toplama.", plan: "1) Okulla iletişim 2) Toplama kutuları 3) Teslim günü organizasyonu", owner: "Melishan Özkan Ağca", status: "planlandi", public: true, created_at: new Date().toISOString() }
  ];
  return { profiles, passwords: {}, term, meetings, attendance, dues, charges, transactions, projects, posts: [], session: null };
}

function demoStore() {
  let S;
  try { S = JSON.parse(localStorage.getItem(KEY) || "null"); } catch { S = null; }
  if (!S) S = seed();
  // v2 alanları (eski demo verisi olan tarayıcılar için de)
  if (!S.clubEvents) S.clubEvents = [
    { id: uid(), club: "Bölge 2430 Rotaract", title: "Bölge Rotaract buluşması (örnek)", date: addDays(today(), 12), time: "14:00", location: "Ankara", description: "Bölgedeki kulüplerle tanışma ve ortak proje fikirleri.", link: "", created_by: null, created_at: new Date().toISOString() }
  ];
  if (!S.rsvps) S.rsvps = [];
  if (!S.announcements) S.announcements = [];
  if (!S.privates) S.privates = {};
  if (!S.monthlyDues) {
    // Demo: dönemin kalan ayları için de aidat günleri (takvimde her ay görünsün)
    const have = new Set(S.dues.map(d => d.period));
    const [sy, sm] = S.term.start_date.split("-").map(Number);
    for (let i = 0; i < 12; i++) {
      const d = new Date(sy, sm - 1 + i, 1), period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (have.has(period) || period < "2026-09") continue;
      const due = { id: uid(), term_id: S.term.id, label: `${MONTHS_TR[d.getMonth()]} ${d.getFullYear()} aidatı`, period, amount: 250, due_date: `${period}-15`, created_at: new Date().toISOString() };
      S.dues.push(due);
      S.profiles.filter(p => p.status === "active").forEach(p => S.charges.push({ id: uid(), due_id: due.id, member_id: p.id, amount: 250, paid_at: null }));
    }
    S.monthlyDues = true;
  }
  if (!S.albums) { S.albums = []; S.albumPhotos = []; }
  if (!S.guests) {
    // Demo: 6. toplantıdan beri gelen bir misafir ve 9. toplantıda üye alınmış biri
    const g = { id: uid(), full_name: "Deniz Yılmaz (örnek misafir)", phone: "", email: "", note: "", created_at: new Date().toISOString() };
    S.guests = [g]; S.guestAtt = [];
    S.meetings.filter(m => m.term_no >= 6 && m.date < today()).forEach((m, i) => S.guestAtt.push({ meeting_id: m.id, guest_id: g.id, status: i % 4 === 3 ? "gelmedi" : "geldi", note: "" }));
    const late = S.profiles.find(p => p.full_name === "Metehan Can Çırak"), m9 = S.meetings.find(m => m.term_no === 9);
    if (late && m9) { late.start_meeting_id = m9.id; S.attendance = S.attendance.filter(a => !(a.member_id === late.id && S.meetings.find(m => m.id === a.meeting_id)?.term_no < 9)); }
  }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { throw new Error("Tarayıcı depolaması dolu. Daha küçük bir fotoğraf deneyin."); } };
  save();
  const me = () => S.profiles.find(p => p.id === S.session) || null;
  const need = (panel, mode = "edit") => { if (!can(me(), panel, mode)) throw new Error("Bu işlem için yetkiniz yok."); };
  const clone = x => JSON.parse(JSON.stringify(x));

  return {
    mode: "demo",
    async demoAccounts() { return S.profiles.map(p => ({ email: p.email, label: p.full_name, title: p.title })); },
    demoPassword: DEMO_PASSWORD,
    resetDemo() { localStorage.removeItem(KEY); },
    async signUp({ full_name, phone, email, password }) {
      email = (email || "").trim().toLowerCase();
      if (!full_name || !email || !password) throw new Error("Ad, e-posta ve şifre zorunlu.");
      if (password.length < 8) throw new Error("Şifre en az 8 karakter olmalı.");
      if (S.profiles.some(p => p.email === email)) throw new Error("Bu e-posta ile zaten bir hesap var.");
      const p = { id: uid(), full_name, phone, email, photo_url: "", title: "Üye", roles: [], past_president: false, status: "pending", birth_date: null, profession: "", joined_at: today(), created_at: new Date().toISOString() };
      S.profiles.push(p); S.passwords[email] = await sha(password); S.session = p.id; save(); return clone(p);
    },
    async signIn(email, password) {
      email = (email || "").trim().toLowerCase();
      const p = S.profiles.find(x => x.email === email);
      const ok = p && (S.passwords[email] ? S.passwords[email] === await sha(password) : password === DEMO_PASSWORD);
      if (!ok) throw new Error("E-posta ya da şifre hatalı.");
      S.session = p.id; save(); return clone(p);
    },
    async signOut() { S.session = null; save(); },
    async resetPassword() { throw new Error("Demo modunda şifre sıfırlama yok. Demo hesaplarına giriş ekranındaki isimlere tıklayarak girebilirsin."); },
    async updatePassword(password) {
      if ((password || "").length < 8) throw new Error("Şifre en az 8 karakter olmalı.");
      const m = me(); if (!m) throw new Error("Önce giriş yap."); S.passwords[m.email] = await sha(password); save();
    },
    onRecovery() {},
    async me() { return me() ? clone(me()) : null; },

    async listMembers() { return clone(S.profiles); },

    // Fotoğraf arşivi (demo: küçük resimler bu tarayıcıda saklanır; tam boy da küçük resimdir)
    async listAlbums() {
      if (!me() || me().status !== "active") return [];
      return clone(S.albums).map(a => ({ ...a, photo_count: S.albumPhotos.filter(p => p.album_id === a.id).length, cover_url: a.cover_path || null }));
    },
    async getAlbum(id) { const a = S.albums.find(x => x.id === id); return a ? clone(a) : null; },
    async createAlbum({ type, name, date }) {
      need("arsiv-yonetim");
      if (!(name || "").trim() || !date) throw new Error("Etkinlik adı ve tarihi zorunlu.");
      const a = { id: uid(), type, name: name.trim(), date, cover_path: null, created_by: me().id, created_at: new Date().toISOString() };
      S.albums.push(a); save(); return clone(a);
    },
    async updateAlbum(id, patch) { need("arsiv-yonetim"); Object.assign(S.albums.find(a => a.id === id), patch); save(); },
    async deleteAlbum(id) { need("arsiv-yonetim"); S.albums = S.albums.filter(a => a.id !== id); S.albumPhotos = S.albumPhotos.filter(p => p.album_id !== id); save(); },
    async listPhotos(albumId) {
      return clone(S.albumPhotos.filter(p => p.album_id === albumId)).map(p => ({ ...p, thumb_url: p.data, url: p.data, uploader: S.profiles.find(x => x.id === p.uploaded_by)?.full_name || "" }));
    },
    async uploadAlbumPhoto(albumId, file) {
      if (me()?.status !== "active") throw new Error("Fotoğraf yüklemek için aktif üye olmalısın.");
      const p = await preparePhoto(file);
      const data = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(p.thumb); });
      const row = { id: uid(), album_id: albumId, path: "", thumb_path: "", data, width: p.width, height: p.height, uploaded_by: me().id, created_at: new Date().toISOString() };
      S.albumPhotos.push(row);
      const a = S.albums.find(x => x.id === albumId); if (a && !a.cover_path) a.cover_path = data;
      save(); return clone(row);
    },
    async deleteAlbumPhoto(photo) {
      const m = me(); if (!(photo.uploaded_by === m?.id || can(m, "arsiv-yonetim", "edit"))) throw new Error("Bu fotoğrafı yalnızca yükleyen kişi ya da yöneticiler silebilir.");
      S.albumPhotos = S.albumPhotos.filter(p => p.id !== photo.id);
      const a = S.albums.find(x => x.id === photo.album_id); if (a && a.cover_path === photo.data) a.cover_path = S.albumPhotos.find(p => p.album_id === a.id)?.data || null;
      save();
    },
    // Demo: kendi şifresini belirleyenler + örnek olarak listenin ilk yarısı "şifre oluşturdu" sayılır.
    async listAccounts() {
      const m = me(); if (!(hasRole(m, "baskan") || m?.past_president || hasRole(m, "sekreter"))) return null;
      return S.profiles.map((p, i) => ({ id: p.id, has_password: !!S.passwords[p.email] || i % 2 === 0, last_sign_in_at: null }));
    },
    async updateMember(id, patch) {
      const m = me(), p = S.profiles.find(x => x.id === id);
      if (!p) throw new Error("Üye bulunamadı.");
      const admin = hasRole(m, "baskan");
      if (!admin && m?.id !== id) throw new Error("Bu işlem için yetkiniz yok.");
      const allowed = admin ? Object.keys(patch) : ["full_name", "phone", "photo_url", "birth_date", "profession", "instagram"];
      allowed.forEach(k => { if (k in patch && k !== "blood_type") p[k] = patch[k]; });
      if ("blood_type" in patch) S.privates[id] = { ...(S.privates[id] || {}), blood_type: patch.blood_type };
      save(); return clone(p);
    },
    async addMember(d) {
      if (!hasRole(me(), "baskan")) throw new Error("Bu işlem için yetkiniz yok.");
      const email = (d.email || "").trim().toLowerCase();
      if (!d.full_name) throw new Error("Ad soyad zorunlu.");
      if (email && S.profiles.some(p => p.email === email)) throw new Error("Bu e-posta ile zaten bir üye var.");
      const p = { id: uid(), full_name: d.full_name.trim(), phone: d.phone || "", email, photo_url: "", title: d.title || "Üye", roles: [], past_president: false, status: "active", birth_date: d.birth_date || null, profession: d.profession || "", instagram: d.instagram || "", joined_at: d.joined_at || today(), created_at: new Date().toISOString() };
      S.profiles.push(p);
      if (d.blood_type) S.privates[p.id] = { blood_type: d.blood_type };
      save(); return clone(p);
    },
    async getPrivate(id) {
      const m = me();
      if (!(m?.id === id || hasRole(m, "baskan") || (m?.status === "active" && m.past_president))) return {};
      return clone(S.privates[id] || {});
    },
    async approveMember(id) { return this.updateMember(id, { status: "active" }); },
    async uploadPhoto(id, file) {
      const url = await squareDataUrl(file, 360);
      await this.updateMember(id, { photo_url: url }); return url;
    },

    async getTerm() { return clone(S.term); },
    async updateTerm(patch) {
      if (!(can(me(), "kasa", "edit") || can(me(), "yoklama", "edit"))) throw new Error("Bu işlem için yetkiniz yok.");
      Object.assign(S.term, patch); save(); return clone(S.term);
    },
    async listMeetings() { return clone(S.meetings).sort((a, b) => a.term_no - b.term_no); },
    async updateMeeting(id, patch) { need("yoklama"); Object.assign(S.meetings.find(m => m.id === id), patch); save(); },
    async listAttendance() {
      const m = me();
      return clone(can(m, "yoklama") ? S.attendance : S.attendance.filter(a => a.member_id === m?.id));
    },
    async setAttendance(meeting_id, member_id, status, note = "") {
      need("yoklama");
      S.attendance = S.attendance.filter(a => !(a.meeting_id === meeting_id && a.member_id === member_id));
      if (status) S.attendance.push({ meeting_id, member_id, status, note, updated_at: new Date().toISOString() });
      save();
    },
    async listGuests() { return can(me(), "yoklama") ? clone(S.guests) : []; },
    async saveGuest(g) {
      need("yoklama");
      if (!(g.full_name || "").trim()) throw new Error("Misafirin adını yaz.");
      const ex = g.id && S.guests.find(x => x.id === g.id);
      if (ex) { Object.assign(ex, g); save(); return clone(ex); }
      const n = { id: uid(), full_name: g.full_name.trim(), phone: g.phone || "", email: g.email || "", note: g.note || "", created_at: new Date().toISOString() };
      S.guests.push(n); save(); return clone(n);
    },
    async deleteGuest(id) { need("yoklama"); S.guests = S.guests.filter(g => g.id !== id); S.guestAtt = S.guestAtt.filter(a => a.guest_id !== id); save(); },
    async listGuestAttendance() { return can(me(), "yoklama") ? clone(S.guestAtt) : []; },
    async setGuestAttendance(meeting_id, guest_id, status) {
      need("yoklama");
      S.guestAtt = S.guestAtt.filter(a => !(a.meeting_id === meeting_id && a.guest_id === guest_id));
      if (status) S.guestAtt.push({ meeting_id, guest_id, status, note: "", updated_at: new Date().toISOString() });
      save();
    },

    async listDues() { return clone(S.dues); },
    async createDue({ label, period, amount, due_date, member_ids }) {
      need("aidat");
      const d = { id: uid(), term_id: S.term.id, label, period, amount: +amount, due_date, created_at: new Date().toISOString() };
      S.dues.push(d);
      member_ids.forEach(mid => S.charges.push({ id: uid(), due_id: d.id, member_id: mid, amount: +amount, paid_at: null }));
      save(); return clone(d);
    },
    async deleteDue(id) { need("aidat"); S.dues = S.dues.filter(d => d.id !== id); S.charges = S.charges.filter(c => c.due_id !== id); save(); },
    async listCharges() { const m = me(); return clone(can(m, "aidat") ? S.charges : S.charges.filter(c => c.member_id === m?.id)); },
    async setChargePaid(id, paid_at) { need("aidat"); S.charges.find(c => c.id === id).paid_at = paid_at; save(); },

    async listTransactions() { need("kasa", "view"); return clone(S.transactions); },
    async addTransaction(t) { need("kasa"); const x = { id: uid(), term_id: S.term.id, ...t, amount: +t.amount }; S.transactions.push(x); save(); return clone(x); },
    async deleteTransaction(id) { need("kasa"); S.transactions = S.transactions.filter(t => t.id !== id); save(); },

    async listProjects() { need("projeler", "view"); return clone(S.projects); },
    async saveProject(p) {
      need("projeler");
      if (p.id) Object.assign(S.projects.find(x => x.id === p.id), p);
      else { p = { ...p, id: uid(), created_at: new Date().toISOString() }; S.projects.push(p); }
      save(); return clone(p);
    },
    async deleteProject(id) { need("projeler"); S.projects = S.projects.filter(p => p.id !== id); save(); },
    // Ortak takvim: her aktif üye tüm projeleri görür
    async listCalendarProjects() { if (me()?.status !== "active") return []; return clone(S.projects); },

    // Diğer kulüplerin etkinlikleri
    async listClubEvents() { return clone(S.clubEvents).sort((a, b) => a.date.localeCompare(b.date)); },
    async saveClubEvent(e) {
      const m = me(); if (m?.status !== "active") throw new Error("Bu işlem için yetkiniz yok.");
      if (e.id) {
        const x = S.clubEvents.find(z => z.id === e.id);
        if (x.created_by !== m.id && !hasRole(m, "baskan")) throw new Error("Bu etkinliği yalnızca ekleyen kişi ya da başkan düzenleyebilir.");
        Object.assign(x, e);
      } else { e = { ...e, id: uid(), created_by: m.id, created_at: new Date().toISOString() }; S.clubEvents.push(e); }
      save(); return clone(e);
    },
    async deleteClubEvent(id) {
      const m = me(), x = S.clubEvents.find(z => z.id === id);
      if (!x || (x.created_by !== m?.id && !hasRole(m, "baskan"))) throw new Error("Bu etkinliği yalnızca ekleyen kişi ya da başkan silebilir.");
      S.clubEvents = S.clubEvents.filter(z => z.id !== id); S.rsvps = S.rsvps.filter(r => r.event_id !== id); save();
    },
    async listRsvps() { return clone(S.rsvps); },
    async setRsvp(event_id, status, note = "") {
      const m = me(); if (m?.status !== "active") throw new Error("Bu işlem için yetkiniz yok.");
      S.rsvps = S.rsvps.filter(r => !(r.event_id === event_id && r.member_id === m.id));
      if (status) S.rsvps.push({ event_id, member_id: m.id, status, note, updated_at: new Date().toISOString() });
      save();
    },

    // Duyurular
    async listAnnouncements() { need("duyuru", "view"); return clone(S.announcements).sort((a, b) => b.created_at.localeCompare(a.created_at)); },
    async saveAnnouncement(a) { need("duyuru"); const x = { id: uid(), created_by: S.session, created_at: new Date().toISOString(), ...a }; S.announcements.push(x); save(); return clone(x); },
    async sendAnnouncement() { need("duyuru"); return { ok: false, demo: true }; },

    async listPosts() { need("instagram", "view"); return clone(S.posts); },
    async savePost(p) {
      need("instagram");
      const x = { id: uid(), created_by: S.session, created_at: new Date().toISOString(), ...p, image_url: "" };
      S.posts.push(x); save(); return clone(x);
    },
    async generateCaption(input) { need("instagram"); return { caption: templateCaption(input), source: "sablon" }; },
    async publishInstagram() { need("instagram"); return { ok: false, demo: true }; }
  };
}

/* ---------------------------- SUPABASE ---------------------------- */
async function supabaseStore() {
  const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm");
  // Oturum yalnızca bu sekmede tutulur (sessionStorage): sekme kapatılınca üyelik oturumu da kapanır.
  // Eskiden localStorage'da kalmış oturum anahtarları temizlenir.
  try { Object.keys(localStorage).filter(k => /^sb-.*-auth-token/.test(k)).forEach(k => localStorage.removeItem(k)); } catch {}
  let authStorage; try { sessionStorage.setItem("ar-t", "1"); sessionStorage.removeItem("ar-t"); authStorage = sessionStorage; } catch { authStorage = undefined; }
  const sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, { auth: { storage: authStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  const ok = ({ data, error }) => { if (error) throw new Error(trError(error.message)); return data; };
  let cachedTerm = null;
  const term = async () => cachedTerm || (cachedTerm = ok(await sb.from("terms").select("*").eq("is_current", true).single()));
  const fn = async (name, body) => {
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}`, apikey: CONFIG.SUPABASE_ANON_KEY },
      body: JSON.stringify(body)
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || "Sunucu isteği başarısız oldu.");
    return j;
  };
  const meId = async () => (await sb.auth.getUser()).data.user?.id;

  return {
    mode: "supabase",
    async signUp({ full_name, phone, email, password }) {
      ok(await sb.auth.signUp({ email, password, options: { data: { full_name, phone }, emailRedirectTo: location.href.split("#")[0] } }));
      return this.me();
    },
    async signIn(email, password) { ok(await sb.auth.signInWithPassword({ email, password })); return this.me(); },
    async signOut() { await sb.auth.signOut(); },
    async resetPassword(email) { ok(await sb.auth.resetPasswordForEmail((email || "").trim(), { redirectTo: location.origin + location.pathname })); },
    async updatePassword(password) { if ((password || "").length < 8) throw new Error("Şifre en az 8 karakter olmalı."); ok(await sb.auth.updateUser({ password })); },
    onRecovery(cb) { sb.auth.onAuthStateChange(ev => { if (ev === "PASSWORD_RECOVERY") cb(); }); },
    async me() {
      const id = await meId(); if (!id) return null;
      const { data } = await sb.from("profiles").select("*").eq("id", id).maybeSingle();
      const p = data || { id, full_name: "", status: "pending", roles: [] };
      try { const { data: o } = await sb.rpc("is_owner"); if (o === true) p.is_owner = true; } catch {}
      return p;
    },
    async listMembers() { return ok(await sb.from("profiles").select("*").order("full_name")); },

    // Fotoğraf arşivi: "photos" özel deposu; görseller 1 saatlik imzalı adreslerle gösterilir.
    async listAlbums() {
      const rows = ok(await sb.from("albums").select("*, album_photos(count)").order("date", { ascending: false }));
      const covers = rows.map(a => a.cover_path).filter(Boolean);
      const urls = covers.length ? ok(await sb.storage.from("photos").createSignedUrls(covers, 3600)) : [];
      const map = new Map(urls.map(u => [u.path, u.signedUrl]));
      return rows.map(({ album_photos, ...a }) => ({ ...a, photo_count: album_photos?.[0]?.count ?? 0, cover_url: map.get(a.cover_path) || null }));
    },
    async getAlbum(id) { const { data } = await sb.from("albums").select("*").eq("id", id).maybeSingle(); return data; },
    async createAlbum({ type, name, date }) {
      if (!(name || "").trim() || !date) throw new Error("Etkinlik adı ve tarihi zorunlu.");
      return ok(await sb.from("albums").insert({ type, name: name.trim(), date }).select().single());
    },
    async updateAlbum(id, patch) { ok(await sb.from("albums").update(patch).eq("id", id)); },
    async deleteAlbum(id) {
      const photos = ok(await sb.from("album_photos").select("path, thumb_path").eq("album_id", id));
      const paths = photos.flatMap(p => [p.path, p.thumb_path]);
      for (let i = 0; i < paths.length; i += 100) ok(await sb.storage.from("photos").remove(paths.slice(i, i + 100)));
      ok(await sb.from("albums").delete().eq("id", id));
    },
    async listPhotos(albumId) {
      const rows = ok(await sb.from("album_photos").select("*, profiles:uploaded_by(full_name)").eq("album_id", albumId).order("created_at"));
      if (!rows.length) return [];
      const all = rows.flatMap(p => [p.thumb_path, p.path]);
      const map = new Map();
      for (let i = 0; i < all.length; i += 200) ok(await sb.storage.from("photos").createSignedUrls(all.slice(i, i + 200), 3600)).forEach(u => map.set(u.path, u.signedUrl));
      return rows.map(({ profiles, ...p }) => ({ ...p, thumb_url: map.get(p.thumb_path), url: map.get(p.path), uploader: profiles?.full_name || "" }));
    },
    async uploadAlbumPhoto(albumId, file) {
      const p = await preparePhoto(file);
      const id = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
      const path = `${albumId}/${id}.jpg`, thumb_path = `${albumId}/thumb/${id}.jpg`;
      ok(await sb.storage.from("photos").upload(path, p.full, { contentType: "image/jpeg" }));
      ok(await sb.storage.from("photos").upload(thumb_path, p.thumb, { contentType: "image/jpeg" }));
      return ok(await sb.from("album_photos").insert({ album_id: albumId, path, thumb_path, width: p.width, height: p.height, uploaded_by: await meId() }).select().single());
    },
    async deleteAlbumPhoto(photo) {
      ok(await sb.from("album_photos").delete().eq("id", photo.id));
      await sb.storage.from("photos").remove([photo.path, photo.thumb_path]);
    },
    // Kim siteye şifresini oluşturmuş? (member_accounts SQL fonksiyonu; yetkisiz ya da kurulmamışsa null)
    async listAccounts() { const { data, error } = await sb.rpc("member_accounts"); return error || !data?.length ? null : data; },
    async updateMember(id, patch) {
      const { blood_type, ...rest } = patch;
      if (blood_type !== undefined) ok(await sb.from("profile_private").upsert({ member_id: id, blood_type }));
      return Object.keys(rest).length ? ok(await sb.from("profiles").update(rest).eq("id", id).select().single()) : null;
    },
    async approveMember(id) { return this.updateMember(id, { status: "active" }); },
    async uploadPhoto(id, file) {
      const blob = await squareBlob(file, 480);
      const path = `${id}/${Date.now()}.jpg`;
      ok(await sb.storage.from("avatars").upload(path, blob, { contentType: "image/jpeg", upsert: true }));
      const url = sb.storage.from("avatars").getPublicUrl(path).data.publicUrl;
      await this.updateMember(id, { photo_url: url }); return url;
    },
    async getTerm() { return term(); },
    async updateTerm(patch) { const t = await term(); cachedTerm = ok(await sb.from("terms").update(patch).eq("id", t.id).select().single()); return cachedTerm; },
    async listMeetings() { const t = await term(); return ok(await sb.from("meetings").select("*").eq("term_id", t.id).order("term_no")); },
    async updateMeeting(id, patch) { ok(await sb.from("meetings").update(patch).eq("id", id)); },
    async listAttendance() {
      // Yalnızca güncel dönem: aksi halde birkaç dönem sonra PostgREST'in 1000 satır sınırına takılıp istatistikler sessizce bozulur.
      const t = await term();
      return ok(await sb.from("attendance").select("meeting_id,member_id,status,note,meetings!inner(term_id)").eq("meetings.term_id", t.id));
    },
    async setAttendance(meeting_id, member_id, status, note = "") {
      if (!status) ok(await sb.from("attendance").delete().match({ meeting_id, member_id }));
      else ok(await sb.from("attendance").upsert({ meeting_id, member_id, status, note, updated_at: new Date().toISOString() }));
    },
    async listGuests() { return ok(await sb.from("guests").select("*").order("full_name")); },
    async saveGuest(g) {
      if (!(g.full_name || "").trim()) throw new Error("Misafirin adını yaz.");
      const row = { full_name: g.full_name.trim(), phone: g.phone || null, email: g.email || null, note: g.note || null };
      return g.id ? ok(await sb.from("guests").update(row).eq("id", g.id).select().single()) : ok(await sb.from("guests").insert(row).select().single());
    },
    async deleteGuest(id) { ok(await sb.from("guests").delete().eq("id", id)); },
    async listGuestAttendance() {
      const t = await term();
      return ok(await sb.from("guest_attendance").select("meeting_id,guest_id,status,note,meetings!inner(term_id)").eq("meetings.term_id", t.id));
    },
    async setGuestAttendance(meeting_id, guest_id, status) {
      if (!status) ok(await sb.from("guest_attendance").delete().match({ meeting_id, guest_id }));
      else ok(await sb.from("guest_attendance").upsert({ meeting_id, guest_id, status, updated_at: new Date().toISOString() }));
    },
    async listDues() { return ok(await sb.from("dues").select("*").order("due_date")); },
    async createDue({ label, period, amount, due_date, member_ids }) {
      const t = await term();
      const d = ok(await sb.from("dues").insert({ term_id: t.id, label, period, amount, due_date }).select().single());
      if (member_ids.length) {
        const r = await sb.from("charges").insert(member_ids.map(member_id => ({ due_id: d.id, member_id, amount })));
        if (r.error) { await sb.from("dues").delete().eq("id", d.id); ok(r); }
      }
      return d;
    },
    async deleteDue(id) { ok(await sb.from("dues").delete().eq("id", id)); },
    async listCharges() { return ok(await sb.from("charges").select("*")); },
    async setChargePaid(id, paid_at) { ok(await sb.from("charges").update({ paid_at }).eq("id", id)); },
    async listTransactions() { const t = await term(); return ok(await sb.from("transactions").select("*").eq("term_id", t.id).order("date")); },
    async addTransaction(t) { const tm = await term(); return ok(await sb.from("transactions").insert({ ...t, term_id: tm.id }).select().single()); },
    async deleteTransaction(id) { ok(await sb.from("transactions").delete().eq("id", id)); },
    async listProjects() { return ok(await sb.from("projects").select("*").order("date")); },
    async saveProject(p) {
      const { id, ...rest } = p;
      return id ? ok(await sb.from("projects").update(rest).eq("id", id).select().single())
                : ok(await sb.from("projects").insert(rest).select().single());
    },
    async deleteProject(id) { ok(await sb.from("projects").delete().eq("id", id)); },
    async listCalendarProjects() { return ok(await sb.from("projects").select("*").order("date")); },
    async addMember(d) { const r = await fn("invite-member", d); return r.profile; },
    async getPrivate(id) { const { data } = await sb.from("profile_private").select("*").eq("member_id", id).maybeSingle(); return data || {}; },
    async listClubEvents() { return ok(await sb.from("club_events").select("*").order("date")); },
    async saveClubEvent(e) {
      const { id, ...rest } = e;
      return id ? ok(await sb.from("club_events").update(rest).eq("id", id).select().single())
                : ok(await sb.from("club_events").insert(rest).select().single());
    },
    async deleteClubEvent(id) { ok(await sb.from("club_events").delete().eq("id", id)); },
    async listRsvps() { return ok(await sb.from("club_event_rsvps").select("*")); },
    async setRsvp(event_id, status, note = "") {
      const member_id = await meId();
      if (!status) ok(await sb.from("club_event_rsvps").delete().match({ event_id, member_id }));
      else ok(await sb.from("club_event_rsvps").upsert({ event_id, member_id, status, note, updated_at: new Date().toISOString() }));
    },
    async listAnnouncements() { return ok(await sb.from("announcements").select("*").order("created_at", { ascending: false })); },
    async saveAnnouncement(a) { return ok(await sb.from("announcements").insert(a).select().single()); },
    async sendAnnouncement(a) { return fn("announce", a); },
    async listPosts() { return ok(await sb.from("posts").select("*").order("created_at", { ascending: false })); },
    async savePost(p) { return ok(await sb.from("posts").insert({ ...p, created_by: await meId() }).select().single()); },
    async generateCaption(input) {
      try { return await fn("caption", input); }
      catch (e) { return { caption: templateCaption(input), source: "sablon", error: e.message }; }
    },
    async publishInstagram({ blob, caption, post_id }) {
      const image_base64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(blob); });
      const j = await fn("instagram-publish", { image_base64, caption, post_id });
      return { ok: true, ...j };
    }
  };
}

function trError(m) {
  if (/Invalid login credentials/i.test(m)) return "E-posta ya da şifre hatalı.";
  if (/Email not confirmed/i.test(m)) return "E-posta adresinizi doğrulamanız gerekiyor. Gelen kutunuza bakın.";
  if (/already registered/i.test(m)) return "Bu e-posta ile zaten bir hesap var.";
  if (/row-level security|permission denied/i.test(m)) return "Bu işlem için yetkiniz yok.";
  if (/multiple \(or no\) rows|contain 0 rows/i.test(m)) return "Kayıt bulunamadı ya da bu işlem için yetkiniz yok.";
  if (/Password should be/i.test(m)) return "Şifre en az 8 karakter olmalı.";
  return m;
}

/* Fotoğrafı kare kırpıp küçült. */
function loadImg(file) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("Fotoğraf okunamadı.")); i.src = URL.createObjectURL(file); });
}
async function squareCanvas(file, size) {
  const img = await loadImg(file); const s = Math.min(img.naturalWidth, img.naturalHeight);
  const c = document.createElement("canvas"); c.width = c.height = size;
  c.getContext("2d").drawImage(img, (img.naturalWidth - s) / 2, Math.max(0, (img.naturalHeight - s) / 3), s, s, 0, 0, size, size);
  return c;
}
// Fotoğraf arşivi: en boy oranını koruyarak küçült (tam boy 2048 px, küçük resim 480 px), JPEG yap.
async function fitCanvas(file, max) {
  const img = await loadImg(file); URL.revokeObjectURL(img.src);
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); return c;
}
const canvasBlob = (c, q) => new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error("Fotoğraf işlenemedi.")), "image/jpeg", q));
async function preparePhoto(file) {
  const full = await fitCanvas(file, 2048), thumb = await fitCanvas(file, 480);
  return { full: await canvasBlob(full, 0.85), thumb: await canvasBlob(thumb, 0.78), width: full.width, height: full.height };
}
async function squareDataUrl(file, size) { return (await squareCanvas(file, size)).toDataURL("image/jpeg", 0.82); }
async function squareBlob(file, size) { const c = await squareCanvas(file, size); return new Promise(r => c.toBlob(r, "image/jpeg", 0.86)); }

export async function createStore() {
  // ?demo ile açılırsa canlı veriye dokunmadan örnek verilerle çalışır.
  const demo = new URLSearchParams(location.search).has("demo");
  return !demo && CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY ? supabaseStore() : demoStore();
}
