// Kim neyi görür, kim neyi düzenler.
export const ROLE_LABELS = { baskan: "Başkan", sayman: "Sayman", sekreter: "Sekreter", pr: "Halkla İlişkiler ve Tanıtım", hizmet: "Hizmet Projeleri" };
const OWNER = { aidat: ["sayman"], kasa: ["sayman"], yoklama: ["sekreter"], instagram: ["pr"], projeler: ["hizmet"], duyuru: ["sekreter", "pr"], "wa-toplanti": ["sekreter"], "wa-aidat": ["sayman"], "arsiv-yonetim": ["sekreter", "pr"], "uyeler-yonetim": ["baskan"] };

export const isActive = p => !!p && p.status === "active";
export const hasRole = (p, r) => isActive(p) && Array.isArray(p.roles) && p.roles.includes(r);

export function can(p, panel, mode = "view") {
  if (!isActive(p)) return false;
  if (hasRole(p, "baskan")) return true;
  if ((OWNER[panel] || []).some(r => hasRole(p, r))) return true;
  if (mode === "view" && p.past_president) return true;
  return false;
}
