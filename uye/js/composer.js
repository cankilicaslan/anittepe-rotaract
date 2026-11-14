// Instagram gönderi hazırlayıcı (Halkla İlişkiler paneli)
// API: mountComposer(root, { store, me, toast, readOnly }) → { destroy() }
// Kullanılan store metotları: getTerm, listMeetings, listPosts, savePost,
// generateCaption, publishInstagram.

const W = 1080;
const H = 1350;
const PHOTO_H = 880;
const M = 72;
const FONT = '"Open Sans", system-ui, sans-serif';

const C = {
  cran: '#D41367',
  deep: '#A30C4D',
  soft: '#FCE6EF',
  ink: '#1E1420',
  gold: '#F7A81B',
  body: '#4A3A4F',
  muted: '#7A6A7F',
  line: '#EEDDE5',
};

const TYPES = [
  { id: 'toplanti', label: 'Toplantı', badge: 'TOPLANTI' },
  { id: 'ocakbasi', label: 'Ocakbaşı', badge: 'OCAKBAŞI' },
  { id: 'proje', label: 'Proje', badge: 'PROJE' },
  { id: 'etkinlik', label: 'Etkinlik', badge: 'ETKİNLİK' },
];
const TYPE_BY_ID = Object.fromEntries(TYPES.map((t) => [t.id, t]));

const STATUS_LABEL = { taslak: 'Taslak', paylasildi: 'Paylaşıldı', hata: 'Hata' };

const LOGO_URL = new URL('../../assets/logo-cranberry.webp', import.meta.url).href;

// Kapak şablonları: saydam PNG/WEBP katmanı fotoğrafın üstüne biner (logo katmanın içinde).
const TEMPLATES = [
  { id: 'kavis', label: 'Kavisli', url: new URL('../../assets/ig/tpl-kavis.webp', import.meta.url).href },
  { id: 'gradyan', label: 'Gradyan', url: new URL('../../assets/ig/tpl-gradyan.webp', import.meta.url).href },
];
const FITS = [
  { id: 'cover', label: 'Doldur' },
  { id: 'w', label: 'Enine sığdır' },
  { id: 'h', label: 'Boyuna sığdır' },
];
const ZOOM_MIN = 0.4;

// ---------- küçük yardımcılar ----------

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, String(v));
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

let uidCounter = 0;
const uid = (p) => `cmp-${p}-${++uidCounter}`;

function todayISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function parseDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v));
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatTR(v) {
  const d = parseDate(v);
  if (!d) return '';
  return new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
}

function toInt(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Görsel yüklenemedi'));
    img.src = src;
  });
}

// Logodaki saydam kenar boşluklarını kırpar (logo dosyasının solunda geniş boşluk var).
function trimLogo(img) {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  try {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0);
    const data = x.getImageData(0, 0, w, h).data;
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y += 2) {
      for (let xx = 0; xx < w; xx += 2) {
        const i = (y * w + xx) * 4;
        const a = data[i + 3];
        const r = data[i], g = data[i + 1], b = data[i + 2];
        // saydam değil ve beyaz değilse içerik say
        if (a > 24 && !(r > 245 && g > 245 && b > 245)) {
          if (xx < minX) minX = xx;
          if (xx > maxX) maxX = xx;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return { img, sx: 0, sy: 0, sw: w, sh: h };
    minX = Math.max(0, minX - 2); minY = Math.max(0, minY - 2);
    maxX = Math.min(w - 1, maxX + 2); maxY = Math.min(h - 1, maxY + 2);
    return { img, sx: minX, sy: minY, sw: maxX - minX + 1, sh: maxY - minY + 1 };
  } catch {
    return { img, sx: 0, sy: 0, sw: w, sh: h };
  }
}

// Metni satırlara böler; maxLines aşılırsa son satıra üç nokta koyar.
function wrapText(ctx, text, maxW, maxLines) {
  const paragraphs = String(text || '').split(/\n+/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const lines = [];
  for (const para of paragraphs) {
    let cur = '';
    for (let word of para.split(' ')) {
      // tek kelime bile sığmıyorsa harf harf böl
      while (ctx.measureText(word).width > maxW) {
        let i = word.length - 1;
        while (i > 1 && ctx.measureText(word.slice(0, i)).width > maxW) i--;
        if (cur) { lines.push(cur); cur = ''; }
        lines.push(word.slice(0, i));
        word = word.slice(i);
      }
      const test = cur ? `${cur} ${word}` : word;
      if (ctx.measureText(test).width <= maxW) cur = test;
      else { if (cur) lines.push(cur); cur = word; }
    }
    if (cur) lines.push(cur);
  }
  if (lines.length > maxLines) {
    const out = lines.slice(0, maxLines);
    let last = out[maxLines - 1];
    // önce kelime sınırından kes; tek kelime kaldıysa harf harf
    while (ctx.measureText(`${last}…`).width > maxW) {
      const sp = last.lastIndexOf(' ');
      last = sp > 0 ? last.slice(0, sp) : last.slice(0, -1);
      if (!last) break;
    }
    out[maxLines - 1] = `${last.replace(/[\s,.;:–-]+$/, '')}…`;
    return out;
  }
  return lines;
}

function setSpacing(ctx, px) {
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${px}px`;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

async function ensureFonts() {
  if (!document.fonts || !document.fonts.load) return;
  const sample = 'İıŞşĞğÜüÖöÇç Toplantı 0123456789';
  try {
    await Promise.all(
      ['300 30px', '400 30px', '600 30px', '700 30px', '800 80px'].map((f) => document.fonts.load(`${f} "Open Sans"`, sample)),
    );
  } catch { /* yazı tipi yüklenemezse sistem yazı tipiyle devam */ }
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Görsel oluşturulamadı'))), 'image/jpeg', 0.9);
    } catch (e) {
      reject(new Error('Görsel dışa aktarılamadı (tarayıcı güvenlik kısıtı).'));
    }
  });
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = el('textarea', { style: 'position:fixed;left:-9999px;top:0', 'aria-hidden': 'true' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

// ---------- ana bileşen ----------

export function mountComposer(root, { store, me = null, toast = () => {}, readOnly = false } = {}) {
  const state = {
    type: 'toplanti',
    term: null,
    meetings: [],
    posts: [],
    term_no: null,
    club_no: null,
    ocakbasi_no: 1,
    host: '', // ocakbaşı ev sahibi (yalnızca açıklamaya gider)
    hybridhub: true, // toplantı HybridHub'da mı yapıldı
    members: [],
    date: todayISO(),
    dateEdited: false,
    text: { toplanti: '', ocakbasi: '', proje: '', etkinlik: '' },
    caption: '',
    captionSource: null,
    photo: null, // { img, url, name }
    pos: { x: 0.5, y: 0.5 },
    zoom: 1,
    fit: 'cover', // cover | w (enine sığdır) | h (boyuna sığdır)
    tpl: 'kavis', // kapak hep kavisli, ek sayfalar hep gradyan
    tplImg: {},
    title1: '', // şablon başlıkları; boşsa türden otomatik
    title2: '',
    // Kaydırmalı gönderi: kapaktan sonraki sayfalar [{ img, url, name, pos, zoom }]
    extra: [],
    cur: 0, // önizlemedeki sayfa: 0 = kapak, 1.. = ek sayfalar
    logo: null,
    fontsReady: false,
    busy: false,
  };

  let raf = 0;
  let destroyed = false;

  // ----- DOM -----
  root.classList.add('cmp');
  root.replaceChildren();

  const fileInput = el('input', { type: 'file', accept: 'image/*', class: 'cmp-file', tabindex: '-1', 'aria-hidden': 'true' });

  // Fotoğraf alanı (tüm türlerde aynı, en üstte)
  const dzThumb = el('div', { class: 'cmp-dz-thumb', 'aria-hidden': 'true' });
  const dzTitle = el('strong', { class: 'cmp-dz-title', text: 'Fotoğrafı buraya sürükleyin' });
  const dzSub = el('span', { class: 'cmp-dz-sub', text: 'ya da tıklayıp seçin · panodan yapıştırabilirsiniz (Ctrl+V)' });
  const dropzone = el('div', {
    class: 'cmp-dropzone',
    role: 'button',
    tabindex: '0',
    'aria-label': 'Fotoğraf seç: tıklayın, Enter’a basın, sürükleyip bırakın veya yapıştırın',
  }, dzThumb, el('div', { class: 'cmp-dz-text' }, dzTitle, dzSub));

  const zoomId = uid('zoom');
  const zoomInput = el('input', { id: zoomId, type: 'range', min: String(ZOOM_MIN), max: '3', step: '0.01', value: '1', disabled: true });
  const centerBtn = el('button', { type: 'button', class: 'cmp-btn cmp-btn-ghost cmp-btn-sm', disabled: true, text: 'Ortala' });
  const removeBtn = el('button', { type: 'button', class: 'cmp-btn cmp-btn-ghost cmp-btn-sm', disabled: true, text: 'Fotoğrafı kaldır' });
  const fitBtns = FITS.map((f) => el('button', { type: 'button', class: 'cmp-seg-btn', 'data-fit': f.id, 'aria-pressed': String(f.id === 'cover'), disabled: true, text: f.label }));
  const fitSeg = el('div', { class: 'cmp-seg cmp-seg-sm', role: 'group', 'aria-label': 'Fotoğrafı çerçeveye yerleştir' }, fitBtns);
  const photoTools = el('div', { class: 'cmp-photo-tools' },
    fitSeg,
    el('label', { class: 'cmp-zoom', for: zoomId }, el('span', { text: 'Boyut' }), zoomInput),
    el('div', { class: 'cmp-photo-btns' }, centerBtn, removeBtn),
  );
  const photoHint = el('p', { class: 'cmp-hint', text: 'Fotoğrafı önizlemede sürükleyerek konumlandırın (ok tuşları da olur). Küçülttüğünüzde ya da enine/boyuna sığdırdığınızda boş kalan yeri aynı fotoğrafın bulanık hâli doldurur.' });

  // Ek sayfalar (kaydırmalı gönderi)
  const extraInput = el('input', { type: 'file', accept: 'image/*', multiple: true, class: 'cmp-file', tabindex: '-1', 'aria-hidden': 'true' });
  const extraList = el('ul', { class: 'cmp-extra-list', 'aria-label': 'Ek sayfalar' });
  const extraAdd = el('button', { type: 'button', class: 'cmp-btn cmp-btn-soft cmp-btn-sm', text: '+ Sayfa ekle' });
  const extraCount = el('span', { class: 'cmp-extra-count', text: '' });
  const extraTitle = el('strong', { text: 'Ek sayfalar' });
  const extraSection = el('div', { class: 'cmp-extra' },
    el('div', { class: 'cmp-extra-head' }, extraTitle, extraCount),
    el('p', { class: 'cmp-hint', text: 'Kaydırmalı gönderi için kapaktan sonra en fazla 9 fotoğraf ekleyin; her biri ayrı sayfa olur. Birden fazla fotoğrafı aynı anda seçebilir ya da buraya sürükleyebilirsiniz.' }),
    extraList, extraAdd, extraInput,
  );

  const photoSection = el('section', { class: 'cmp-photo', 'aria-label': 'Fotoğraf' }, dropzone, photoTools, photoHint, fileInput, extraSection);

  // Tür seçici
  const typeBtns = TYPES.map((t) =>
    el('button', { type: 'button', class: 'cmp-seg-btn', 'data-type': t.id, 'aria-pressed': String(t.id === state.type), text: t.label }),
  );
  const segmented = el('div', { class: 'cmp-seg', role: 'group', 'aria-label': 'Gönderi türü' }, typeBtns);

  // Türe özel alanlar
  const termId = uid('term');
  const ocakId = uid('ocak');
  const dateId = uid('date');

  const termInput = el('select', { id: termId });
  const hubInput = el('input', { type: 'checkbox', checked: true });
  const ocakInput = el('input', { id: ocakId, type: 'number', min: '1', inputmode: 'numeric' });
  const hostId = uid('host');
  const hostSel = el('select', { id: hostId }, el('option', { value: '', text: 'Ev sahibini seçin' }));
  const dateInput = el('input', { id: dateId, type: 'date' });

  const textAreas = {};
  const mkText = (type, label, placeholder, rows = 4) => {
    const id = uid(`txt-${type}`);
    const ta = el('textarea', { id, rows: String(rows), maxlength: '600', placeholder });
    textAreas[type] = ta;
    return el('div', { class: 'cmp-field' }, el('label', { for: id, text: label }), ta);
  };

  const groups = {
    toplanti: el('div', { class: 'cmp-group', 'data-for': 'toplanti' },
      el('div', { class: 'cmp-row' },
        el('div', { class: 'cmp-field' }, el('label', { for: termId, text: 'Toplantı' }), termInput,
          el('p', { class: 'cmp-hint', text: 'Kulüp ve dönem numaraları toplantı listesinden otomatik gelir.' })),
        el('label', { class: 'cmp-check' }, hubInput, el('span', { text: 'Toplantı HybridHub’da mı yapıldı?' })),
      ),
      mkText('toplanti', 'Toplantıda neler yaptık?', 'Kısaca: konuşmacı, konu, alınan kararlar…'),
    ),
    ocakbasi: el('div', { class: 'cmp-group', 'data-for': 'ocakbasi', hidden: true },
      el('div', { class: 'cmp-row' },
        el('div', { class: 'cmp-field' }, el('label', { for: ocakId, text: 'Dönemin kaçıncı ocakbaşı' }), ocakInput),
        el('div', { class: 'cmp-field' }, el('label', { for: hostId, text: 'Ev sahibi' }), hostSel),
      ),
      mkText('ocakbasi', 'Kısa açıklama', 'Nerede buluştuk, neler konuştuk…'),
    ),
    proje: el('div', { class: 'cmp-group', 'data-for': 'proje', hidden: true },
      mkText('proje', 'Kısa açıklama', 'Ne yaptık, kimlerle, nerede, sonuç ne oldu? Kısa notlar yeterli; yapay zekâ bunlardan düzgün bir açıklama yazar.'),
    ),
    etkinlik: el('div', { class: 'cmp-group', 'data-for': 'etkinlik', hidden: true },
      mkText('etkinlik', 'Kısa açıklama', 'Ne yaptık, kimlerle, nerede, sonuç ne oldu? Kısa notlar yeterli; yapay zekâ bunlardan düzgün bir açıklama yazar.'),
    ),
  };
  const dateField = el('div', { class: 'cmp-field cmp-field-date' }, el('label', { for: dateId, text: 'Görseldeki tarih' }), dateInput);

  // Kapak şablonu ve şablon başlıkları
  const t1Id = uid('t1');
  const t2Id = uid('t2');
  const title1Input = el('input', { id: t1Id, type: 'text', maxlength: '40' });
  const title2Input = el('input', { id: t2Id, type: 'text', maxlength: '40' });
  const titleFields = el('div', { class: 'cmp-row cmp-titles' },
    el('div', { class: 'cmp-field' }, el('label', { for: t1Id, text: 'Başlık 1. satır (ince)' }), title1Input),
    el('div', { class: 'cmp-field' }, el('label', { for: t2Id, text: 'Başlık 2. satır (kalın)' }), title2Input),
  );
  const tplSection = el('div', { class: 'cmp-tpl' },
    titleFields,
    el('p', { class: 'cmp-hint', text: 'Kapakta (1. sayfa) kavisli şablon, sonraki sayfalarda gradyan şablon kullanılır. Başlıklar boşsa türe göre otomatik yazılır.' }),
  );

  // Açıklama (caption)
  const capId = uid('caption');
  const captionTa = el('textarea', { id: capId, rows: '8', maxlength: '2200', placeholder: 'Gönderi açıklaması… Yapay zekâ ile yazdırabilir, sonra düzenleyebilirsiniz.' });
  const aiBtn = el('button', { type: 'button', class: 'cmp-btn cmp-btn-soft' }, el('span', { class: 'cmp-spark', 'aria-hidden': 'true', text: '✦' }), ' Yapay zekâ ile açıklama yaz');
  const capNote = el('p', { class: 'cmp-note', hidden: true, text: 'Demo modunda şablonla yazıldı' });
  const capCount = el('span', { class: 'cmp-count', 'aria-live': 'off', text: '0 / 2200' });
  const captionSection = el('section', { class: 'cmp-caption', 'aria-label': 'Gönderi açıklaması' },
    el('div', { class: 'cmp-caption-head' }, el('label', { for: capId, text: 'Gönderi açıklaması' }), capCount),
    captionTa,
    el('div', { class: 'cmp-caption-foot' }, aiBtn, capNote),
  );

  // Eylemler
  const publishBtn = el('button', { type: 'button', class: 'cmp-btn cmp-btn-primary', text: 'Instagram’da paylaş' });
  const downloadBtn = el('button', { type: 'button', class: 'cmp-btn cmp-btn-ghost', text: 'Görseli indir' });
  const actions = el('div', { class: 'cmp-actions' }, publishBtn, downloadBtn);
  const readOnlyNote = readOnly
    ? el('p', { class: 'cmp-readonly', role: 'note', text: 'Salt okunur görünüm: geçmiş dönem başkanı olarak gönderileri görebilir, görsel indirebilirsiniz; paylaşım yapamazsınız.' })
    : null;
  const resultBox = el('div', { class: 'cmp-result', hidden: true, tabindex: '-1' });

  const controls = el('div', { class: 'cmp-controls' },
    el('section', { class: 'cmp-type', 'aria-label': 'Tür ve içerik' }, segmented, groups.toplanti, groups.ocakbasi, groups.proje, groups.etkinlik, dateField, tplSection),
    captionSection,
    readOnlyNote,
    actions,
    resultBox,
  );

  // Önizleme
  const canvas = el('canvas', {
    class: 'cmp-canvas',
    width: String(W),
    height: String(H),
    tabindex: '0',
    role: 'img',
    'aria-label': 'Gönderi önizlemesi (1080×1350)',
  });
  const ctx = canvas.getContext('2d');
  const pagePrev = el('button', { type: 'button', class: 'cmp-btn cmp-btn-ghost cmp-btn-sm', 'aria-label': 'Önceki sayfa', text: '‹' });
  const pageNext = el('button', { type: 'button', class: 'cmp-btn cmp-btn-ghost cmp-btn-sm', 'aria-label': 'Sonraki sayfa', text: '›' });
  const pageLabel = el('span', { class: 'cmp-pager-label', 'aria-live': 'polite', text: '' });
  const pager = el('div', { class: 'cmp-pager', hidden: true }, pagePrev, pageLabel, pageNext);
  const previewCap = el('p', { class: 'cmp-preview-cap', text: '1080 × 1350 · Instagram dikey gönderi' });
  const preview = el('aside', { class: 'cmp-preview', 'aria-label': 'Canlı önizleme' },
    el('div', { class: 'cmp-preview-frame' }, canvas),
    pager,
    previewCap,
  );

  // Geçmiş
  const historyList = el('ul', { class: 'cmp-history-list' });
  const historyEmpty = el('p', { class: 'cmp-empty', text: 'Henüz gönderi yok.' });
  const history = el('section', { class: 'cmp-history', 'aria-labelledby': uid('h') },
    el('h3', { class: 'cmp-h', text: 'Önceki gönderiler' }),
    historyEmpty,
    historyList,
  );
  history.querySelector('h3').id = history.getAttribute('aria-labelledby');

  const grid = el('div', { class: 'cmp-grid' }, photoSection, preview, controls);
  root.append(grid, history);

  if (readOnly) {
    publishBtn.disabled = true;
    aiBtn.disabled = true;
    publishBtn.title = 'Salt okunur: paylaşım yetkiniz yok';
  }

  // ----- çizim -----

  function scheduleRender() {
    if (raf || destroyed) return;
    raf = requestAnimationFrame(() => { raf = 0; draw(); });
  }

  // Önizlemedeki sayfanın fotoğrafı: kapakta üst alan (PHOTO_H), ek sayfalarda alt marka şeridine kadar tüm alan.
  const EXTRA_H = H;
  const isTpl = () => state.tpl !== 'klasik';
  // Kapakta fotoğraf çerçevesi: şablonda tüm sayfa, klasikte üst alan.
  const coverH = () => (isTpl() ? H : PHOTO_H);
  function active() {
    if (state.cur === 0) {
      return state.photo ? {
        img: state.photo.img, h: coverH(), pos: state.pos,
        get zoom() { return state.zoom; }, set zoom(v) { state.zoom = v; },
        get fit() { return state.fit; }, set fit(v) { state.fit = v; },
        reset() { state.pos = { x: 0.5, y: 0.5 }; state.zoom = 1; },
      } : null;
    }
    const s = state.extra[state.cur - 1];
    return s ? {
      img: s.img, h: EXTRA_H, pos: s.pos,
      get zoom() { return s.zoom; }, set zoom(v) { s.zoom = v; },
      get fit() { return s.fit; }, set fit(v) { s.fit = v; },
      reset() { s.pos = { x: 0.5, y: 0.5 }; s.zoom = 1; },
    } : null;
  }

  // Fotoğrafın çerçevedeki yeri. ox/oy < 0 ise fotoğraf çerçeveden küçüktür (boşluk kalır).
  function photoGeom(a = active()) {
    const { img } = a;
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const base = a.fit === 'w' ? W / iw : a.fit === 'h' ? a.h / ih : Math.max(W / iw, a.h / ih);
    const s = base * a.zoom;
    const dw = iw * s;
    const dh = ih * s;
    const ox = dw - W;
    const oy = dh - a.h;
    return { dw, dh, ox, oy, dx: -ox * a.pos.x, dy: -oy * a.pos.y };
  }

  // Çerçeveyi doldurmayan fotoğrafın arkasına aynı fotoğrafı güçlü bulanık yerleştirir.
  // ctx.filter her tarayıcıda yok; küçültüp büyütme hilesi her yerde çalışır.
  const blurCanvas = document.createElement('canvas');
  function drawFramed(a, y0 = 0) {
    const g = photoGeom(a);
    const fh = a.h;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, y0, W, fh);
    ctx.clip();
    ctx.fillStyle = C.ink;
    ctx.fillRect(0, y0, W, fh);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (g.ox < -0.5 || g.oy < -0.5) {
      const iw = a.img.naturalWidth || a.img.width;
      const ih = a.img.naturalHeight || a.img.height;
      const cs = Math.max(W / iw, fh / ih);
      const k = 1 / 28; // ~%70 bulanıklık
      blurCanvas.width = Math.max(2, Math.round(W * k));
      blurCanvas.height = Math.max(2, Math.round(fh * k));
      const b = blurCanvas.getContext('2d');
      b.imageSmoothingEnabled = true;
      b.imageSmoothingQuality = 'high';
      b.drawImage(a.img, (W - iw * cs) / 2 * k, (fh - ih * cs) / 2 * k, iw * cs * k, ih * cs * k);
      ctx.drawImage(blurCanvas, -W * 0.03, y0 - fh * 0.03, W * 1.06, fh * 1.06);
    }
    ctx.drawImage(a.img, g.dx, y0 + g.dy, g.dw, g.dh);
    ctx.restore();
  }

  // Ek sayfa: fotoğraf tam sayfa, altta kapakla aynı marka şeridi ve küçük sayfa numarası.
  // Ek sayfa: fotoğraf tam sayfa, üstte gradyan şablon katmanı.
  function drawExtra(s) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    setSpacing(ctx, 0);
    drawFramed({ img: s.img, h: EXTRA_H, pos: s.pos, zoom: s.zoom, fit: s.fit });
    const layer = state.tplImg.gradyan;
    if (layer) ctx.drawImage(layer, 0, 0, W, H);
  }

  function drawPhoto() {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, PHOTO_H);
    ctx.clip();
    if (state.photo) {
      drawFramed({ img: state.photo.img, h: PHOTO_H, pos: state.pos, zoom: state.zoom, fit: state.fit });
      // alt kenarda hafif gölge: rozet fotoğrafın üzerine taşarken okunaklı kalsın
      const grad = ctx.createLinearGradient(0, PHOTO_H - 140, 0, PHOTO_H);
      grad.addColorStop(0, 'rgba(30,20,32,0)');
      grad.addColorStop(1, 'rgba(30,20,32,0.18)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, PHOTO_H - 140, W, 140);
    } else {
      ctx.fillStyle = C.soft;
      ctx.fillRect(0, 0, W, PHOTO_H);
      // ince kesik çerçeve
      ctx.strokeStyle = 'rgba(212,19,103,0.35)';
      ctx.lineWidth = 4;
      ctx.setLineDash([18, 14]);
      roundRect(ctx, M / 2, M / 2, W - M, PHOTO_H - M, 28);
      ctx.stroke();
      ctx.setLineDash([]);
      // simge
      const cx = W / 2, cy = 360;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(cx, cy, 78, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = C.cran;
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      roundRect(ctx, cx - 40, cy - 28, 80, 60, 10);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - 34, cy + 24);
      ctx.lineTo(cx - 10, cy - 2);
      ctx.lineTo(cx + 6, cy + 12);
      ctx.lineTo(cx + 16, cy + 4);
      ctx.lineTo(cx + 34, cy + 24);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx + 18, cy - 12, 6, 0, Math.PI * 2);
      ctx.fillStyle = C.cran;
      ctx.fill();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = C.deep;
      ctx.font = `700 44px ${FONT}`;
      ctx.fillText('Fotoğrafı buraya sürükleyin', cx, 520);
      ctx.font = `400 30px ${FONT}`;
      ctx.fillStyle = 'rgba(163,12,77,0.75)';
      ctx.fillText('ya da tıklayıp seçin', cx, 572);
    }
    ctx.restore();
  }

  function contentFor() {
    const t = state.type;
    const txt = state.text[t] || '';
    if (t === 'toplanti') {
      return {
        headline: [state.term_no ? `${state.term_no}. Toplantı` : 'Toplantı'],
        sub: state.club_no ? `Kulübümüzün ${state.club_no}. toplantısı` : '',
        body: txt,
      };
    }
    if (t === 'ocakbasi') {
      return { headline: [state.ocakbasi_no ? `${state.ocakbasi_no}. Ocakbaşı` : 'Ocakbaşı'], sub: '', body: txt };
    }
    const lines = txt.split('\n');
    const idx = lines.findIndex((l) => l.trim());
    if (idx < 0) return { headline: [TYPE_BY_ID[t].label], sub: '', body: '', placeholderHead: true };
    return { headline: lines[idx].trim(), sub: '', body: lines.slice(idx + 1).join('\n') };
  }

  // Şablon başlıkları: kullanıcı yazmadıysa türden üretilir.
  function autoTitles() {
    const t = state.type;
    if (t === 'toplanti') {
      return [state.club_no ? `Kulübümüzün ${state.club_no}.` : 'Kulübümüzün', state.term_no ? `Dönemimizin ${state.term_no}. Toplantısı` : 'Toplantısı'];
    }
    if (t === 'ocakbasi') return ['Dönemin', state.ocakbasi_no ? `${state.ocakbasi_no}. Ocakbaşı` : 'Ocakbaşı'];
    return ['', 'Başlık']; // proje/etkinlik: tür yazısı yok; başlığı kullanıcı yazar
  }
  function titles() {
    const a = autoTitles();
    if (state.type === 'toplanti' || state.type === 'ocakbasi') return a; // toplantı ve ocakbaşı başlığı otomatik
    return [state.title1.trim() || a[0], state.title2.trim() || a[1]];
  }

  // Metni verilen genişliğe sığana kadar küçültür.
  function fitFont(text, weight, size, min, maxW) {
    let s = size;
    ctx.font = `${weight} ${s}px ${FONT}`;
    while (s > min && ctx.measureText(text).width > maxW) { s -= 2; ctx.font = `${weight} ${s}px ${FONT}`; }
    return s;
  }

  function drawTemplate() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    setSpacing(ctx, 0);
    const a = active();
    if (a) {
      drawFramed(a);
    } else {
      ctx.fillStyle = C.soft;
      ctx.fillRect(0, 0, W, H);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = C.deep;
      ctx.font = `700 44px ${FONT}`;
      ctx.fillText('Fotoğrafı buraya sürükleyin', W / 2, 860);
      ctx.font = `400 30px ${FONT}`;
      ctx.fillStyle = 'rgba(163,12,77,0.75)';
      ctx.fillText('ya da tıklayıp seçin', W / 2, 912);
    }
    const layer = state.tplImg[state.tpl];
    if (layer) ctx.drawImage(layer, 0, 0, W, H);

    const [t1, t2] = titles();
    ctx.save();
    ctx.fillStyle = '#FFFFFF';
    ctx.textBaseline = 'alphabetic';
    if (state.tpl === 'kavis') {
      // şablondaki "Başlık" yerleri: sol üst, ince + kalın
      ctx.shadowColor = 'rgba(110,0,40,0.35)';
      ctx.shadowBlur = 14;
      ctx.shadowOffsetY = 4;
      ctx.textAlign = 'left';
      const x = 65, maxW = W - x - 60;
      fitFont(t1, 300, 74, 40, maxW);
      setSpacing(ctx, -0.5);
      if (t1) ctx.fillText(t1, x, 177);
      fitFont(t2, 700, 98, 48, maxW);
      setSpacing(ctx, -1.5);
      ctx.fillText(t2, x - 2, t1 ? 273 : 230);
    } else {
      // gradyan: logonun altında ortalı
      ctx.shadowColor = 'rgba(40,0,20,0.45)';
      ctx.shadowBlur = 18;
      ctx.shadowOffsetY = 3;
      ctx.textAlign = 'center';
      const maxW = W - 120;
      fitFont(t1, 300, 60, 34, maxW);
      setSpacing(ctx, -0.5);
      if (t1) ctx.fillText(t1, W / 2, 262);
      fitFont(t2, 700, 86, 44, maxW);
      setSpacing(ctx, -1.5);
      ctx.fillText(t2, W / 2, t1 ? 352 : 300);
    }
    ctx.restore();
    setSpacing(ctx, 0);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  function draw() {
    if (state.cur > 0 && state.extra[state.cur - 1]) {
      drawExtra(state.extra[state.cur - 1]);
      return;
    }
    if (isTpl()) { drawTemplate(); return; }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    setSpacing(ctx, 0);

    // alt panel
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, PHOTO_H, W, H - PHOTO_H);

    drawPhoto();

    const maxW = W - M * 2;

    // tür rozeti — fotoğraf ile panel sınırının üzerine oturur
    const badge = TYPE_BY_ID[state.type].badge;
    ctx.font = `700 26px ${FONT}`;
    setSpacing(ctx, 4);
    const tw = ctx.measureText(badge).width;
    const ph = 58;
    const pw = Math.ceil(tw + 60);
    const py = PHOTO_H - ph / 2;
    ctx.save();
    ctx.shadowColor = 'rgba(163,12,77,0.28)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = C.cran;
    roundRect(ctx, M, py, pw, ph, ph / 2);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    // letterSpacing sonda da boşluk bırakır; ortalamak için yarısını telafi et
    ctx.fillText(badge, M + 30 + 2, PHOTO_H + 2);
    setSpacing(ctx, 0);

    // başlık
    const content = contentFor();
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    let y;
    let headLines;
    if (Array.isArray(content.headline)) {
      ctx.font = `800 84px ${FONT}`;
      setSpacing(ctx, -1);
      headLines = wrapText(ctx, content.headline[0], maxW, 1);
      ctx.fillStyle = C.ink;
      y = PHOTO_H + 29 + 40 + 61;
      ctx.fillText(headLines[0] || '', M, y);
    } else {
      // proje / etkinlik: açıklamanın ilk satırı başlık
      ctx.font = `800 72px ${FONT}`;
      setSpacing(ctx, -1);
      headLines = wrapText(ctx, content.headline, maxW, 2);
      if (headLines.length === 1 && ctx.measureText(headLines[0]).width < maxW * 0.9) {
        // tek satırsa biraz daha büyük
        ctx.font = `800 80px ${FONT}`;
        headLines = wrapText(ctx, content.headline, maxW, 1);
      }
      ctx.fillStyle = C.ink;
      y = PHOTO_H + 29 + 40 + 55;
      headLines.forEach((l, i) => ctx.fillText(l, M, y + i * 82));
      y += (headLines.length - 1) * 82;
    }
    setSpacing(ctx, 0);

    // alt başlık
    if (content.sub) {
      ctx.font = `600 34px ${FONT}`;
      ctx.fillStyle = C.cran;
      y += 52;
      ctx.fillText(content.sub, M, y);
    }

    // gövde metni
    const LIMIT = 1200;
    const LH = 42;
    if (content.body && content.body.trim()) {
      ctx.font = `400 31px ${FONT}`;
      ctx.fillStyle = C.body;
      const first = y + (content.sub ? 54 : 62);
      const maxLines = clamp(Math.floor((LIMIT - first) / LH) + 1, 1, 4);
      const lines = wrapText(ctx, content.body, maxW, maxLines);
      lines.forEach((l, i) => ctx.fillText(l, M, first + i * LH));
    }

    // alt şerit: ayraç, logo, tarih
    const divY = 1234;
    ctx.fillStyle = C.line;
    ctx.fillRect(M, divY, maxW, 2);

    const stripMid = divY + (H - 14 - divY) / 2 + 1;
    if (state.logo) {
      const { img, sx, sy, sw, sh } = state.logo;
      let lh = 76;
      let lw = (sw / sh) * lh;
      if (lw > 520) { lw = 520; lh = (sh / sw) * lw; }
      ctx.drawImage(img, sx, sy, sw, sh, M, stripMid - lh / 2, lw, lh);
    } else {
      ctx.font = `700 30px ${FONT}`;
      ctx.fillStyle = C.cran;
      ctx.textBaseline = 'middle';
      ctx.fillText('Rotaract Ankara Anıttepe', M, stripMid);
    }
    const dateText = formatTR(state.date);
    if (dateText) {
      ctx.font = `600 28px ${FONT}`;
      ctx.fillStyle = C.muted;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(dateText, W - M, stripMid);
    }

    // en altta marka şeridi
    ctx.fillStyle = C.cran;
    ctx.fillRect(0, H - 14, W, 14);
    ctx.fillStyle = C.gold;
    ctx.fillRect(W - M - 120, H - 14, 120, 14);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  // ----- fotoğraf -----

  async function setPhotoFile(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) {
      toast('Lütfen bir görsel dosyası seçin (JPG, PNG, WEBP).', 'error');
      return;
    }
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      if (destroyed) { URL.revokeObjectURL(url); return; }
      // ek sayfa seçiliyse o sayfanın fotoğrafı değişir
      const page = state.cur > 0 ? state.extra[state.cur - 1] : null;
      if (page) {
        URL.revokeObjectURL(page.url);
        Object.assign(page, { img, url, name: file.name || 'gorsel', pos: { x: 0.5, y: 0.5 }, zoom: 1, fit: 'cover' });
        zoomInput.value = '1';
        renderExtra();
        showPage(state.cur);
        return;
      }
      if (state.photo) URL.revokeObjectURL(state.photo.url);
      state.photo = { img, url, name: file.name || 'yapistirilan-gorsel' };
      state.pos = { x: 0.5, y: 0.5 };
      state.zoom = 1;
      state.fit = 'cover';
      zoomInput.value = '1';
      renderExtra();
      showPage(0);
    } catch {
      URL.revokeObjectURL(url);
      toast('Bu görsel açılamadı. Farklı bir dosya deneyin (HEIC desteklenmeyebilir).', 'error');
    }
  }

  function clearPhoto() {
    if (state.photo) URL.revokeObjectURL(state.photo.url);
    state.photo = null;
    state.zoom = 1;
    state.fit = 'cover';
    state.pos = { x: 0.5, y: 0.5 };
    zoomInput.value = '1';
    renderExtra();
    updatePhotoUI();
    scheduleRender();
    dropzone.focus();
  }

  function updatePhotoUI() {
    const page = state.cur > 0 ? state.extra[state.cur - 1] : null;
    const cur = page || state.photo; // üstteki alan seçili sayfayı gösterir
    const has = !!cur;
    const act = !!active();
    dropzone.classList.toggle('has-photo', has);
    zoomInput.disabled = !act;
    centerBtn.disabled = !act;
    const fit = act ? active().fit : 'cover';
    fitBtns.forEach((b) => { b.disabled = !act; b.setAttribute('aria-pressed', String(b.dataset.fit === fit)); });
    removeBtn.disabled = !has;
    photoHint.hidden = !act;
    canvas.classList.toggle('can-drag', act);
    dzThumb.style.backgroundImage = has ? `url("${cur.url}")` : '';
    const pageName = page ? `${state.cur + 1}. sayfanın` : (state.extra.length ? 'Kapağın' : '');
    dzTitle.textContent = has ? (pageName ? `${pageName} fotoğrafını değiştir` : 'Fotoğrafı değiştir') : 'Fotoğrafı buraya sürükleyin';
    removeBtn.textContent = page ? 'Sayfayı kaldır' : 'Fotoğrafı kaldır';
    dzSub.textContent = has
      ? `${cur.name} · yeni bir fotoğraf sürükleyin, seçin ya da yapıştırın`
      : 'ya da tıklayıp seçin · panodan yapıştırabilirsiniz (Ctrl+V)';
  }

  const openPicker = () => fileInput.click();

  fileInput.addEventListener('change', () => {
    const f = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    setPhotoFile(f);
  });

  dropzone.addEventListener('click', openPicker);
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPicker(); }
  });

  function bindDrop(target, hoverEl) {
    let depth = 0;
    target.addEventListener('dragenter', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      hoverEl.classList.add('is-over');
    });
    target.addEventListener('dragover', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    target.addEventListener('dragleave', () => {
      depth = Math.max(0, depth - 1);
      if (!depth) hoverEl.classList.remove('is-over');
    });
    target.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      hoverEl.classList.remove('is-over');
      const f = [...e.dataTransfer.files].find((x) => /^image\//.test(x.type)) || e.dataTransfer.files[0];
      setPhotoFile(f);
    });
  }
  const hasFiles = (e) => !!e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
  bindDrop(dropzone, dropzone);
  bindDrop(preview, preview);

  function onPaste(e) {
    if (destroyed || !root.isConnected || root.offsetParent === null) return;
    const items = e.clipboardData ? [...e.clipboardData.items] : [];
    const item = items.find((i) => i.kind === 'file' && /^image\//.test(i.type));
    if (!item) return; // metin yapıştırmaya karışma
    e.preventDefault();
    setPhotoFile(item.getAsFile());
    toast('Panodaki görsel eklendi.', 'success');
  }
  document.addEventListener('paste', onPaste);

  zoomInput.addEventListener('input', () => {
    const a = active();
    if (!a) return;
    a.zoom = clamp(parseFloat(zoomInput.value) || 1, ZOOM_MIN, 3);
    scheduleRender();
  });
  centerBtn.addEventListener('click', () => {
    const a = active();
    if (a) a.reset();
    zoomInput.value = '1';
    scheduleRender();
  });
  removeBtn.addEventListener('click', () => (state.cur > 0 ? removeExtra(state.cur - 1) : clearPhoto()));
  fitSeg.addEventListener('click', (e) => {
    const b = e.target.closest('[data-fit]');
    const a = active();
    if (!b || !a) return;
    a.fit = b.dataset.fit;
    a.zoom = 1;
    a.pos.x = 0.5; a.pos.y = 0.5;
    zoomInput.value = '1';
    updatePhotoUI();
    scheduleRender();
  });

  // Önizlemede sürükleyerek konumlandırma
  let drag = null;
  const canvasPoint = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H, k: W / r.width };
  };
  canvas.addEventListener('pointerdown', (e) => {
    const p = canvasPoint(e);
    if (state.cur === 0 && p.y > coverH()) return;
    if (!active()) return; // boşsa click ile seçici açılır
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    drag = { id: e.pointerId, lx: e.clientX, ly: e.clientY, k: p.k };
    canvas.classList.add('is-dragging');
  });
  canvas.addEventListener('pointermove', (e) => {
    const a = active();
    if (drag && e.pointerId === drag.id && a) {
      const g = photoGeom(a);
      const dx = (e.clientX - drag.lx) * drag.k;
      const dy = (e.clientY - drag.ly) * drag.k;
      drag.lx = e.clientX;
      drag.ly = e.clientY;
      if (Math.abs(g.ox) > 0.5) a.pos.x = clamp(a.pos.x - dx / g.ox, 0, 1);
      if (Math.abs(g.oy) > 0.5) a.pos.y = clamp(a.pos.y - dy / g.oy, 0, 1);
      scheduleRender();
    } else {
      const p = canvasPoint(e);
      canvas.classList.toggle('over-photo', state.cur > 0 || p.y <= coverH());
    }
  });
  const endDrag = (e) => {
    if (drag && e.pointerId === drag.id) {
      drag = null;
      canvas.classList.remove('is-dragging');
    }
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('click', (e) => {
    if (state.cur !== 0 || state.photo) return;
    if (canvasPoint(e).y <= coverH()) openPicker();
  });
  canvas.addEventListener('keydown', (e) => {
    const a = active();
    if (!a) {
      if (state.cur === 0 && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openPicker(); }
      return;
    }
    const step = e.shiftKey ? 0.1 : 0.02;
    const map = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (map[e.key]) {
      e.preventDefault();
      a.pos.x = clamp(a.pos.x + map[e.key][0], 0, 1);
      a.pos.y = clamp(a.pos.y + map[e.key][1], 0, 1);
      scheduleRender();
    } else if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      a.zoom = clamp(a.zoom + 0.1, ZOOM_MIN, 3); zoomInput.value = String(a.zoom); scheduleRender();
    } else if (e.key === '-') {
      e.preventDefault();
      a.zoom = clamp(a.zoom - 0.1, ZOOM_MIN, 3); zoomInput.value = String(a.zoom); scheduleRender();
    }
  });

  // ----- ek sayfalar (kaydırmalı gönderi) -----

  const MAX_EXTRA = 9;
  async function addExtraFiles(files) {
    const list = [...files].filter((f) => /^image\//.test(f.type));
    if (!list.length) return;
    const room = MAX_EXTRA - state.extra.length;
    if (room <= 0) { toast('En fazla 10 sayfa olabilir (kapak + 9).', 'error'); return; }
    if (list.length > room) toast(`İlk ${room} fotoğraf eklendi; Instagram en fazla 10 sayfaya izin veriyor.`, 'error');
    for (const f of list.slice(0, room)) {
      const url = URL.createObjectURL(f);
      try {
        const img = await loadImage(url);
        if (destroyed) { URL.revokeObjectURL(url); return; }
        state.extra.push({ img, url, name: f.name || 'gorsel', pos: { x: 0.5, y: 0.5 }, zoom: 1, fit: 'cover' });
      } catch {
        URL.revokeObjectURL(url);
        toast(`${f.name || 'Bir görsel'} açılamadı (HEIC desteklenmeyebilir).`, 'error');
      }
    }
    renderExtra();
    showPage(state.extra.length);
  }

  function moveExtra(i, d) {
    const j = i + d;
    if (j < 0 || j >= state.extra.length) return;
    [state.extra[i], state.extra[j]] = [state.extra[j], state.extra[i]];
    renderExtra();
    showPage(j + 1);
  }

  function removeExtra(i) {
    const [s] = state.extra.splice(i, 1);
    if (s) URL.revokeObjectURL(s.url);
    renderExtra();
    showPage(Math.min(state.cur, state.extra.length));
  }

  function renderExtra() {
    extraCount.textContent = state.extra.length ? `${state.extra.length + 1} sayfa` : '';
    extraAdd.disabled = state.extra.length >= MAX_EXTRA;
    extraTitle.textContent = state.extra.length ? 'Sayfalar' : 'Ek sayfalar';
    // Kapak listenin başında görünür; yeri sabit olduğu için ok ve silme düğmesi yok.
    const cover = [];
    if (state.extra.length) {
      const ct = el('button', { type: 'button', class: 'cmp-extra-thumb', 'data-page': '0', 'aria-label': '1. sayfayı (kapak) önizle', 'aria-pressed': String(state.cur === 0) });
      if (state.photo) ct.style.backgroundImage = `url("${state.photo.url}")`;
      ct.addEventListener('click', () => showPage(0));
      cover.push(el('li', { class: 'cmp-extra-item' }, ct, el('span', { class: 'cmp-extra-no', text: '1' }), el('div', { class: 'cmp-extra-btns cmp-extra-cover', text: 'Kapak' })));
    }
    extraList.replaceChildren(...cover, ...state.extra.map((s, i) => {
      const thumb = el('button', { type: 'button', class: 'cmp-extra-thumb', 'data-page': String(i + 1), 'aria-label': `${i + 2}. sayfayı önizle`, 'aria-pressed': String(state.cur === i + 1) });
      thumb.style.backgroundImage = `url("${s.url}")`;
      thumb.addEventListener('click', () => showPage(i + 1));
      const left = el('button', { type: 'button', class: 'cmp-icon-btn', 'aria-label': `${i + 2}. sayfayı öne al`, disabled: i === 0, text: '←' });
      const right = el('button', { type: 'button', class: 'cmp-icon-btn', 'aria-label': `${i + 2}. sayfayı geriye al`, disabled: i === state.extra.length - 1, text: '→' });
      const del = el('button', { type: 'button', class: 'cmp-icon-btn cmp-icon-del', 'aria-label': `${i + 2}. sayfayı kaldır`, text: '×' });
      left.addEventListener('click', () => moveExtra(i, -1));
      right.addEventListener('click', () => moveExtra(i, 1));
      del.addEventListener('click', () => removeExtra(i));
      return el('li', { class: 'cmp-extra-item' }, thumb, el('span', { class: 'cmp-extra-no', text: `${i + 2}` }), el('div', { class: 'cmp-extra-btns' }, left, right, del));
    }));
    if (readOnly) extraSection.querySelectorAll('button').forEach((b) => { if (!b.classList.contains('cmp-extra-thumb')) b.disabled = true; });
  }

  function showPage(i) {
    state.cur = clamp(i, 0, state.extra.length);
    const total = state.extra.length + 1;
    pager.hidden = total < 2;
    pageLabel.textContent = state.cur === 0 ? `Kapak · 1 / ${total}` : `Sayfa ${state.cur + 1} / ${total}`;
    pagePrev.disabled = state.cur === 0;
    pageNext.disabled = state.cur >= total - 1;
    previewCap.textContent = total > 1 ? `1080 × 1350 · ${total} sayfalı kaydırmalı gönderi` : '1080 × 1350 · Instagram dikey gönderi';
    downloadBtn.textContent = total > 1 ? `Görselleri indir (${total})` : 'Görseli indir';
    extraList.querySelectorAll('.cmp-extra-thumb').forEach((b) => b.setAttribute('aria-pressed', String(state.cur === +b.dataset.page)));
    const a = active();
    zoomInput.value = String(a ? a.zoom : 1);
    updatePhotoUI();
    scheduleRender();
  }

  extraAdd.addEventListener('click', () => extraInput.click());
  extraInput.addEventListener('change', () => { const fs = extraInput.files ? [...extraInput.files] : []; extraInput.value = ''; addExtraFiles(fs); });
  pagePrev.addEventListener('click', () => showPage(state.cur - 1));
  pageNext.addEventListener('click', () => showPage(state.cur + 1));
  {
    let depth = 0;
    extraSection.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; extraSection.classList.add('is-over'); });
    extraSection.addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    extraSection.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) extraSection.classList.remove('is-over'); });
    extraSection.addEventListener('drop', (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.stopPropagation(); depth = 0; extraSection.classList.remove('is-over'); addExtraFiles(e.dataTransfer.files); });
  }

  // ----- tür & alanlar -----

  function setType(t) {
    if (!TYPE_BY_ID[t]) return;
    state.type = t;
    typeBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.type === t)));
    for (const [k, g] of Object.entries(groups)) g.hidden = k !== t;
    const meet = t === 'toplanti';
    dateField.hidden = meet;
    tplSection.hidden = meet || t === 'ocakbasi';
    if (meet) { state.dateEdited = false; applyMeeting(state.term_no); }
    if (typeof syncTitles === 'function') syncTitles();
    scheduleRender();
  }
  segmented.addEventListener('click', (e) => {
    const b = e.target.closest('.cmp-seg-btn');
    if (b) setType(b.dataset.type);
  });
  segmented.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const i = typeBtns.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const n = typeBtns[(i + (e.key === 'ArrowRight' ? 1 : -1) + typeBtns.length) % typeBtns.length];
    n.focus();
    setType(n.dataset.type);
  });

  const offset = () => toInt(state.term && state.term.club_meeting_offset) ?? 599;

  const meetingByTerm = (n) => state.meetings.find((x) => toInt(x.term_no) === n);
  function applyMeeting(n) {
    const m = meetingByTerm(n);
    state.term_no = n;
    state.club_no = m ? (toInt(m.club_no) ?? offset() + n) : (n != null ? offset() + n : null);
    if (m && m.date && (state.type === 'toplanti' || !state.dateEdited)) { state.date = String(m.date).slice(0, 10); dateInput.value = state.date; }
  }
  function fillMeetings() {
    const list = [...state.meetings].sort((x, y) => toInt(x.term_no) - toInt(y.term_no));
    termInput.replaceChildren(...list.map((m) => {
      const n = toInt(m.term_no);
      const club = toInt(m.club_no) ?? offset() + n;
      const date = m.date ? ` · ${formatTR(m.date)}` : '';
      const label = m.label ? ` (${m.label})` : '';
      return el('option', { value: String(n), text: `Kulübün ${club}. · dönemin ${n}. toplantısı${date}${label}` });
    }));
    if (!list.length) termInput.append(el('option', { value: '', text: 'Toplantı listesi boş' }));
    termInput.value = state.term_no != null ? String(state.term_no) : '';
  }
  termInput.addEventListener('change', () => {
    state.dateEdited = false;
    applyMeeting(toInt(termInput.value));
    syncTitles();
    scheduleRender();
  });
  hubInput.addEventListener('change', () => { state.hybridhub = hubInput.checked; });
  hostSel.addEventListener('change', () => { state.host = hostSel.value; });
  ocakInput.addEventListener('input', () => {
    state.ocakbasi_no = toInt(ocakInput.value);
    scheduleRender();
  });
  dateInput.addEventListener('input', () => {
    state.date = dateInput.value || todayISO();
    state.dateEdited = true;
    scheduleRender();
  });
  for (const [t, ta] of Object.entries(textAreas)) {
    ta.addEventListener('input', () => { state.text[t] = ta.value; scheduleRender(); });
  }

  // ----- şablon -----
  function syncTitles() {
    const [p1, p2] = autoTitles();
    title1Input.placeholder = p1;
    title2Input.placeholder = p2;
  }
  title1Input.addEventListener('input', () => { state.title1 = title1Input.value; scheduleRender(); });
  title2Input.addEventListener('input', () => { state.title2 = title2Input.value; scheduleRender(); });
  root.addEventListener('input', syncTitles);
  root.addEventListener('click', () => setTimeout(syncTitles, 0));
  captionTa.addEventListener('input', () => {
    state.caption = captionTa.value;
    capCount.textContent = `${captionTa.value.length} / 2200`;
  });

  // ----- gönderi verisi -----

  function postFields() {
    const t = state.type;
    return {
      type: t,
      term_no: t === 'toplanti' ? state.term_no : null,
      club_no: t === 'toplanti' ? state.club_no : null,
      ocakbasi_no: t === 'ocakbasi' ? state.ocakbasi_no : null,
      summary: (t === 'proje' || t === 'etkinlik' ? [titles()[1] !== 'Başlık' ? `Başlık: ${titles()[1]}` : '', state.text[t] ? `Kısa açıklama: ${state.text[t]}` : ''].filter(Boolean).join('\n')
        : t === 'ocakbasi' && state.host ? `Ev sahibi: ${state.host}\n${state.text[t] || ''}`
        : (state.text[t] || '')).trim(),
    };
  }

  function fileName() {
    const t = state.type;
    const no = t === 'toplanti' ? state.term_no : t === 'ocakbasi' ? state.ocakbasi_no : '';
    return `anittepe-rotaract-${t}${no ? `-${no}` : ''}-${state.date}.jpg`;
  }

  // Tüm sayfaları sırayla çizip JPEG olarak döndürür (kapak + ek sayfalar).
  async function renderBlobs() {
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    const keep = state.cur;
    const blobs = [];
    try {
      for (let i = 0; i <= state.extra.length; i++) {
        state.cur = i;
        draw();
        blobs.push(await canvasToBlob(canvas));
      }
    } finally {
      state.cur = keep;
      draw();
    }
    return blobs;
  }

  async function downloadImage() {
    try {
      const blobs = await renderBlobs();
      const base = fileName().replace(/\.jpg$/, '');
      blobs.forEach((blob, i) => {
        const url = URL.createObjectURL(blob);
        const a = el('a', { href: url, download: blobs.length > 1 ? `${base}-${i + 1}.jpg` : `${base}.jpg` });
        document.body.append(a);
        setTimeout(() => { a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000); }, i * 350);
      });
    } catch (e) {
      toast(e.message || 'Görsel indirilemedi.', 'error');
    }
  }

  function setBusy(b) {
    state.busy = b;
    publishBtn.disabled = b || readOnly;
    aiBtn.disabled = b || readOnly;
    publishBtn.setAttribute('aria-busy', String(b));
  }

  aiBtn.addEventListener('click', async () => {
    if (readOnly || state.busy) return;
    const f = postFields();
    if (state.caption.trim() && !confirm('Mevcut açıklamanın yerine yenisi yazılsın mı?')) return;
    setBusy(true);
    const orig = aiBtn.lastChild.textContent;
    aiBtn.lastChild.textContent = ' Yazılıyor…';
    try {
      const res = await store.generateCaption({ ...f, date: state.date, hybridhub: f.type === 'toplanti' && state.hybridhub });
      state.caption = (res && res.caption) || '';
      state.captionSource = res && res.source;
      captionTa.value = state.caption;
      capCount.textContent = `${state.caption.length} / 2200`;
      capNote.hidden = state.captionSource !== 'sablon';
      captionTa.focus();
    } catch (e) {
      toast(e.message || 'Açıklama yazılamadı.', 'error');
    } finally {
      aiBtn.lastChild.textContent = orig;
      setBusy(false);
    }
  });

  downloadBtn.addEventListener('click', downloadImage);

  function showResult(kind, nodes) {
    resultBox.className = `cmp-result cmp-result-${kind}`;
    resultBox.replaceChildren(...nodes);
    resultBox.hidden = false;
    resultBox.focus();
  }

  function closeResult() {
    resultBox.hidden = true;
    resultBox.replaceChildren();
    publishBtn.focus();
  }

  resultBox.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeResult(); });

  function demoBox() {
    const titleId = uid('demo-t');
    const copyBtn = el('button', { type: 'button', class: 'cmp-btn cmp-btn-soft', text: 'Açıklamayı kopyala' });
    copyBtn.addEventListener('click', async () => {
      const ok = await copyText(state.caption);
      toast(ok ? 'Açıklama panoya kopyalandı.' : 'Kopyalanamadı; metni elle seçip kopyalayın.', ok ? 'success' : 'error');
    });
    const dl = el('button', { type: 'button', class: 'cmp-btn cmp-btn-primary', text: 'Görseli indir' });
    dl.addEventListener('click', downloadImage);
    const close = el('button', { type: 'button', class: 'cmp-btn cmp-btn-ghost', text: 'Kapat' });
    close.addEventListener('click', closeResult);
    resultBox.setAttribute('role', 'dialog');
    resultBox.setAttribute('aria-labelledby', titleId);
    return [
      el('h4', { id: titleId, text: 'Demo modunda Instagram’a paylaşılamaz' }),
      el('p', { text: 'Panel şu an demo modunda çalışıyor; Instagram hesabına bağlı değil. Gönderi taslak olarak kaydedildi. Görseli indirip açıklamayı kopyalayarak Instagram uygulamasından elle paylaşabilirsiniz.' }),
      el('div', { class: 'cmp-result-actions' }, dl, copyBtn, close),
    ];
  }

  function successBox(permalink) {
    const titleId = uid('ok-t');
    const close = el('button', { type: 'button', class: 'cmp-btn cmp-btn-ghost', text: 'Kapat' });
    close.addEventListener('click', closeResult);
    resultBox.setAttribute('role', 'status');
    resultBox.setAttribute('aria-labelledby', titleId);
    return [
      el('h4', { id: titleId, text: 'Gönderi Instagram’da paylaşıldı' }),
      permalink
        ? el('p', {}, el('a', { href: permalink, target: '_blank', rel: 'noopener noreferrer', text: 'Gönderiyi Instagram’da aç' }))
        : el('p', { text: 'Bağlantı birkaç dakika içinde Instagram’da görünecek.' }),
      el('div', { class: 'cmp-result-actions' }, close),
    ];
  }

  publishBtn.addEventListener('click', async () => {
    if (readOnly || state.busy) return;
    if (!state.photo) {
      toast('Önce bir fotoğraf ekleyin.', 'error');
      dropzone.focus();
      return;
    }
    if (!state.caption.trim()) {
      toast('Önce gönderi açıklamasını yazın.', 'error');
      captionTa.focus();
      return;
    }
    if (state.type === 'ocakbasi' && !state.host) {
      toast('Ocakbaşının ev sahibini seçin.', 'error');
      hostSel.focus();
      return;
    }
    if (state.type === 'toplanti' && !state.term_no) {
      toast('Toplantıyı seçin.', 'error');
      termInput.focus();
      return;
    }
    setBusy(true);
    publishBtn.textContent = 'Paylaşılıyor…';
    const fields = postFields();
    try {
      const blobs = await renderBlobs();
      if (blobs.length > 1) publishBtn.textContent = `${blobs.length} sayfa paylaşılıyor…`;
      const res = await store.publishInstagram({ blobs, blob: blobs[0], caption: state.caption });
      if (res && res.ok) {
        await savePostSafe({ ...fields, caption: state.caption, status: 'paylasildi', ig_media_id: res.media_id || null, image_url: res.image_url || null });
        toast(res.permalink ? `Instagram’da paylaşıldı: ${res.permalink}` : 'Instagram’da paylaşıldı.', 'success');
        showResult('ok', successBox(res.permalink));
      } else if (res && res.demo) {
        await savePostSafe({ ...fields, caption: state.caption, status: 'taslak', ig_media_id: null });
        showResult('demo', demoBox());
      } else {
        throw new Error('Instagram paylaşımı tamamlanamadı.');
      }
    } catch (e) {
      toast(e.message || 'Paylaşım başarısız oldu.', 'error');
    } finally {
      publishBtn.textContent = 'Instagram’da paylaş';
      setBusy(false);
    }
  });

  async function savePostSafe(p) {
    try {
      const saved = await store.savePost(p);
      if (saved) state.posts = [saved, ...state.posts.filter((x) => !saved.id || x.id !== saved.id)];
      else state.posts = await store.listPosts();
      renderHistory();
    } catch (e) {
      toast(`Gönderi kaydı tutulamadı: ${e.message || e}`, 'error');
    }
  }

  // ----- geçmiş -----

  function postNumber(p) {
    if (p.type === 'toplanti' && p.term_no) return `${p.term_no}. toplantı${p.club_no ? ` · kulüp ${p.club_no}.` : ''}`;
    if (p.type === 'ocakbasi' && p.ocakbasi_no) return `${p.ocakbasi_no}. ocakbaşı`;
    const first = String(p.summary || '').split('\n').find((l) => l.trim());
    return first ? first.trim() : '—';
  }

  function renderHistory() {
    const posts = [...state.posts].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
    historyEmpty.hidden = posts.length > 0;
    historyList.replaceChildren(...posts.map((p) => {
      const status = STATUS_LABEL[p.status] || p.status || '';
      const item = el('li', { class: 'cmp-hitem' },
        el('span', { class: `cmp-htype t-${p.type}`, text: (TYPE_BY_ID[p.type] || {}).label || p.type }),
        el('span', { class: 'cmp-hnum', text: postNumber(p) }),
        el('time', { class: 'cmp-hdate', datetime: p.created_at || '', text: formatTR(p.created_at) }),
        el('span', { class: `cmp-hstatus s-${p.status}`, text: status }),
      );
      if (p.caption) {
        item.append(el('details', { class: 'cmp-hcap' }, el('summary', { text: 'Açıklama' }), el('p', { text: p.caption })));
      }
      return item;
    }));
  }

  // ----- ilk yükleme -----

  async function init() {
    draw(); // yazı tipi gelmeden de bir şey görünsün
    const fontsP = ensureFonts().then(() => { state.fontsReady = true; scheduleRender(); });
    for (const t of TEMPLATES) if (t.url) loadImage(t.url).then((img) => { state.tplImg[t.id] = img; scheduleRender(); }).catch(() => {});
    const logoP = loadImage(LOGO_URL).then((img) => { state.logo = trimLogo(img); scheduleRender(); }).catch(() => {});

    const [term, meetings, posts] = await Promise.all([
      store.getTerm().catch((e) => { toast(e.message || 'Dönem bilgisi alınamadı.', 'error'); return null; }),
      store.listMeetings().catch((e) => { toast(e.message || 'Toplantılar alınamadı.', 'error'); return []; }),
      store.listPosts().catch((e) => { toast(e.message || 'Gönderiler alınamadı.', 'error'); return []; }),
    ]);
    if (destroyed) return;
    state.term = term;
    state.meetings = Array.isArray(meetings) ? meetings : [];
    state.posts = Array.isArray(posts) ? posts : [];


    const today = todayISO();
    const past = state.meetings
      .filter((m) => m.date && String(m.date).slice(0, 10) <= today)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)) || (toInt(a.term_no) - toInt(b.term_no)));
    const last = past[past.length - 1];
    const first = last || [...state.meetings].sort((x, y) => toInt(x.term_no) - toInt(y.term_no))[0];
    applyMeeting(first ? toInt(first.term_no) : 1);
    fillMeetings();
    syncTitles();
    dateInput.value = state.date;

    try {
      const members = await store.listMembers();
      state.members = (members || []).filter((m) => m.status === 'active' && m.full_name).map((m) => m.full_name).sort((x, y) => x.localeCompare(y, 'tr'));
    } catch { state.members = []; }
    hostSel.append(...state.members.map((n) => el('option', { value: n, text: n })));
    state.ocakbasi_no = state.posts.filter((p) => p.type === 'ocakbasi').length + 1;
    ocakInput.value = String(state.ocakbasi_no);

    renderHistory();
    scheduleRender();
    await Promise.all([fontsP, logoP]);
  }

  renderExtra();
  setType(state.type);
  syncTitles();
  showPage(0);
  const ready = init().catch((e) => toast(e.message || 'Hazırlayıcı yüklenemedi.', 'error'));

  return {
    ready,
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      document.removeEventListener('paste', onPaste);
      if (state.photo) URL.revokeObjectURL(state.photo.url);
      state.extra.forEach((s) => URL.revokeObjectURL(s.url));
      root.replaceChildren();
      root.classList.remove('cmp');
    },
  };
}
