import { test } from "node:test";
import assert from "node:assert/strict";
import { tagCaption, CLUBS } from "../uye/js/ig-tags.js";
const P = [{ full_name: "Ecem Gökgöz", instagram: "ecmgokgoz" }, { full_name: "Edin Eren Çimciler", instagram: "@edin_cimciler" }, { full_name: "Doruk Tahan", instagram: "" }, { full_name: "Simay Oğuzkurt", instagram: "https://instagram.com/simayoguzkurt/" }, { full_name: "Miraç", instagram: "mirac" }];

test("liste: 53 kulüp, kendi kulübümüz yok", () => {
  assert.equal(CLUBS.length, 53);
  assert.ok(!CLUBS.some(([, h]) => h === "anitteperotaract"));
});
test("örnek: kişiler iki dilde etiketlenir, hesabı olmayan etiketlenmez", () => {
  const t = tagCaption("Doruk Tahan, Ecem Gökgöz ve Edin Eren Çimciler Ankara Anıttepe Rotaract ailesine katıldı.\n\n______\n\n🇬🇧EN🇬🇧\n\nwelcoming Doruk Tahan, Ecem Gökgöz, and Edin Eren Çimciler", P);
  assert.equal(t, "Doruk Tahan, Ecem Gökgöz (@ecmgokgoz) ve Edin Eren Çimciler (@edin_cimciler) Ankara Anıttepe Rotaract ailesine katıldı.\n\n______\n\n🇬🇧EN🇬🇧\n\nwelcoming Doruk Tahan, Ecem Gökgöz (@ecmgokgoz), and Edin Eren Çimciler (@edin_cimciler)");
});
test("kulüpler: şehirli, şehirsiz, ekli, İngilizce", () => {
  assert.equal(tagCaption("Ankara Çayyolu Rotaract Kulübü"), "Ankara Çayyolu Rotaract Kulübü (@cayyolurotaract)");
  assert.equal(tagCaption("Kızılay Rotaract Kulübünün projesi"), "Kızılay Rotaract Kulübünün (@kizilayrotaract) projesi");
  assert.equal(tagCaption("Tarsus Rotaract’ın daveti"), "Tarsus Rotaract’ın (@tarsusrotaract) daveti");
  assert.equal(tagCaption("with Ankara İncek Rotaract Club."), "with Ankara İncek Rotaract Club (@ankaraincekrotaract).");
  assert.equal(tagCaption("Ankara Rotaract Kulübü ve Ankara Anıttepe Rotaract Kulübü"), "Ankara Rotaract Kulübü (@ankararotaractclub) ve Ankara Anıttepe Rotaract Kulübü");
  assert.equal(tagCaption("ANKARA KORU ROTARACT KULÜBÜ"), "ANKARA KORU ROTARACT KULÜBÜ (@koru.rotaract)");
});
test("kendi kulübümüz, Rotary ve benzer sözcükler etiketlenmez", () => {
  for (const s of ["Ankara Anıttepe Rotaract Kulübü", "Anıttepe Rotaract", "Çankaya Rotary Kulübü", "Gaziantep gezisi", "Maltepe’de buluştuk", "Toros dağları"]) assert.equal(tagCaption(s, P), s);
});
test("uzun ad kısa adı ezer", () => {
  assert.equal(tagCaption("Antalya Perge Rotaract Kulübü ve Antalya Rotaract Kulübü"), "Antalya Perge Rotaract Kulübü (@antalyapergerotaract) ve Antalya Rotaract Kulübü (@antalyarotaract)");
  assert.equal(tagCaption("Anadolu Evrensel Rotaract ile Eskişehir Anadolu Rotaract"), "Anadolu Evrensel Rotaract (@evrenselrotaract) ile Eskişehir Anadolu Rotaract (@anadolurotaract)");
});
test("ikinci kez çalışınca ve tekrar geçince çift etiket olmaz", () => {
  const once = tagCaption("Simay Oğuzkurt’un konuşması. Simay Oğuzkurt teşekkür etti.", P);
  assert.equal(once, "Simay Oğuzkurt’un (@simayoguzkurt) konuşması. Simay Oğuzkurt teşekkür etti.");
  assert.equal(tagCaption(once, P), once);
});
test("emoji konumları kaydırmaz; tek sözcüklü ad ve aynı adlı kişiler etiketlenmez", () => {
  assert.equal(tagCaption("🎉🇬🇧 Ecem Gökgöz 🎉", P), "🎉🇬🇧 Ecem Gökgöz (@ecmgokgoz) 🎉");
  assert.equal(tagCaption("Miraç geldi", P), "Miraç geldi");
  assert.equal(tagCaption("Ali Kaya", [{ full_name: "Ali Kaya", instagram: "a1" }, { full_name: "Ali Kaya", instagram: "a2" }]), "Ali Kaya");
});
test("en fazla 20 etiket", () => {
  const all = CLUBS.slice(0, 30).map(([n]) => n + " Rotaract Kulübü").join(", ");
  assert.equal((tagCaption(all).match(/\(@/g) || []).length, 20);
});
