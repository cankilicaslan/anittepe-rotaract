// Kim neyi görür, kim neyi düzenler.
export const ROLE_LABELS = {
  baskan: "Başkan", asbaskan: "Asbaşkan", sayman: "Sayman", sekreter: "Sekreter", ykuye: "Yönetim Kurulu Üyesi",
  // Komite başkanlıkları
  hizmet: "Hizmet Projeleri Komitesi", uyelik: "Üyelik ve Üyeliği Geliştirme Komitesi", uluslararasi: "Uluslararası Hizmetler Komitesi",
  pr: "Halkla İlişkiler ve Tanıtım Komitesi", kulup: "Kulüp Hizmetleri Komitesi", meslek: "Meslek Hizmetleri Komitesi",
  afet: "Afet Komitesi", hobi: "Hobi Komitesi", interact: "Interact Komitesi"
};
// Üye düzenleme penceresinde "Panel yetkileri" grupları
export const ROLE_GROUPS = [
  ["Yönetim kurulu", ["baskan", "asbaskan", "sayman", "sekreter", "ykuye"]],
  ["Komite başkanlığı", ["hizmet", "uyelik", "uluslararasi", "pr", "kulup", "meslek", "afet", "hobi", "interact"]]
];
const OWNER = { aidat: ["sayman"], kasa: ["sayman"], yoklama: ["sekreter"], instagram: ["pr"], projeler: ["hizmet"], duyuru: ["sekreter", "pr"], "wa-toplanti": ["sekreter"], "wa-aidat": ["sayman"], "arsiv-yonetim": ["sekreter", "pr"], bagis: ["sayman"], "proje-form": ["hizmet", "sekreter"], "uyeler-yonetim": ["baskan"], mektup: ["kulup", "pr"] };

// Panel hangi görevlinin? (asbaşkanın menüsünde parantez içinde gösterilir)
const SHORT = { sayman: "Sayman", sekreter: "Sekreter", pr: "HİTK", hizmet: "Hizmet Projeleri", kulup: "Kulüp Hizmetleri" };
export const panelOwners = panel => (OWNER[panel] || []).map(r => SHORT[r]).filter(Boolean).join(", ");
const GDB_VIEW = ["yoklama", "aidat", "kasa", "projeler"];
// Yalnızca görüntüleme yetkisi (düzenleyemez): Sekreter Bağışları ve Hizmet projelerini görür.
const VIEW_ROLES = { bagis: ["sekreter"], projeler: ["sekreter"] };

export const isActive = p => !!p && p.status === "active";
// is_owner yalnızca giriş yapan kişinin kendi profilinde (me) bulunur ve arayüzde hiçbir yerde gösterilmez.
export const hasRole = (p, r) => !!p?.is_owner || (isActive(p) && Array.isArray(p.roles) && p.roles.includes(r));

export function can(p, panel, mode = "view") {
  if (p?.is_owner) return true;
  if (!isActive(p)) return false;
  if (hasRole(p, "baskan")) return true;
  if ((OWNER[panel] || []).some(r => hasRole(p, r))) return true;
  // Geçmiş dönem başkanları (GDB) yalnızca bu panelleri görüntüleyebilir (düzenleyemez).
  if (mode === "view" && p.past_president && GDB_VIEW.includes(panel)) return true;
  if (mode === "view" && (VIEW_ROLES[panel] || []).some(r => hasRole(p, r))) return true;
  // Asbaşkan tüm yönetim panellerini görür ama yalnızca görüntüleme modunda (üye özellikleri herkes gibi açık).
  if (mode === "view" && hasRole(p, "asbaskan")) return true;
  return false;
}
