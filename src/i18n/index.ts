/**
 * core/i18n barrel — el yapımı, sıfır-bağımlılıklı çok dillilik.
 *
 * `createTranslator` anahtar katalogda yoksa GİRDİYİ AYNEN döndürür — göç etmemiş
 * düz metinler bozulmaz (geri uyum dikişi). `defineCatalog` diller arası anahtar
 * paritesini DERLEME anında zorlar; `mergeCatalogs` feature kataloglarını birleştirir
 * ve çakışmada yükleme anında fırlatır (fail-fast).
 */
export {
  createTranslator,
  defineCatalog,
  mergeCatalogs,
  type Catalog,
  type Translate,
} from "./translator";

export {
  resolveLocale,
  createLocaleMiddleware,
  type LocaleVariables,
  type LocaleMiddlewareOptions,
} from "./locale";
