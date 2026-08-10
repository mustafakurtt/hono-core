import { resolve } from "node:path";
import { collectConsumerImports, type ConsumerImport } from "./support/consumer-imports";
import { checkImportSurface } from "./support/import-surface";

/**
 * TÜKETİCİ UYUM KONTROLÜ — `bun run check:consumer <tüketici-yolu>`
 *
 * Core'daki bugünkü değişikliklerin gerçek bir tüketiciyi kırıp kırmadığını,
 * o projeye HİÇ DOKUNMADAN söyler: kaynağı yalnızca okur, kurulum yapmaz,
 * `node_modules`'üne yazmaz.
 *
 * İki kontrol yapılır:
 *   1. ALT YOL  — tüketicinin import ettiği her alt yol `exports` haritasında
 *                 hâlâ var mı? (`C-1` sınıfı kırılmalar: taşınan/kaldırılan modül)
 *   2. YÜZEY    — her ifadedeki isimler (değer ve tip) hâlâ export ediliyor mu?
 *                 Kararı `tsc` verir (bkz. `support/import-surface.ts`).
 *
 * Kapsam sınırı: çağrı imzaları doğrulanmaz. Tüketicinin tamamını derlemek
 * gerekir; bu betik bilinçli olarak salt-okunur ve hızlıdır.
 */

const PACKAGE_MANIFEST = "package.json";
const SUBPATH_PREFIX = "./";
const MANIFEST_SUBPATH = "package.json";
const CORE_ROOT = resolve(import.meta.dir, "..");

const EXIT_SUCCESS = 0;
const EXIT_FAILURE = 1;

interface CoreManifest {
  name: string;
  exports?: Record<string, string>;
}

/** `exports` anahtarlarını tüketicinin yazdığı biçime çevirir: `"./rbac"` → `"rbac"`. */
function publicSubpathsOf(manifest: CoreManifest): Set<string> {
  const keys = Object.keys(manifest.exports ?? {});
  const subpaths = keys
    .map((key) => (key.startsWith(SUBPATH_PREFIX) ? key.slice(SUBPATH_PREFIX.length) : key))
    .filter((subpath) => subpath !== MANIFEST_SUBPATH);
  return new Set(subpaths);
}

/** `exports`ta karşılığı olmayan başvurular — kaldırılmış/taşınmış alt yollar. */
function findUnknownSubpaths(
  imports: readonly ConsumerImport[],
  publicSubpaths: ReadonlySet<string>
): ConsumerImport[] {
  return imports.filter((entry) => !publicSubpaths.has(entry.subpath));
}

function reportUsage(imports: readonly ConsumerImport[]): void {
  const perSubpath = new Map<string, number>();
  for (const entry of imports) {
    perSubpath.set(entry.subpath, (perSubpath.get(entry.subpath) ?? 0) + 1);
  }

  const rows = [...perSubpath.entries()].sort(([, a], [, b]) => b - a);
  for (const [subpath, count] of rows) {
    console.log(`   /${subpath.padEnd(18)} ${count}`);
  }
}

async function main(): Promise<number> {
  const consumerRoot = process.argv[2];
  if (!consumerRoot) {
    console.error("Kullanım: bun run check:consumer <tüketici-proje-yolu>");
    return EXIT_FAILURE;
  }

  const manifest = (await Bun.file(resolve(CORE_ROOT, PACKAGE_MANIFEST)).json()) as CoreManifest;
  const imports = await collectConsumerImports(resolve(consumerRoot), manifest.name);

  console.log(`Tüketici : ${resolve(consumerRoot)}`);
  console.log(`Paket    : ${manifest.name}`);

  if (imports.length === 0) {
    console.error(`\n✗ Bu projede "${manifest.name}" import'u bulunamadı — yol doğru mu?`);
    return EXIT_FAILURE;
  }

  console.log(`Başvuru  : ${imports.length} import ifadesi\n`);
  reportUsage(imports);

  const unknown = findUnknownSubpaths(imports, publicSubpathsOf(manifest));
  if (unknown.length > 0) {
    console.error(`\n✗ exports haritasında olmayan alt yol (${unknown.length}):`);
    for (const entry of unknown) console.error(`   /${entry.subpath}  ← ${entry.file}`);
    return EXIT_FAILURE;
  }
  console.log("\n✓ Alt yolların tamamı exports haritasında mevcut.");

  const surface = await checkImportSurface(imports, CORE_ROOT, manifest.name);
  if (surface.diagnostics.length > 0) {
    console.error(`\n✗ Import yüzeyi uyumsuz (${surface.checkedStatements} ifade derlendi):\n`);
    for (const diagnostic of surface.diagnostics) {
      console.error(`   ${diagnostic.message}`);
      if (diagnostic.statement) console.error(`     ifade    : ${diagnostic.statement}`);
      if (diagnostic.usedBy.length > 0) console.error(`     kullanan : ${diagnostic.usedBy.join(", ")}`);
      console.error("");
    }
    return EXIT_FAILURE;
  }

  console.log(`✓ Import yüzeyi uyumlu (${surface.checkedStatements} benzersiz ifade derlendi).`);
  return EXIT_SUCCESS;
}

process.exit(await main());
