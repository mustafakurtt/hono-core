import { describe, expect, test } from "bun:test";
import { relative, resolve, sep } from "node:path";
import { buildModuleGraph, type ModuleGraph } from "./support/module-graph";
import { readPackageEntries } from "./support/package-entries";

/**
 * BAĞIMLILIK SÖZLEŞMESİ — "hangi alt yol hangi peer'ı kurmayı zorunlu kılar?"
 *
 * Core'un peer'larının çoğu `peerDependenciesMeta` ile OPSİYONEL işaretli ve
 * README "yalnızca kullandığın modülünkini kurarsın" diyor. Bu vaat, core'un
 * kendi testleriyle DOĞRULANAMAZ: testler her zaman tüm peer'lar kurulu bir
 * ortamda koşar, dolayısıyla bir barrel yanlışlıkla opsiyonel bir peer'ı
 * zorunlu kılsa bile yeşil kalır. Tüketici bunu ilk `bun run`'da öğrenir.
 *
 * Bu test o boşluğu kapatır: her alt yolun import grafiğini çıkarır (kurulum
 * yapmadan, bkz. `support/module-graph.ts`) ve aşağıdaki sözleşmeye karşı
 * doğrular. Sözleşme İKİ YÖNLÜ zorlanır:
 *
 *   1. Bildirilmemiş bir peer'a uzanan alt yol  → test kırılır (vaat bozuldu).
 *   2. Bildirilen ama artık gerekmeyen peer     → test kırılır (bildirim bayat).
 *
 * İkincisi, bir modül yapısal arayüze geçtiğinde (ör. `RedisCacheStore`'un
 * ioredis'i import etmeyip `RedisCacheClient` alması) sözleşmenin kendiliğinden
 * temizlenmesini sağlar.
 */

const PACKAGE_ROOT = resolve(import.meta.dir, "..");
const NODE_BUILTIN_PREFIX = "node:";
const POSIX_SEPARATOR = "/";

/**
 * Her tüketicinin kurmak zorunda olduğu peer'lar; her alt yolda serbesttir.
 * Bunlar `peerDependenciesMeta`'da opsiyonel İŞARETLİ DEĞİLDİR.
 */
const REQUIRED_PEERS: readonly string[] = ["hono", "pino", "zod"];

/**
 * Alt yol → o alt yolu import etmenin zorunlu kıldığı OPSİYONEL peer'lar.
 *
 * Burada adı geçmeyen her alt yol, hiçbir opsiyonel peer'a uzanmamalıdır. Bu
 * varsayılan bilinçlidir: `exports`a yeni bir alt yol eklendiğinde en katı
 * kural kendiliğinden uygulanır ve bir peer'ı sessizce zorunlu kılamaz.
 *
 * Bir girişi buraya EKLEMEK bir tasarım kararıdır: "bu alt yolu import eden
 * zaten bu paketi istiyordur" demektir. `/mail` için doğrudur (nodemailer'sız
 * anlamı yok); `/http` için değildir (hata sözleşmesi için import edilir).
 */
const OPTIONAL_PEERS_BY_SUBPATH: Readonly<Record<string, readonly string[]>> = {
  db: ["drizzle-orm"],
  mail: ["nodemailer"],
  metrics: ["prom-client"],
  redis: ["ioredis"],
  // Doğrulama katmanı `/http` barrel'ından AYRI tutulur: hata sözleşmesini
  // isteyen proje zod-validator kurmak zorunda kalmasın diye. Bu alt yolu
  // import eden zaten zod doğrulaması istiyordur.
  "http/validation": ["@hono/zod-validator"],
};

const isNodeBuiltin = (packageName: string): boolean => packageName.startsWith(NODE_BUILTIN_PREFIX);

/** Kök dizine göre, platformdan bağımsız okunur yol (Windows'ta da `/`). */
const displayPath = (file: string): string =>
  relative(PACKAGE_ROOT, file).split(sep).join(POSIX_SEPARATOR);

/** Grafikteki, kurulumu gerçekten gereken opsiyonel paket adları (tekilleştirilmiş). */
function optionalPeersUsedBy(graph: ModuleGraph): string[] {
  const names = graph.externals
    .map((external) => external.packageName)
    .filter((name) => !isNodeBuiltin(name) && !REQUIRED_PEERS.includes(name));
  return [...new Set(names)].sort();
}

/**
 * Beklenmeyen paketleri, onları çeken dosyayla birlikte biçimlendirir.
 * Test kırıldığında "hangi paket" değil "hangi dosya yüzünden" görünsün diye.
 */
function describeOffenders(graph: ModuleGraph, unexpected: readonly string[]): string[] {
  return graph.externals
    .filter((external) => unexpected.includes(external.packageName))
    .map((external) => `${external.specifier} ← ${displayPath(external.importedBy)}`)
    .sort();
}

const entries = await readPackageEntries(PACKAGE_ROOT);

describe("bağımlılık sözleşmesi", () => {
  test("exports haritası kaynak girişleri içeriyor", () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  for (const entry of entries) {
    const declared = [...(OPTIONAL_PEERS_BY_SUBPATH[entry.subpath] ?? [])].sort();

    describe(`/${entry.subpath}`, () => {
      test("yalnızca bildirilen opsiyonel peer'ları gerektirir", async () => {
        const graph = await buildModuleGraph(entry.file);
        const unexpected = optionalPeersUsedBy(graph).filter((name) => !declared.includes(name));

        // Boş dizi beklenir; kırılırsa çıktı hangi dosyanın çektiğini gösterir.
        expect(describeOffenders(graph, unexpected)).toEqual([]);
      });

      test("bildirilen opsiyonel peer'ların hepsi hâlâ gerekli", async () => {
        const graph = await buildModuleGraph(entry.file);
        const used = optionalPeersUsedBy(graph);

        expect(declared.filter((name) => !used.includes(name))).toEqual([]);
      });
    });
  }
});
