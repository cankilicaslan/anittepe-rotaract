// Yönetim kurulu planlama: çerçeve yerleşim mantığı (saf fonksiyonlar, girdiyi değiştirmez).
// slots: { baskan: {kind,id}, ..., ykuye: [{kind,id}, ...], hizmet: {kind,id}, ... }

export const BOARD_SLOTS = ["baskan", "asbaskan", "sekreter", "sayman"];
export const MULTI = "ykuye";

const copy = s => {
  const o = { ...(s || {}) };
  if (Array.isArray(o[MULTI])) o[MULTI] = o[MULTI].slice();
  return o;
};
const get = (s, key, index) => key === MULTI ? (s[MULTI] || [])[index] : s[key];
const tidy = s => { if (Array.isArray(s[MULTI]) && !s[MULTI].length) delete s[MULTI]; return s; };

// Çerçeveye kişi koyar. ykuye için index yoksa sona ekler.
export function place(slots, key, person, index) {
  const s = copy(slots);
  if (key === MULTI) {
    const arr = s[MULTI] || [];
    if (index == null || index >= arr.length) arr.push(person); else arr[index] = person;
    s[MULTI] = arr;
  } else s[key] = person;
  return s;
}

// Çerçeveyi boşaltır.
export function clear(slots, key, index) {
  const s = copy(slots);
  if (key === MULTI) { if (Array.isArray(s[MULTI])) s[MULTI].splice(index ?? s[MULTI].length - 1, 1); }
  else delete s[key];
  return tidy(s);
}

// Çerçeveden çerçeveye taşır; hedef doluysa yer değiştirir.
export function move(slots, from, to) {
  if (from.key === to.key && (from.key !== MULTI || from.index === to.index)) return copy(slots);
  const p = get(slots, from.key, from.index);
  if (!p) return copy(slots);
  const target = to.key === MULTI && to.index == null ? undefined : get(slots, to.key, to.index);
  let s = copy(slots);
  if (target) {
    s = from.key === MULTI ? (s[MULTI][from.index] = target, s) : (s[from.key] = target, s);
    return place(s, to.key, p, to.index);
  }
  s = place(s, to.key, p, to.index);
  return clear(s, from.key, from.index);
}

// Yerleşmiş kişiler ("kind:id")
export function placedIds(slots) {
  const out = new Set();
  for (const [k, v] of Object.entries(slots || {})) (k === MULTI ? v || [] : [v]).forEach(p => p && out.add(`${p.kind}:${p.id}`));
  return out;
}

// Çerçevedeki kaydı kişiye çevirir; kişi silinmiş/pasifse { missing: true }.
export function resolveSlot(ref, members, guests) {
  if (!ref) return null;
  const person = ref.kind === "guest" ? guests.find(g => g.id === ref.id) : members.find(m => m.id === ref.id && m.status === "active");
  return person ? { person, kind: ref.kind } : { missing: true };
}
