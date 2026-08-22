import { dirname, join, resolve } from "node:path";

/**
 * Bir giriş dosyasından STATİK olarak ulaşılabilen modül grafiğini çıkarır.
 *
 * Amaç: "bu alt yolu import eden bir tüketici hangi paketleri kurmak zorunda?"
 * sorusunu, gerçekten kurulum yapmadan cevaplamak. Grafiği `Bun.Transpiler`
 * üretir; transpiler `import type` satırlarını tam da çalışma anındaki gibi
 * DÜŞÜRÜR — yani buradaki sonuç, çalışma anında çözülmesi gereken bağımlılık
 * kümesiyle birebir örtüşür (bkz. `dependency-contract.test.ts`).
 *
 * Bu modül yalnızca OLGU üretir, hüküm vermez: hangi paketin kabul edilebilir
 * olduğuna politika karar verir. Böylece analiz mekanizması ile bağımlılık
 * sözleşmesi birbirinden ayrı kalır.
 *
 * Sınır: yalnızca statik `import`/`export ... from` görülür. Core'da dinamik
 * `import()` ve `require()` yoktur; eklenirse bu analiz eksik kalır.
 */

const TYPESCRIPT_LOADER = "ts";
const SOURCE_EXTENSION = ".ts";
const DIRECTORY_ENTRY = `index${SOURCE_EXTENSION}`;
const RELATIVE_PREFIX = ".";
const SCOPE_PREFIX = "@";
const PATH_SEPARATOR = "/";

/** Grafikte görülen, projeye dış bir modüle yapılan tek bir başvuru. */
export interface ExternalImport {
  /** Kaynaktaki ham tanımlayıcı, ör. `"hono/jwt"`. */
  specifier: string;
  /** Kurulması gereken paketin adı, ör. `"hono"`. */
  packageName: string;
  /** Bu başvuruyu yapan yerel dosyanın mutlak yolu. */
  importedBy: string;
}

export interface ModuleGraph {
  /** Grafiğe dahil tüm yerel dosyalar (giriş dosyası dahil), mutlak yol. */
  localFiles: string[];
  /** Dış paketlere yapılan başvurular. Aynı paket birden çok kez görünebilir. */
  externals: ExternalImport[];
}

const isRelative = (specifier: string): boolean => specifier.startsWith(RELATIVE_PREFIX);

/**
 * Tanımlayıcıdan kurulacak paket adını çıkarır. Kapsamlı (scoped) paketlerde
 * ilk İKİ segment ada dahildir: `@hono/zod-validator/x` → `@hono/zod-validator`.
 */
export function packageNameOf(specifier: string): string {
  const segments = specifier.split(PATH_SEPARATOR);
  return specifier.startsWith(SCOPE_PREFIX)
    ? segments.slice(0, 2).join(PATH_SEPARATOR)
    : (segments[0] ?? "");
}

/**
 * Uzantısız göreli tanımlayıcıyı gerçek dosyaya çözer: önce `<yol>.ts`, sonra
 * `<yol>/index.ts` (core'un barrel düzeni). Çözülemezse FIRLATIR — sessizce
 * atlamak, grafikte fark edilmeyen bir boşluk bırakırdı.
 */
async function resolveLocalModule(specifier: string, importedBy: string): Promise<string> {
  const base = resolve(dirname(importedBy), specifier);
  const candidates = [`${base}${SOURCE_EXTENSION}`, join(base, DIRECTORY_ENTRY)];

  for (const candidate of candidates) {
    if (await Bun.file(candidate).exists()) return candidate;
  }

  throw new Error(
    `module-graph: "${specifier}" çözülemedi (kaynak: ${importedBy}). Denenen: ${candidates.join(", ")}`
  );
}

/** Giriş dosyasından başlayarak yerel import'ları gezer; döngüye karşı güvenlidir. */
export async function buildModuleGraph(entryFile: string): Promise<ModuleGraph> {
  const transpiler = new Bun.Transpiler({ loader: TYPESCRIPT_LOADER });
  const visited = new Set<string>();
  const externals: ExternalImport[] = [];
  const pending = [resolve(entryFile)];

  while (pending.length > 0) {
    const file = pending.pop() as string;
    if (visited.has(file)) continue;
    visited.add(file);

    const source = await Bun.file(file).text();
    for (const { path: specifier } of transpiler.scanImports(source)) {
      if (isRelative(specifier)) {
        pending.push(await resolveLocalModule(specifier, file));
        continue;
      }
      externals.push({ specifier, packageName: packageNameOf(specifier), importedBy: file });
    }
  }

  return { localFiles: [...visited].sort(), externals };
}
