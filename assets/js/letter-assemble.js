// Başkan Mektubu: klasörlerden sayfa kurma.
// Saf modül: DOM'a dokunmaz. Klasörleri (kapak, künye, başkan, yönetim kurulu,
// köşe, maddeler) letter-render.js'in çizdiği sayfalara dönüştürür.

export const LONG_WORDS = 90;
const MAX_FULL_PHOTOS = 4;

const uid = () => globalThis.crypto.randomUUID();
const str = (v) => (v == null ? '' : String(v));
const blank = (v) => str(v).trim() === '';

export function wordCount(s) {
  const t = str(s).trim();
  return t ? t.split(/\s+/).length : 0;
}

export function meetingLabel(m) {
  return `${m.club_no} / ${m.term_no}. Toplantımız`;
}

export function defaultFolders({ issue_no, period, from, to, meetings, kunye, board } = {}) {
  const items = (meetings || [])
    .filter((m) => m && m.date >= from && m.date <= to)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.term_no || 0) - (b.term_no || 0)))
    .map((m) => ({
      id: uid(),
      kind: 'toplanti',
      title: meetingLabel(m),
      label: meetingLabel(m),
      date: m.date,
      photos: [],
      star: null,
      notes: '',
      text: '',
    }));
  return {
    cover: { issue: issue_no, period: period || '', photo: null },
    kunye: { rows: [...(kunye || []), ...(board || [])].map((r) => ({ ...r })) },
    president: { photo: null, body: '', name: '', role: '' },
    board: [],
    corner: [],
    items,
  };
}

const page = (layout, fields) => ({ id: uid(), layout, fields });

function isStar(ref, star) {
  if (star == null || ref == null) return false;
  return ref === star || ref.path === star || (star.path != null && ref.path === star.path);
}

function pickPhoto(it) {
  const photos = Array.isArray(it.photos) ? it.photos : [];
  return photos.find((p) => isStar(p, it.star)) ?? photos[0] ?? '';
}

const bodyOf = (it) => (blank(it.text) ? str(it.notes) : str(it.text));
const labelOf = (it) => str(it.label || it.title);

function pairs(list) {
  const out = [];
  for (let i = 0; i < list.length; i += 2) out.push(list.slice(i, i + 2));
  return out;
}

export function assemblePages(folders) {
  const f = folders || {};
  const cover = f.cover || {};
  const pres = f.president || {};
  const pages = [];

  pages.push(page('kapak', {
    issue: cover.issue == null || cover.issue === '' ? '' : `Sayı ${cover.issue}`,
    period: str(cover.period),
    title: 'Başkan Mektubu',
    photo: cover.photo ?? '',
  }));
  pages.push(page('kunye', { rows: (f.kunye && f.kunye.rows) || [] }));
  pages.push(page('icindekiler', { items: [] }));
  pages.push(page('baskan', {
    photo: pres.photo ?? '',
    body: str(pres.body),
    name: str(pres.name),
    club: str(pres.club),
    role: str(pres.role),
  }));

  for (const g of pairs(f.board || [])) {
    if (g.length === 2) {
      pages.push(page('mesaj-2', {
        body1: str(g[0].body), name1: str(g[0].name), role1: str(g[0].role),
        body2: str(g[1].body), name2: str(g[1].name), role2: str(g[1].role),
      }));
    } else {
      pages.push(page('mesaj-1', {
        body: str(g[0].body), name: str(g[0].name), role: str(g[0].role), photo: g[0].photo ?? '',
      }));
    }
  }

  for (const g of pairs(f.corner || [])) {
    const [a, b = {}] = g;
    pages.push(page('kose', {
      body1: str(a.body), name1: str(a.name), role1: str(a.role), photo1: a.photo ?? '',
      body2: str(b.body), name2: str(b.name), role2: str(b.role), photo2: b.photo ?? '',
    }));
  }

  const items = f.items || [];
  const isLong = (it) => wordCount(bodyOf(it)) > LONG_WORDS;
  let pending = null; // bekleyen kısa madde: {idx, item}
  for (const it of items) {
    if (isLong(it)) {
      pages.push(page('neler-tam', {
        label: labelOf(it),
        body: bodyOf(it),
        photos: (it.photos || []).slice(0, MAX_FULL_PHOTOS),
      }));
    } else if (pending) {
      const a = pending.item;
      pages[pending.idx] = { id: pages[pending.idx].id, layout: 'neler-2', fields: {
        label1: labelOf(a), photo1: pickPhoto(a), body1: bodyOf(a),
        label2: labelOf(it), photo2: pickPhoto(it), body2: bodyOf(it),
      } };
      pending = null;
    } else {
      pending = { idx: pages.length, item: it };
      pages.push(page('neler-1', { label: labelOf(it), photo: pickPhoto(it), body: bodyOf(it) }));
    }
  }
  return pages;
}

export function missingFor(folders) {
  const f = folders || {};
  const out = [];
  if (blank(f.president && f.president.body)) out.push('Başkan Mektubu: metin yok');
  for (const it of f.items || []) {
    const name = `«${str(it.title || it.label)}»`;
    if (!(it.photos && it.photos.length)) out.push(`${name}: fotoğraf yok`);
    if (blank(it.notes) && blank(it.text)) out.push(`${name}: açıklama yok`);
  }
  return out;
}
