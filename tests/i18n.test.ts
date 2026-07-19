import { describe, expect, test } from "bun:test";
import { createTranslator, defineCatalog, mergeCatalogs, resolveLocale } from "../src/i18n";

const catalog = defineCatalog({
  tr: {
    "university.notFound": "Üniversite bulunamadı.",
    "university.created": "{name} oluşturuldu.",
  },
  en: {
    "university.notFound": "University not found.",
    "university.created": "{name} created.",
  },
});

describe("createTranslator", () => {
  const t = createTranslator(catalog, "tr");

  test("anahtarı istenen dile çevirir", () => {
    expect(t("university.notFound", "en")).toBe("University not found.");
    expect(t("university.notFound", "tr")).toBe("Üniversite bulunamadı.");
  });

  test("bilinmeyen dil varsayılan dile düşer", () => {
    expect(t("university.notFound", "de")).toBe("Üniversite bulunamadı.");
  });

  test("{param} interpolasyonu yapar", () => {
    expect(t("university.created", "en", { name: "ITU" })).toBe("ITU created.");
  });

  test("eksik param yerinde bırakılır (sessiz 'undefined' basmaz)", () => {
    expect(t("university.created", "en", { baska: "x" })).toBe("{name} created.");
  });

  test("GERİ UYUM: katalogda olmayan anahtar AYNEN döner", () => {
    // Anahtara göç etmemiş feature'ların düz metni bozulmamalı.
    expect(t("Bu düz bir Türkçe mesaj.", "en")).toBe("Bu düz bir Türkçe mesaj.");
  });
});

describe("mergeCatalogs", () => {
  test("feature kataloglarını birleştirir", () => {
    const merged = mergeCatalogs(
      { tr: { "a.x": "A" }, en: { "a.x": "A-en" } },
      { tr: { "b.y": "B" }, en: { "b.y": "B-en" } }
    );

    expect(merged.tr).toEqual({ "a.x": "A", "b.y": "B" });
    expect(merged.en).toEqual({ "a.x": "A-en", "b.y": "B-en" });
  });

  test("aynı (dil, anahtar) çakışmasında FIRLATIR (fail-fast)", () => {
    expect(() =>
      mergeCatalogs({ tr: { "a.x": "birinci" } }, { tr: { "a.x": "ikinci" } })
    ).toThrow(/çakışması/);
  });

  test("farklı dillerde aynı anahtar çakışma DEĞİLDİR", () => {
    expect(() => mergeCatalogs({ tr: { "a.x": "A" } }, { en: { "a.x": "A" } })).not.toThrow();
  });
});

describe("resolveLocale", () => {
  const supported = ["tr", "en"];

  test("tam eşleşme", () => {
    expect(resolveLocale("en", supported, "tr")).toBe("en");
  });

  test("bölgeli etiket kök dile indirgenir", () => {
    expect(resolveLocale("en-US", supported, "tr")).toBe("en");
  });

  test("desteklenmeyen dil fallback'e düşer", () => {
    expect(resolveLocale("de", supported, "tr")).toBe("tr");
  });

  test("başlık yoksa fallback", () => {
    expect(resolveLocale(undefined, supported, "tr")).toBe("tr");
    expect(resolveLocale("", supported, "tr")).toBe("tr");
  });
});
