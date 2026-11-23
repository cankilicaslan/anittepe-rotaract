// Instagram açıklamalarında geçen kulüp ve kişi adlarının yanına hesabı parantez içinde yazar: "Ecem Gökgöz (@ecmgokgoz)".
// Kulüp listesi: Rotaract 2430 Instagram hesapları (Kasım 2026). Kişiler panelden (üye + misafir) gelir.
// Kendi kulübümüz etiketlenmez. "Ankara Rotaract Kulübü" listede bizim hesabımızla yazılı olduğu için bilerek alınmadı.
export const CLUBS = [
  ["Adana 5 Ocak","adana5ocakrotaract"],
  ["Adana Çukurova","adanacukurovarac"],
  ["Adana Güney","guneyrotaract"],
  ["Adana","adanarotaract"],
  ["Adana Seyhan","adanaseyhanrac"],
  ["Akdeniz","akdenizrac"],
  ["Alanya","alanyarotaract"],
  ["Amasya Yeşilırmak","amasyayesilirmakrotaract_"],
  ["Anadolu Evrensel","evrenselrotaract"],
  ["Ankara Bahçelievler","bahcelievler_rotaract"],
  ["Ankara Başkent","baskentrotaract"],
  ["Ankara Beysukent","beysukentrotaract"],
  ["Ankara Çayyolu","cayyolurotaract"],
  ["Ankara Gaziosmanpaşa","gaziosmanpasarotaract"],
  ["Ankara International","rocainternational"],
  ["Ankara İncek","ankaraincekrotaract"],
  ["Ankara Kavaklıdere","kavaklidererotaract"],
  ["Ankara Kızılay","kizilayrotaract"],
  ["Ankara Kocatepe","rotaractkocatepe"],
  ["Ankara Koru","koru.rotaract"],
  ["Ankara Maltepe","malteperotaract"],
  ["Ankara Tandoğan","tandoganrac"],
  ["Ankara Ulus","ulusrotaract"],
  ["Antakya","antakyarotaract"],
  ["Antalya Aspendos","aspendosrac"],
  ["Antalya Falez","falezrac"],
  ["Antalya Kaleiçi","antalyakaleicirotaractkulubu"],
  ["Antalya Perge","antalyapergerotaract"],
  ["Antalya","antalyarotaract"],
  ["Atakum","atakumrotaract"],
  ["Bakü Khazar","bakukhazar.rotaract"],
  ["Canik","canikrotaract"],
  ["Çankaya","cankayarac"],
  ["Eskişehir Anadolu","anadolurotaract"],
  ["Eskişehir Gordion","gordionrotaract"],
  ["Eskişehir","eskisehirrotaract"],
  ["Eskişehir Yazılıkaya","yazilikayarotaract"],
  ["Eskişehir Yunus Emre","yunusemrerotaract"],
  ["Gazi","gazirotaract"],
  ["Gaziantep Alleben","allebenrotaract"],
  ["Gaziantep İpekyolu","ipekyolurotaract"],
  ["Gaziantep Kavaklık","gaziantepkavaklikrac"],
  ["Gaziantep Yesemek","yesemekrotaract"],
  ["İlkadım 1919","ilkadim1919rotaract"],
  ["Kayseri","kayserirotaract"],
  ["Konya Meram","konyameramrotaract"],
  ["Mersin Kızkalesi","kizkalesirotaract"],
  ["Mersin","mersinrotaractkulubu"],
  ["Samsun","samsunrotaract"],
  ["Tarsus","tarsusrotaract"],
  ["Toros","torosrotaract"],
  ["Trabzon Ortahisar","ortahisarrotaract"]
];

const CITIES = ["Ankara", "Adana", "Antalya", "Eskişehir", "Gaziantep", "Konya", "Mersin", "Trabzon", "Amasya"];
// Harf sayısını değiştirmeden sadeleştirir (konumlar birebir korunur)
const MAP = { "İ": "i", "I": "i", "ı": "i", "Ş": "s", "ş": "s", "Ğ": "g", "ğ": "g", "Ü": "u", "ü": "u", "Ö": "o", "ö": "o", "Ç": "c", "ç": "c", "Â": "a", "â": "a", "’": "'", "‘": "'" };
const fold = s => [...String(s)].map(c => MAP[c] || (c.length === 1 && c.toLowerCase().length === 1 ? c.toLowerCase() : c)).join("");
const rx = s => fold(s).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
const handleOf = v => { const s = String(v || "").trim(); const m = s.match(/instagram\.com\/([A-Za-z0-9._]+)/i); const h = (m ? m[1] : s).replace(/^@+/, ""); return /^[A-Za-z0-9._]{1,30}$/.test(h) && /[A-Za-z0-9]/.test(h) ? h : ""; };

function targets(people) {
  const list = [], add = (alias, handle, club) => list.push({ alias: fold(alias).trim(), src: rx(alias), handle, club });
  CLUBS.forEach(([name, h]) => {
    add(name, h, true);
    const city = CITIES.find(c => name.startsWith(c + " "));
    if (city) add(name.slice(city.length + 1), h, true);
  });
  (people || []).forEach(p => {
    const h = handleOf(p.instagram), words = String(p.full_name || "").trim().split(/\s+/);
    if (!h || words.length < 2) return;
    add(words.join(" "), h, false);
    if (words.length > 2) add(words[0] + " " + words.at(-1), h, false);
  });
  // Aynı yazım iki farklı hesaba gidiyorsa hiçbirini etiketleme
  const seen = new Map();
  list.forEach(t => { const k = t.club + t.alias; seen.set(k, seen.has(k) && seen.get(k) !== t.handle ? null : t.handle); });
  return list.filter((t, i) => seen.get(t.club + t.alias) && list.findIndex(u => u.club === t.club && u.alias === t.alias) === i)
    .sort((a, b) => b.alias.length - a.alias.length); // uzun ad önce: "Antalya Perge" > "Perge"
}

function tagSection(text, list, budget) {
  const f = fold(text), taken = [], marks = [], done = new Set();
  // Kendi kulübümüzün adı hiçbir eşleşmeye girmesin
  for (const m of f.matchAll(/(?:ankara\s+)?anittepe\s+rotaract/g)) taken.push([m.index, m.index + m[0].length]);
  for (const t of list) {
    if (done.has(t.handle)) continue;
    const re = new RegExp(`(?<![\\p{L}\\d])${t.src}${t.club ? "\\s+rotaract(?:\\s+(?:kulub\\p{L}*|club))?" : ""}(?:'\\p{L}+)?(?![\\p{L}\\d])`, "gu");
    for (const m of f.matchAll(re)) {
      const a = m.index, b = a + m[0].length;
      if (taken.some(([x, y]) => a < y && b > x)) continue;
      taken.push([a, b]);
      const after = f.slice(b, b + 40);
      if (/^\s*\(@/.test(after)) { done.add(t.handle); break; } // zaten etiketli
      if (done.has(t.handle)) continue;
      done.add(t.handle);
      if (budget.n > 0) { budget.n--; marks.push([b, ` (@${t.handle})`]); }
      // ilk geçişi etiketle, sonrakileri yalnızca "alındı" say (kısa adlar içine düşmesin)
    }
  }
  return marks.sort((x, y) => y[0] - x[0]).reduce((s, [p, add]) => s.slice(0, p) + add + s.slice(p), text);
}

// Türkçe ve İngilizce bölümler ayrı ayrı etiketlenir (örnekteki gibi ikisinde de). Instagram bir açıklamada en çok 20 etikete izin verir.
export function tagCaption(text, people = []) {
  const list = targets(people), budget = { n: Math.max(0, 20 - (String(text).match(/@[A-Za-z0-9._]+/g) || []).length) };
  return String(text || "").split(/(\n_{4,}\n)/).map(part => /^\n_{4,}\n$/.test(part) ? part : tagSection(part, list, budget)).join("");
}
