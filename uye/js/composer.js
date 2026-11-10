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
      ['400 30px', '600 30px', '700 30px', '800 80px'].map((f) => document.fonts.load(`${f} "Open Sans"`, sample)),
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
    clubEdited: false,
    ocakbasi_no: 1,
    date: todayISO(),
    dateEdited: false,
    text: { toplanti: '', ocakbasi: '', proje: '', etkinlik: '' },
    caption: '',
    captionSource: null,
    photo: null, // { img, url, name }
    pos: { x: 0.5, y: 0.5 },
    zoom: 1,
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
  const zoomInput = el('input', { id: zoomId, type: 'range', min: '1', max: '3', step: '0.01', value: '1', disabled: true });
  const centerBtn = el('button', { type: 'button', class: 'cmp-btn cmp-btn-ghost cmp-btn-sm', disabled: true, text: 'Ortala' });
  const removeBtn = el('button', { type: 'button', class: 'cmp-btn cmp-btn-ghost cmp-btn-sm', disabled: true, text: 'Fotoğrafı kaldır' });
  const photoTools = el('div', { class: 'cmp-photo-tools' },
    el('label', { class: 'cmp-zoom', for: zoomId }, el('span', { text: 'Yakınlaştır' }), zoomInput),
    el('div', { class: 'cmp-photo-btns' }, centerBtn, removeBtn),
  );
  const photoHint = el('p', { class: 'cmp-hint', text: 'Konumu ayarlamak için önizlemedeki fotoğrafı sürükleyin (ya da önizlemeye odaklanıp ok tuşlarını kullanın).' });

  const photoSection = el('section', { class: 'cmp-photo', 'aria-label': 'Fotoğraf' }, dropzone, photoTools, photoHint, fileInput);

  // Tür seçici
  const typeBtns = TYPES.map((t) =>
    el('button', { type: 'button', class: 'cmp-seg-btn', 'data-type': t.id, 'aria-pressed': String(t.id === state.type), text: t.label }),
  );
  const segmented = el('div', { class: 'cmp-seg', role: 'group', 'aria-label': 'Gönderi türü' }, typeBtns);

  // Türe özel alanlar
  const termId = uid('term');
  const clubId = uid('club');
  const ocakId = uid('ocak');
  const dateId = uid('date');

  const termInput = el('input', { id: termId, type: 'number', min: '1', inputmode: 'numeric' });
  const clubInput = el('input', { id: clubId, type: 'number', min: '1', inputmode: 'numeric' });
  const clubReset = el('button', { type: 'button', class: 'cmp-link', hidden: true, text: 'Otomatik hesapla' });
  const ocakInput = el('input', { id: ocakId, type: 'number', min: '1', inputmode: 'numeric' });
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
        el('div', { class: 'cmp-field' }, el('label', { for: termId, text: 'Dönemin kaçıncı toplantısı' }), termInput),
        el('div', { class: 'cmp-field' }, el('label', { for: clubId, text: 'Kulübün kaçıncı toplantısı' }), clubInput, clubReset),
      ),
      mkText('toplanti', 'Toplantıda neler yaptık?', 'Kısaca: konuşmacı, konu, alınan kararlar…'),
    ),
    ocakbasi: el('div', { class: 'cmp-group', 'data-for': 'ocakbasi', hidden: true },
      el('div', { class: 'cmp-row' },
        el('div', { class: 'cmp-field' }, el('label', { for: ocakId, text: 'Dönemin kaçıncı ocakbaşı' }), ocakInput),
      ),
      mkText('ocakbasi', 'Kısa açıklama', 'Nerede buluştuk, neler konuştuk…'),
    ),
    proje: el('div', { class: 'cmp-group', 'data-for': 'proje', hidden: true },
      mkText('proje', 'Proje açıklaması', 'İlk satır görselde başlık olur. Örn: Fidan Dikim Günü'),
    ),
    etkinlik: el('div', { class: 'cmp-group', 'data-for': 'etkinlik', hidden: true },
      mkText('etkinlik', 'Etkinlik açıklaması', 'İlk satır görselde başlık olur. Örn: Kış Buluşması'),
    ),
  };
  const dateField = el('div', { class: 'cmp-field cmp-field-date' }, el('label', { for: dateId, text: 'Görseldeki tarih' }), dateInput);

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
    el('section', { class: 'cmp-type', 'aria-label': 'Tür ve içerik' }, segmented, groups.toplanti, groups.ocakbasi, groups.proje, groups.etkinlik, dateField),
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
  const preview = el('aside', { class: 'cmp-preview', 'aria-label': 'Canlı önizleme' },
    el('div', { class: 'cmp-preview-frame' }, canvas),
    el('p', { class: 'cmp-preview-cap', text: '1080 × 1350 · Instagram dikey gönderi' }),
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

  function photoGeom() {
    const { img } = state.photo;
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const s = Math.max(W / iw, PHOTO_H / ih) * state.zoom;
    const dw = iw * s;
    const dh = ih * s;
    const ox = dw - W;
    const oy = dh - PHOTO_H;
    return { dw, dh, ox, oy, dx: -ox * state.pos.x, dy: -oy * state.pos.y };
  }

  function drawPhoto() {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, PHOTO_H);
    ctx.clip();
    if (state.photo) {
      const g = photoGeom();
      ctx.fillStyle = C.ink;
      ctx.fillRect(0, 0, W, PHOTO_H);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(state.photo.img, g.dx, g.dy, g.dw, g.dh);
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

  function draw() {
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
      if (state.photo) URL.revokeObjectURL(state.photo.url);
      state.photo = { img, url, name: file.name || 'yapistirilan-gorsel' };
      state.pos = { x: 0.5, y: 0.5 };
      state.zoom = 1;
      zoomInput.value = '1';
      updatePhotoUI();
      scheduleRender();
    } catch {
      URL.revokeObjectURL(url);
      toast('Bu görsel açılamadı. Farklı bir dosya deneyin (HEIC desteklenmeyebilir).', 'error');
    }
  }

  function clearPhoto() {
    if (state.photo) URL.revokeObjectURL(state.photo.url);
    state.photo = null;
    state.zoom = 1;
    state.pos = { x: 0.5, y: 0.5 };
    zoomInput.value = '1';
    updatePhotoUI();
    scheduleRender();
    dropzone.focus();
  }

  function updatePhotoUI() {
    const has = !!state.photo;
    dropzone.classList.toggle('has-photo', has);
    zoomInput.disabled = !has;
    centerBtn.disabled = !has;
    removeBtn.disabled = !has;
    photoHint.hidden = !has;
    canvas.classList.toggle('can-drag', has);
    dzThumb.style.backgroundImage = has ? `url("${state.photo.url}")` : '';
    dzTitle.textContent = has ? 'Fotoğrafı değiştir' : 'Fotoğrafı buraya sürükleyin';
    dzSub.textContent = has
      ? `${state.photo.name} · yeni bir fotoğraf sürükleyin, seçin ya da yapıştırın`
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
    state.zoom = clamp(parseFloat(zoomInput.value) || 1, 1, 3);
    scheduleRender();
  });
  centerBtn.addEventListener('click', () => {
    state.pos = { x: 0.5, y: 0.5 };
    state.zoom = 1;
    zoomInput.value = '1';
    scheduleRender();
  });
  removeBtn.addEventListener('click', clearPhoto);

  // Önizlemede sürükleyerek konumlandırma
  let drag = null;
  const canvasPoint = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H, k: W / r.width };
  };
  canvas.addEventListener('pointerdown', (e) => {
    const p = canvasPoint(e);
    if (p.y > PHOTO_H) return;
    if (!state.photo) return; // boşsa click ile seçici açılır
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    drag = { id: e.pointerId, lx: e.clientX, ly: e.clientY, k: p.k };
    canvas.classList.add('is-dragging');
  });
  canvas.addEventListener('pointermove', (e) => {
    if (drag && e.pointerId === drag.id && state.photo) {
      const g = photoGeom();
      const dx = (e.clientX - drag.lx) * drag.k;
      const dy = (e.clientY - drag.ly) * drag.k;
      drag.lx = e.clientX;
      drag.ly = e.clientY;
      if (g.ox > 0) state.pos.x = clamp(state.pos.x - dx / g.ox, 0, 1);
      if (g.oy > 0) state.pos.y = clamp(state.pos.y - dy / g.oy, 0, 1);
      scheduleRender();
    } else {
      const p = canvasPoint(e);
      canvas.classList.toggle('over-photo', p.y <= PHOTO_H);
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
    if (state.photo) return;
    if (canvasPoint(e).y <= PHOTO_H) openPicker();
  });
  canvas.addEventListener('keydown', (e) => {
    if (!state.photo) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPicker(); }
      return;
    }
    const step = e.shiftKey ? 0.1 : 0.02;
    const map = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (map[e.key]) {
      e.preventDefault();
      state.pos.x = clamp(state.pos.x + map[e.key][0], 0, 1);
      state.pos.y = clamp(state.pos.y + map[e.key][1], 0, 1);
      scheduleRender();
    } else if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      state.zoom = clamp(state.zoom + 0.1, 1, 3); zoomInput.value = String(state.zoom); scheduleRender();
    } else if (e.key === '-') {
      e.preventDefault();
      state.zoom = clamp(state.zoom - 0.1, 1, 3); zoomInput.value = String(state.zoom); scheduleRender();
    }
  });

  // ----- tür & alanlar -----

  function setType(t) {
    if (!TYPE_BY_ID[t]) return;
    state.type = t;
    typeBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.type === t)));
    for (const [k, g] of Object.entries(groups)) g.hidden = k !== t;
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

  function syncClubReset() {
    clubReset.hidden = !state.clubEdited;
  }

  termInput.addEventListener('input', () => {
    state.term_no = toInt(termInput.value);
    if (!state.clubEdited) {
      state.club_no = state.term_no != null ? offset() + state.term_no : null;
      clubInput.value = state.club_no ?? '';
    }
    if (!state.dateEdited && state.term_no != null) {
      const m = state.meetings.find((x) => toInt(x.term_no) === state.term_no);
      if (m && m.date) { state.date = String(m.date).slice(0, 10); dateInput.value = state.date; }
    }
    scheduleRender();
  });
  clubInput.addEventListener('input', () => {
    state.club_no = toInt(clubInput.value);
    state.clubEdited = clubInput.value !== '';
    syncClubReset();
    scheduleRender();
  });
  clubReset.addEventListener('click', () => {
    state.clubEdited = false;
    state.club_no = state.term_no != null ? offset() + state.term_no : null;
    clubInput.value = state.club_no ?? '';
    syncClubReset();
    clubInput.focus();
    scheduleRender();
  });
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
      summary: (state.text[t] || '').trim(),
    };
  }

  function fileName() {
    const t = state.type;
    const no = t === 'toplanti' ? state.term_no : t === 'ocakbasi' ? state.ocakbasi_no : '';
    return `anittepe-rotaract-${t}${no ? `-${no}` : ''}-${state.date}.jpg`;
  }

  async function renderBlob() {
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    draw();
    return canvasToBlob(canvas);
  }

  async function downloadImage() {
    try {
      const blob = await renderBlob();
      const url = URL.createObjectURL(blob);
      const a = el('a', { href: url, download: fileName() });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
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
      const res = await store.generateCaption({ ...f, date: state.date });
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
    if (state.type === 'toplanti' && !state.term_no) {
      toast('Dönemin kaçıncı toplantısı olduğunu girin.', 'error');
      termInput.focus();
      return;
    }
    setBusy(true);
    publishBtn.textContent = 'Paylaşılıyor…';
    const fields = postFields();
    try {
      const blob = await renderBlob();
      const res = await store.publishInstagram({ blob, caption: state.caption });
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

    if (term && term.meeting_count) termInput.max = String(term.meeting_count);

    const today = todayISO();
    const past = state.meetings
      .filter((m) => m.date && String(m.date).slice(0, 10) <= today)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)) || (toInt(a.term_no) - toInt(b.term_no)));
    const last = past[past.length - 1];
    if (last) {
      state.term_no = toInt(last.term_no);
      state.club_no = toInt(last.club_no) ?? (state.term_no != null ? offset() + state.term_no : null);
      state.clubEdited = state.term_no != null && state.club_no !== offset() + state.term_no;
      state.date = String(last.date).slice(0, 10);
    } else {
      state.term_no = 1;
      state.club_no = offset() + 1;
    }
    termInput.value = state.term_no ?? '';
    clubInput.value = state.club_no ?? '';
    syncClubReset();
    dateInput.value = state.date;

    state.ocakbasi_no = state.posts.filter((p) => p.type === 'ocakbasi').length + 1;
    ocakInput.value = String(state.ocakbasi_no);

    renderHistory();
    scheduleRender();
    await Promise.all([fontsP, logoP]);
  }

  updatePhotoUI();
  const ready = init().catch((e) => toast(e.message || 'Hazırlayıcı yüklenemedi.', 'error'));

  return {
    ready,
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      document.removeEventListener('paste', onPaste);
      if (state.photo) URL.revokeObjectURL(state.photo.url);
      root.replaceChildren();
      root.classList.remove('cmp');
    },
  };
}
