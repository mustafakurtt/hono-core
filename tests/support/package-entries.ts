import { resolve } from "node:path";

/**
 * `package.json`'daki `exports` haritasını okur — yani paketin TÜKETİCİYE açtığı
 * genel yüzeyi. Bağımlılık sözleşmesi testi bu listeyi gezer; girişler elle
 * yazılmaz ki `exports`a yeni bir alt yol eklendiğinde test onu KENDİLİĞİNDEN
 * kapsasın (unutulan giriş = kapsanmayan sözleşme).
 *
 * Yalnızca kaynak dosyaya işaret eden girişler döner; `./package.json` gibi
 * veri girişleri elenir (import grafiği çıkarılamaz, anlamı da yoktur).
 */

const PACKAGE_MANIFEST = "package.json";
const SUBPATH_PREFIX = "./";
const SOURCE_EXTENSION = ".ts";

/** `exports` haritasındaki tek bir genel giriş. */
export interface PackageEntry {
  /** Tüketicinin yazdığı alt yol, önek olmadan: `"./http"` → `"http"`. */
  subpath: string;
  /** Giriş dosyasının mutlak yolu. */
  file: string;
}

interface PackageManifest {
  exports?: Record<string, string>;
}

/**
 * Verilen paket kökündeki `exports` girişlerini okur.
 *
 * `exports` yalnızca string hedefleri destekleyen sade biçimde tutuluyor
 * (koşullu `{ import, require }` nesneleri YOK). Biçim bir gün değişirse bu
 * fonksiyon fırlatır — sessizce boş liste dönüp testi anlamsızlaştırmaz.
 */
export async function readPackageEntries(packageRoot: string): Promise<PackageEntry[]> {
  const manifestPath = resolve(packageRoot, PACKAGE_MANIFEST);
  const manifest = (await Bun.file(manifestPath).json()) as PackageManifest;

  if (!manifest.exports) {
    throw new Error(`package-entries: ${manifestPath} içinde "exports" alanı yok.`);
  }

  return Object.entries(manifest.exports)
    .filter(([, target]) => target.endsWith(SOURCE_EXTENSION))
    .map(([subpath, target]) => {
      if (typeof target !== "string") {
        throw new Error(`package-entries: "${subpath}" hedefi string değil; koşullu exports desteklenmiyor.`);
      }
      return {
        subpath: subpath.startsWith(SUBPATH_PREFIX) ? subpath.slice(SUBPATH_PREFIX.length) : subpath,
        file: resolve(packageRoot, target),
      };
    });
}
