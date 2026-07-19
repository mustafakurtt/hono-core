/**
 * Bağımlılıksız, minik çevirmen. Ağır i18n kütüphaneleri (çoğullaştırma, ICU
 * mesaj formatı, namespace, lazy-load, backend loader...) bir backend hata
 * kataloğu için fazladır. İhtiyacımız olan tek şey: anahtar → şablon araması,
 * `{param}` interpolasyonu ve dil fallback'i.
 *
 * core/ dil bilmez: katalog (tr/en metinleri) PROJE verisidir, dışarıdan verilir
 * (aynı createLogger/createErrorHandler enjeksiyon deseni).
 *
 * KRİTİK geri-uyum: anahtar katalogda yoksa GİRDİ OLDUĞU GİBİ döner. Böylece
 * anahtara göç etmemiş kod (düz Türkçe metin fırlatan feature'lar) bozulmadan
 * geçer — çevirmen onların metnini "anahtar" sanıp bulamaz ve aynen döndürür.
 */
export type Catalog = Record<string, Record<string, string>>;

/** Bir katalogun tüm dillerindeki anahtarların birleşimi. */
type CatalogAllKeys<T> = { [L in keyof T]: keyof T[L] }[keyof T];

/**
 * Katalog PARİTE kilidi. Feature `*.messages.ts` dosyaları katalogunu bununla
 * sarar; her dilin AYNI anahtar kümesine sahip olmasını DERLEME anında zorlar —
 * bir dilde olup diğerinde eksik bir anahtar tip hatası verir (aksi halde o dilde
 * çevirmen sessizce varsayılan dile/anahtara düşerdi). `satisfies Catalog`'un
 * yerine geçer: hem tip daraltır (literal anahtarlar) hem pariteyi garanti eder.
 */
export function defineCatalog<T extends Record<string, Record<string, string>>>(
  catalog: T & { [L in keyof T]: Record<CatalogAllKeys<T>, string> }
): T {
  return catalog;
}

export type Translate = (
  key: string,
  locale: string,
  params?: Record<string, unknown>
) => string;

export function createTranslator(catalog: Catalog, defaultLocale: string): Translate {
  const interpolate = (tpl: string, params?: Record<string, unknown>) =>
    params
      ? tpl.replace(/\{(\w+)\}/g, (_, k) => (k in params ? String(params[k]) : `{${k}}`))
      : tpl;

  return (key, locale, params) => {
    // dil → varsayılan dil → anahtarın kendisi (geri uyum)
    const template = catalog[locale]?.[key] ?? catalog[defaultLocale]?.[key] ?? key;
    return interpolate(template, params);
  };
}

/**
 * Feature-bazlı katalog parçalarını tek bir kataloga birleştirir. Her feature
 * kendi mesajlarını kendi dosyasında tutar (bkz. `*.messages.ts`); kompozisyon
 * kökü (`shared/i18n/messages.ts`) bunları burada birleştirir — merkezî dev bir
 * mesaj dosyası dolmaz.
 *
 * Aynı (dil, anahtar) iki parçada tanımlıysa FIRLATIR: sessizce üzerine yazmak
 * yerine, iki feature'ın anahtar çakışmasını yükleme anında fail-fast yakalar.
 */
export function mergeCatalogs(...catalogs: Catalog[]): Catalog {
  const merged: Catalog = {};
  for (const catalog of catalogs) {
    for (const locale of Object.keys(catalog)) {
      const target = (merged[locale] ??= {});
      for (const key of Object.keys(catalog[locale])) {
        if (key in target) {
          throw new Error(`i18n katalog çakışması: "${key}" anahtarı "${locale}" dilinde birden fazla kez tanımlı.`);
        }
        target[key] = catalog[locale][key];
      }
    }
  }
  return merged;
}
