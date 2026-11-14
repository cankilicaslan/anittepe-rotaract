// Kim neyi görür, kim neyi düzenler.
export const ROLE_LABELS = { baskan: "Başkan", asbaskan: "Asbaşkan", sayman: "Sayman", sekreter: "Sekreter", pr: "Halkla İlişkiler ve Tanıtım", hizmet: "Hizmet Projeleri" };
const OWNER = { aidat: ["sayman"], kasa: ["sayman"], yoklama: ["sekreter"], instagram: ["pr"], projeler: ["hizmet"], duyuru: ["sekreter", "pr"], "wa-toplanti": ["sekreter"], "wa-aidat": ["sayman"], "arsiv-yonetim": ["sekreter", "pr"], bagis: ["sayman"], "proje-form": ["hizmet", "sekreter"], "uyeler-yonetim": ["baskan"] };

// Panel hangi görevlinin? (asbaşkanın menüsünde parantez içinde gösterilir)
const SHORT = { sayman: "Sayman", sekreter: "Sekreter", pr: "HİTK", hizmet: "Hizmet Projeleri" };
export const panelOwners = panel => (OWNER[panel] || []).map(r => SHORT[r]).filter(Boolean).join(", ");
const GDB_VIEW = ["yoklama", "aidat", "kasa", "projeler"];

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
  // Asbaşkan tüm yönetim panellerini görür ama yalnızca görüntüleme modunda (üye özellikleri herkes gibi açık).
  if (mode === "view" && hasRole(p, "asbaskan")) return true;
  return false;
}
