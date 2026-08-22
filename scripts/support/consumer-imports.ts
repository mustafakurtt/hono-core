import { relative, sep } from "node:path";

/**
 * Bir TÜKETİCİ projenin kaynağından, core'a yapılan import/export ifadelerini
 * toplar. Salt-okunur: tüketici deposuna hiçbir şey yazılmaz, kurulum yapılmaz.
 *
 * Neden ifadenin TAMAMI alınır da isimler ayrıştırılmaz: `{ a, type B as C }`
 * gibi bir listeyi elle ayrıştırmak kırılgandır ve sessizce eksik raporlar.
 * İfade olduğu gibi alınıp `tsc`'ye verilir — isimlerin var olup olmadığına
 * karar vermek zaten derleyicinin işidir (bkz. `import-surface.ts`).
 */

const SOURCE_GLOB = "**/*.ts";
const IGNORED_DIRECTORIES = ["node_modules", "dist", "generated"] as const;
const POSIX_SEPARATOR = "/";
const SUBPATH_SEPARATOR = "/";

/** Tüketicide görülen tek bir core başvurusu. */
export interface ConsumerImport {
  /** Kaynaktaki ifadenin tamamı, ör. `import { guard } from "…/rbac"`. */
  statement: string;
  /** Paket adından sonraki alt yol, ör. `"rbac"`. Kök import ise boş string. */
  subpath: string;
  /** İfadenin bulunduğu dosya — kök dizine göre, okunur biçimde. */
  file: string;
}

/**
 * `import ... from "<paket>[/altyol]"` ve aynı biçimdeki `export ... from`
 * ifadelerini yakalar. `[^;]*?` gövdeyi tek ifadeyle sınırlar: çok satırlı
 * isim listeleri kapsanır ama eşleşme bir sonraki ifadeye TAŞMAZ.
 */
function buildImportPattern(packageName: string): RegExp {
  const escapedName = packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(?:import|export)\\s+[^;]*?from\\s*["'](${escapedName}(?:\\/[^"']+)?)["']`,
    "g"
  );
}

const isIgnored = (file: string): boolean =>
  file.split(sep).some((segment) => IGNORED_DIRECTORIES.includes(segment as never));

/** Paket tanımlayıcısından alt yolu ayırır: `"pkg/rbac"` → `"rbac"`, `"pkg"` → `""`. */
function subpathOf(specifier: string, packageName: string): string {
  const remainder = specifier.slice(packageName.length);
  return remainder.startsWith(SUBPATH_SEPARATOR)
    ? remainder.slice(SUBPATH_SEPARATOR.length)
    : remainder;
}

export async function collectConsumerImports(
  consumerRoot: string,
  packageName: string
): Promise<ConsumerImport[]> {
  const pattern = buildImportPattern(packageName);
  const found: ConsumerImport[] = [];

  for await (const file of new Bun.Glob(SOURCE_GLOB).scan({ cwd: consumerRoot, absolute: true })) {
    if (isIgnored(relative(consumerRoot, file))) continue;

    const source = await Bun.file(file).text();
    for (const match of source.matchAll(pattern)) {
      const [statement = "", specifier = ""] = match;
      found.push({
        statement: statement.trim(),
        subpath: subpathOf(specifier, packageName),
        file: relative(consumerRoot, file).split(sep).join(POSIX_SEPARATOR),
      });
    }
  }

  return found;
}
