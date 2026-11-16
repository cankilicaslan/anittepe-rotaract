// Başkan Mektubu sayfa çizici.
// Saf modül: DOM'a dokunmaz, veriden HTML metni üretir. Hem tarayıcıda (panel,
// /mektup/ okuyucusu, PDF görünümü) hem `node --test` altında çalışır.
// Stiller: assets/css/letter.css. Varlık yolları sabit değildir; çağıran
// opts.logoUrl ve opts.photoUrl(ref) verir.

// ---------------------------------------------------------------- düzenler

const T = (key, label, extra) => ({ key, label, kind: 'text', ...extra });
const L = (key, label, extra) => ({ key, label, kind: 'long', ...extra });
const P = (key, label) => ({ key, label, kind: 'photo' });
const LIST = (key, label) => ({ key, label, kind: 'list' });
const AI = { ai: true };

export const MAX_PHOTOS = 4;

export const LAYOUTS = {
  kapak: {
    label: 'Kapak',
    group: null,
    fields: [T('issue', 'Sayı'), T('period', 'Dönem'), T('title', 'Başlık'), P('photo', 'Kapak fotoğrafı')],
  },
  kunye: {
    label: 'Künye',
    group: null,
    fields: [LIST('rows', 'Unvan ve isim satırları')],
  },
  icindekiler: {
    label: "Sayı'da Neler Var?",
    group: null,
    fields: [LIST('items', 'Başlıklar (boşsa sayfalardan türetilir)')],
  },
  baskan: {
    label: 'Başkan Mektubu',
    group: 'Başkan Mektubu',
    fields: [P('photo', 'Portre'), L('body', 'Mektup'), T('name', 'İsim'), T('club', 'Kulüp'), T('role', 'Unvan')],
  },
  'mesaj-2': {
    label: 'Yönetim Kurulu Mesajları ×2',
    group: 'Yönetim Kurulu Mesajları',
    fields: [
      L('body1', '1. mesaj'), T('name1', '1. isim'), T('role1', '1. unvan'),
      L('body2', '2. mesaj'), T('name2', '2. isim'), T('role2', '2. unvan'),
    ],
  },
  'mesaj-1': {
    label: 'Yönetim Kurulu Mesajı ve görsel',
    group: 'Yönetim Kurulu Mesajları',
    fields: [L('body', 'Mesaj'), T('name', 'İsim'), T('role', 'Unvan'), P('photo', 'Görsel')],
  },
  kose: {
    label: 'Anıttepeliler Köşesi',
    group: 'Anıttepeliler Köşesi',
    fields: [
      L('body1', '1. yazı'), T('name1', '1. isim'), T('role1', '1. unvan'), P('photo1', '1. fotoğraf'),
      L('body2', '2. yazı'), T('name2', '2. isim'), T('role2', '2. unvan'), P('photo2', '2. fotoğraf'),
    ],
  },
  'neler-2': {
    label: 'Neler Yaptık? ×2',
    group: 'Neler Yaptık?',
    fields: [
      T('label1', '1. etiket', AI), P('photo1', '1. fotoğraf'), L('body1', '1. metin', AI),
      T('label2', '2. etiket', AI), P('photo2', '2. fotoğraf'), L('body2', '2. metin', AI),
    ],
  },
  'neler-1': {
    label: 'Neler Yaptık? ×1',
    group: 'Neler Yaptık?',
    fields: [T('label', 'Etiket', AI), P('photo', 'Fotoğraf'), L('body', 'Metin', AI)],
  },
  'neler-tam': {
    label: 'Neler Yaptık? tam sayfa',
    group: 'Neler Yaptık?',
    fields: [T('label', 'Etiket', AI), L('body', 'Metin', AI), LIST('photos', `Fotoğraflar (en fazla ${MAX_PHOTOS})`)],
  },
  serbest: {
    label: 'Serbest sayfa',
    group: null, // içindekilerde kendi başlığıyla yer alır
    fields: [T('title', 'Başlık'), L('body', 'Metin'), LIST('photos', `Fotoğraflar (en fazla ${MAX_PHOTOS})`)],
  },
};

const CLUB = 'Ankara Anıttepe Rotaract Kulübü';

// ---------------------------------------------------------------- yardımcılar

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Kaçışlanmış metindeki satır sonlarını <br> yapar.
export function nl2br(s) {
  return String(s ?? '').replace(/\r\n?/g, '\n').replace(/\n/g, '<br>');
}

const blank = (v) => v == null || String(v).trim() === '';

// Boş satırla ayrılan bloklar paragraf, tek satır sonu <br> olur.
function paras(s) {
  if (blank(s)) return '';
  return String(s)
    .replace(/\r\n?/g, '\n')
    .trim()
    .split(/\n[ \t]*\n+/)
    .map((p) => `<p>${nl2br(esc(p.trim()))}</p>`)
    .join('');
}

// data-field (ve düzenleyicide boş alan için yer tutucu metni) nitelikleri.
function fieldAttr(ctx, key, extra = '') {
  if (!ctx.editable) return extra;
  const f = ctx.layout.fields.find((x) => x.key === key);
  const ph = f ? ` data-placeholder="${esc(f.label)}"` : '';
  return `${extra} data-field="${esc(key)}"${ph}`;
}

// Tek satırlık metin. Düzenleyici dışında boşsa hiç çizilmez.
function line(ctx, key, cls, tag = 'div') {
  const v = ctx.f[key];
  if (blank(v) && !ctx.editable) return '';
  return `<${tag} class="${cls}"${fieldAttr(ctx, key)}>${nl2br(esc(v))}</${tag}>`;
}

// Uzun metin kutusu: taşma gizlenir, düzenleyici data-overflow-check ile denetler.
function text(ctx, key, cls) {
  const v = ctx.f[key];
  if (blank(v) && !ctx.editable) return '';
  return `<div class="lt-text ${cls}" data-overflow-check${fieldAttr(ctx, key)}>${paras(v)}</div>`;
}

function refPath(ref) {
  if (ref && typeof ref === 'object') return ref.path || ref.url || '';
  return ref || '';
}

// Fotoğraf: <img>; pos {x,y} yüzde (0–100) olarak object-position, zoom ölçek.
function img(ctx, ref) {
  const url = ctx.photoUrl ? ctx.photoUrl(ref) : refPath(ref);
  let style = '';
  if (ref && typeof ref === 'object') {
    const pos = ref.pos && Number.isFinite(+ref.pos.x) && Number.isFinite(+ref.pos.y)
      ? `${+ref.pos.x}% ${+ref.pos.y}%` : '';
    const zoom = Number.isFinite(+ref.zoom) && +ref.zoom > 0 && +ref.zoom !== 1 ? +ref.zoom : 0;
    if (pos) style += `object-position:${pos};`;
    if (zoom) style += `transform:scale(${zoom});transform-origin:${pos || '50% 50%'};`;
  }
  return `<img class="lt-img" src="${esc(url)}" alt=""${style ? ` style="${style}"` : ''}>`;
}

const hasPhoto = (ref) => !blank(refPath(ref));

// Fotoğraf yuvası. Boşsa düzenleyicide yer tutucu, değilse hiçbir şey.
function slot(ctx, ref, key, cls, index) {
  const idx = index == null ? '' : ` data-index="${index}"`;
  const fa = ctx.editable ? ` data-field="${esc(key)}"${idx}` : '';
  if (hasPhoto(ref)) return `<div class="lt-slot ${cls}"${fa}>${img(ctx, ref)}</div>`;
  if (!ctx.editable) return '';
  return `<div class="lt-slot lt-slot-empty ${cls}"${fa}><span>Fotoğraf bırakın</span></div>`;
}

// Polaroid: beyaz kenarlı, hafif dönük fotoğraf ve altında etiket.
function polaroid(ctx, photoKey, labelKey, cls = '') {
  const ref = ctx.f[photoKey];
  const ph = slot(ctx, ref, photoKey, 'lt-polaroid-photo');
  if (!ph) return '';
  const lab = labelKey ? line(ctx, labelKey, 'lt-polaroid-label') : '';
  return `<figure class="lt-polaroid ${cls}">${ph}${lab}</figure>`;
}

// Fotoğraf listesi (neler-tam, serbest): en fazla 4, düzenleyicide bir boş yuva.
function photoList(ctx, key, cls) {
  const list = (Array.isArray(ctx.f[key]) ? ctx.f[key] : []).filter(hasPhoto).slice(0, MAX_PHOTOS);
  const items = list.map((r, i) => `<figure class="lt-polaroid">${slot(ctx, r, key, 'lt-polaroid-photo', i)}</figure>`);
  if (ctx.editable && list.length < MAX_PHOTOS) {
    items.push(`<figure class="lt-polaroid lt-polaroid-add">${slot(ctx, null, key, 'lt-polaroid-photo', list.length)}</figure>`);
  }
  if (!items.length) return '';
  return `<div class="${cls} lt-n${items.length}">${items.join('')}</div>`;
}

// İmza bloğu: isim, kulüp, unvan (sağa yaslı, küçük kalın).
function signature(ctx, nameKey, roleKey, { club = CLUB, clubKey = null, cls = '' } = {}) {
  const name = line(ctx, nameKey, 'lt-sig-name', 'span');
  const role = line(ctx, roleKey, 'lt-sig-role', 'span');
  if (!name && !role && !ctx.editable) return '';
  const clubLine = clubKey ? line(ctx, clubKey, 'lt-sig-club', 'span') : `<span class="lt-sig-club">${esc(club)}</span>`;
  return `<div class="lt-sig ${cls}">${name}${clubLine}${role}</div>`;
}

// ---------------------------------------------------------------- süslemeler (SVG)

// Deterministik sözde rastgele sayı (çıktı her çizimde aynı kalsın).
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const svg = (cls, body, vb = '0 0 810 1012') =>
  `<svg class="lt-deco ${cls}" viewBox="${vb}" preserveAspectRatio="none" aria-hidden="true" focusable="false">${body}</svg>`;

// Kapak: üstten sarkan büyük flama üçgenleri.
function decoCover() {
  const W = (o) => `fill="#fff" fill-opacity="${o}"`;
  const D = (o) => `fill="#A30C4D" fill-opacity="${o}"`;
  return svg('lt-deco-cover', [
    `<polygon points="60,0 420,0 290,560" ${W(0.07)}/>`,
    `<polygon points="160,240 420,190 290,560" ${D(0.10)}/>`,
    `<polygon points="420,0 810,0 810,120 640,630" ${W(0.10)}/>`,
    `<polygon points="560,160 810,120 640,630" ${D(0.08)}/>`,
    `<polygon points="420,0 560,0 560,160 420,190" ${W(0.12)}/>`,
    `<polygon points="700,0 810,0 810,70" ${W(0.16)}/>`,
    `<polygon points="0,0 60,0 0,260" ${D(0.10)}/>`,
    `<polygon points="0,260 290,560 0,720" ${W(0.04)}/>`,
  ].join(''));
}

// Künye ve mesajlar: ince eş yükselti (topoğrafik) çizgileri.
function decoContours(cls, cx = 620, cy = 520) {
  const r = rng(7);
  const rings = [];
  for (let i = 0; i < 14; i++) {
    const rad = 40 + i * 34;
    const pts = [];
    for (let a = 0; a <= 360; a += 30) {
      const t = (a * Math.PI) / 180;
      const k = rad * (0.82 + r() * 0.3);
      pts.push([cx + Math.cos(t) * k * 1.25, cy + Math.sin(t) * k * 0.9]);
    }
    // Catmull-Rom → kübik Bezier ile yumuşak kapalı eğri.
    let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
    for (let j = 0; j < pts.length - 1; j++) {
      const p0 = pts[(j - 1 + pts.length - 1) % (pts.length - 1)];
      const p1 = pts[j];
      const p2 = pts[j + 1];
      const p3 = pts[(j + 2) % (pts.length - 1)];
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
    }
    rings.push(`<path d="${d}"/>`);
  }
  return svg(cls, `<g fill="none" stroke="#fff" stroke-opacity=".16" stroke-width="1.2">${rings.join('')}</g>`);
}

// Mesaj sayfaları: sağ alttan akan ince dalgalar.
function decoWaves() {
  const paths = [];
  for (let i = 0; i < 12; i++) {
    const y = 760 + i * 14;
    paths.push(`<path d="M380,${y + 120} C520,${y - 40} 620,${y + 90} 810,${y - 60 + i * 4}"/>`);
  }
  return svg('lt-deco-waves', `<g fill="none" stroke="#fff" stroke-opacity=".22" stroke-width="1">${paths.join('')}</g>`);
}

// İçindekiler: çeyrek daire, üçgen ve dairelerden geometrik desen bantları.
function decoPattern(cls, seed) {
  const r = rng(seed);
  const S = 54;
  const cols = Math.ceil(810 / S);
  const rows = 4;
  const out = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const X = x * S;
      const Y = y * S;
      const o = (0.06 + r() * 0.22).toFixed(2);
      const fill = r() < 0.75 ? '#fff' : '#A30C4D';
      const rot = Math.floor(r() * 4) * 90;
      const tr = `transform="rotate(${rot} ${X + S / 2} ${Y + S / 2})"`;
      const k = Math.floor(r() * 6);
      const a = `fill="${fill}" fill-opacity="${o}" ${tr}`;
      if (k === 0) out.push(`<path d="M${X},${Y} h${S} v${S} A${S},${S} 0 0 1 ${X},${Y}z" ${a}/>`);
      else if (k === 1) out.push(`<path d="M${X},${Y + S} A${S},${S} 0 0 1 ${X + S},${Y} v${S}z" ${a}/>`);
      else if (k === 2) out.push(`<polygon points="${X},${Y} ${X + S},${Y} ${X},${Y + S}" ${a}/>`);
      else if (k === 3) out.push(`<circle cx="${X + S / 2}" cy="${Y + S / 2}" r="${S / 2 - 3}" ${a}/>`);
      else if (k === 4) out.push(`<path d="M${X},${Y + S} a${S / 2},${S / 2} 0 0 1 ${S},0z" ${a}/>`);
      else out.push(`<rect x="${X}" y="${Y}" width="${S}" height="${S}" ${a}/>`);
    }
  }
  return svg(cls, out.join(''), `0 0 810 ${rows * S}`);
}

// Neler Yaptık?: köşede ok başı (») dizisi ve altta zikzak.
function decoNeler(variant = 0) {
  const chev = [];
  for (let i = 0; i < 5; i++) {
    const x = 560 + i * 44;
    chev.push(`<path d="M${x},28 l22,22 l-22,22"/>`);
  }
  const zig = (y, o) => {
    let d = `M-20,${y}`;
    for (let x = -20; x < 460; x += 70) d += ` l35,-34 l35,34`;
    return `<path d="${d}" stroke-opacity="${o}"/>`;
  };
  const bottom = variant % 2
    ? `<g fill="none" stroke="#fff" stroke-width="2">${zig(930, 0.16)}${zig(962, 0.10)}</g>`
    : `<g fill="none" stroke="#A30C4D" stroke-width="22" stroke-linejoin="miter">${zig(900, 0.14)}${zig(960, 0.10)}</g>`;
  return svg('lt-deco-neler',
    `<g fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">${chev.join('')}</g>${bottom}`);
}

// Başkan sayfası: sağ kenarda el çizimi çiçek / ışıltı.
function decoBloom() {
  const petals = [];
  for (let i = 0; i < 9; i++) {
    const a = -100 + i * 22;
    petals.push(`<path d="M700,720 q-14,-80 0,-150 q14,70 0,150" transform="rotate(${a} 700 720)"/>`);
  }
  const spark = (x, y, s) => `<path d="M${x},${y - s} L${x},${y + s} M${x - s},${y} L${x + s},${y}"/>`;
  return svg('lt-deco-bloom',
    `<g fill="none" stroke="#A30C4D" stroke-opacity=".22" stroke-width="3" stroke-linecap="round">${petals.join('')}</g>` +
    `<g fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="2" stroke-linecap="round">${spark(90, 950, 12)}${spark(130, 985, 6)}${spark(560, 950, 9)}</g>`);
}

// Köşe sayfası: başlık çevresinde ince kalpler.
function decoHearts() {
  const h = (x, y, s, rot) =>
    `<path transform="translate(${x} ${y}) rotate(${rot}) scale(${s})" d="M0,6 C-6,-4 -20,0 -14,12 C-10,20 0,26 0,30 C0,26 10,20 14,12 C20,0 6,-4 0,6z"/>`;
  return svg('lt-deco-hearts',
    `<g fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="1.6">${h(208, 30, 1.1, -14)}${h(612, 30, 1.1, 14)}${h(70, 960, 1.6, -8)}</g>`);
}

function logo(ctx, cls = '') {
  if (!ctx.logoUrl) return '';
  // Arka plan resmi olarak: sayfadaki <img> öğeleri yalnızca içerik fotoğraflarıdır.
  return `<div class="lt-logo ${cls}" role="img" aria-label="Ankara Anıttepe Rotaract Kulübü" style="background-image:url(&quot;${esc(ctx.logoUrl)}&quot;)"></div>`;
}

const heading = (html, cls = '') => `<h2 class="lt-heading ${cls}">${html}</h2>`;

// ---------------------------------------------------------------- düzen çizicileri

const DRAW = {
  kapak(ctx) {
    const issueRaw = blank(ctx.f.issue) ? ctx.letter?.issue_no : ctx.f.issue;
    const issue = blank(issueRaw) ? '' : /^\d+$/.test(String(issueRaw).trim()) ? `Sayı ${String(issueRaw).trim()}` : issueRaw;
    const period = blank(ctx.f.period) ? ctx.letter?.period : ctx.f.period;
    const title = blank(ctx.f.title) ? 'Başkan Mektubu' : ctx.f.title;
    const fa = (k) => fieldAttr(ctx, k);
    const photo = slot(ctx, ctx.f.photo, 'photo', 'lt-cover-photo');
    return `${photo}${decoCover()}${logo(ctx, 'lt-logo-cover')}
<div class="lt-cover-text">
  ${blank(issue) && !ctx.editable ? '' : `<div class="lt-cover-issue"${fa('issue')}>${esc(issue)}</div>`}
  ${blank(period) && !ctx.editable ? '' : `<div class="lt-cover-period"${fa('period')}>${esc(period)}</div>`}
  <h1 class="lt-cover-title"${fa('title')}>${nl2br(esc(title))}</h1>
</div>`;
  },

  kunye(ctx) {
    const rows = (Array.isArray(ctx.f.rows) ? ctx.f.rows : []).filter((r) => r && (!blank(r.title) || !blank(r.name)));
    const items = rows.map((r, i) =>
      `<div class="lt-kunye-row"${ctx.editable ? ` data-index="${i}"` : ''}><div class="lt-kunye-title">${esc(r.title)}</div><div class="lt-kunye-name">${esc(r.name)}</div></div>`);
    return `${decoContours('lt-deco-contours', 560, 470)}
<div class="lt-kunye-list" data-overflow-check${fieldAttr(ctx, 'rows', '')}>${items.join('')}</div>${logo(ctx)}`;
  },

  icindekiler(ctx) {
    const own = (Array.isArray(ctx.f.items) ? ctx.f.items : []).map((x) => (typeof x === 'string' ? x : x?.title)).filter((x) => !blank(x));
    const items = own.length ? own : ctx.toc || [];
    const lis = items.map((t) => `<li>${esc(t)}</li>`).join('');
    return `${decoPattern('lt-deco-band lt-deco-band-top', 11)}${decoPattern('lt-deco-band lt-deco-band-bottom', 23)}
<div class="lt-toc">
  <h2 class="lt-heading lt-toc-heading">Sayı’da Neler Var?</h2>
  <ul class="lt-toc-list"${fieldAttr(ctx, 'items')}>${lis}</ul>
</div>${logo(ctx)}`;
  },

  baskan(ctx) {
    const photo = slot(ctx, ctx.f.photo, 'photo', 'lt-portrait');
    return `${decoBloom()}
<div class="lt-baskan-main" data-overflow-check>
  <div class="lt-baskan-figure${photo ? '' : ' lt-no-photo'}">${photo}<h2 class="lt-badge">Başkan Mektubu</h2></div>
  ${text(ctx, 'body', 'lt-baskan-body')}
  ${signature(ctx, 'name', 'role', { clubKey: 'club', cls: 'lt-sig-plain' })}
</div>${logo(ctx)}`;
  },

  'mesaj-2'(ctx) {
    const block = (n) => {
      const body = text(ctx, `body${n}`, 'lt-msg-body');
      const sig = signature(ctx, `name${n}`, `role${n}`);
      return body || sig ? `<div class="lt-msg">${body}${sig}</div>` : '';
    };
    return `${decoWaves()}${heading('Yönetim Kurulu Mesajları')}
<div class="lt-msgs">${block(1)}${block(2)}</div>${logo(ctx)}`;
  },

  'mesaj-1'(ctx) {
    const body = text(ctx, 'body', 'lt-msg-body');
    const sig = signature(ctx, 'name', 'role');
    const photo = slot(ctx, ctx.f.photo, 'photo', 'lt-msg-visual');
    return `${decoWaves()}${heading('Yönetim Kurulu Mesajları')}
<div class="lt-msg-solo"><div class="lt-msg">${body}${sig}</div>${photo}</div>${logo(ctx)}`;
  },

  kose(ctx) {
    const col = (n) => {
      const photo = slot(ctx, ctx.f[`photo${n}`], `photo${n}`, 'lt-round');
      return `<div class="lt-kose-col lt-kose-col${n}">${text(ctx, `body${n}`, 'lt-kose-body')}${signature(ctx, `name${n}`, `role${n}`)}${photo}</div>`;
    };
    return `${decoHearts()}${heading('Anıttepeliler <b>Köşesi</b>', 'lt-kose-heading')}
<div class="lt-kose-cols">${col(1)}<div class="lt-kose-rule"></div>${col(2)}</div>${logo(ctx)}`;
  },

  'neler-2'(ctx) {
    const item = (n) => {
      const pol = polaroid(ctx, `photo${n}`, `label${n}`, n === 1 ? 'lt-tilt-l' : 'lt-tilt-r');
      // Fotoğraf yoksa etiket metnin üstünde küçük bir şerit olarak kalır.
      const tag = pol ? '' : line(ctx, `label${n}`, 'lt-tag');
      const body = text(ctx, `body${n}`, 'lt-neler-body');
      if (!pol && !tag && !body) return '';
      return `<div class="lt-neler-item lt-neler-item${n}${pol ? '' : ' lt-no-photo'}">${pol}<div class="lt-neler-copy">${tag}${body}</div></div>`;
    };
    return `${decoNeler(0)}${heading('Neler Yaptık?')}
<div class="lt-neler-items">${item(1)}${item(2)}</div>${logo(ctx)}`;
  },

  'neler-1'(ctx) {
    const pol = polaroid(ctx, 'photo', 'label', 'lt-tilt-l lt-polaroid-lg');
    const tag = pol ? '' : line(ctx, 'label', 'lt-tag');
    return `${decoNeler(1)}${heading('Neler Yaptık?')}
<div class="lt-neler-single">${pol}<div class="lt-neler-copy">${tag}${text(ctx, 'body', 'lt-neler-body')}</div></div>${logo(ctx)}`;
  },

  'neler-tam'(ctx) {
    return `${decoNeler(1)}${heading('Neler Yaptık?')}
<div class="lt-full">
  ${line(ctx, 'label', 'lt-tag')}
  ${text(ctx, 'body', 'lt-full-body')}
  ${photoList(ctx, 'photos', 'lt-collage')}
</div>${logo(ctx)}`;
  },

  serbest(ctx) {
    const title = blank(ctx.f.title) && !ctx.editable ? '' : `<h2 class="lt-heading"${fieldAttr(ctx, 'title')}>${esc(ctx.f.title)}</h2>`;
    return `${decoContours('lt-deco-contours', 700, 900)}${title}
<div class="lt-full">
  ${text(ctx, 'body', 'lt-full-body')}
  ${photoList(ctx, 'photos', 'lt-collage lt-grid')}
</div>${logo(ctx)}`;
  },
};

// ---------------------------------------------------------------- dışa açılanlar

// Tek sayfa çizer. opts: { photoUrl(ref)=>string, editable:boolean, logoUrl:string }
export function renderPage(page, opts = {}) {
  const key = page && LAYOUTS[page.layout] ? page.layout : 'serbest';
  const ctx = {
    layout: LAYOUTS[key],
    f: (page && page.fields) || {},
    editable: !!opts.editable,
    photoUrl: opts.photoUrl,
    logoUrl: opts.logoUrl || '',
    letter: opts.letter,
    toc: opts.toc,
  };
  return `<section class="lt-page lt-${key}"${ctx.editable ? ' data-editable' : ''}>${DRAW[key](ctx)}</section>`;
}

// İçindekiler: sayfaların grup başlıkları, ilk görüldükleri sırayla ve tekrarsız.
export function tocFromPages(pages) {
  const out = [];
  for (const p of pages || []) {
    const lay = LAYOUTS[p?.layout];
    if (!lay) continue;
    const t = lay.group || (p.layout === 'serbest' ? p.fields?.title : null);
    if (!blank(t) && !out.includes(String(t).trim())) out.push(String(t).trim());
  }
  return out;
}

// Tüm mektubu çizer: sayfalar sırayla, art arda.
export function renderLetter(letter, opts = {}) {
  const pages = (letter && letter.pages) || [];
  const toc = tocFromPages(pages);
  const o = { ...opts, letter: { period: letter?.period, issue_no: letter?.issue_no }, toc };
  return pages.map((p) => renderPage(p, o)).join('\n');
}
