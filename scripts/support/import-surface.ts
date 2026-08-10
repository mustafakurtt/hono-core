import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ConsumerImport } from "./consumer-imports";

/**
 * Tüketicinin core'a yaptığı import ifadelerini SENTETİK bir projede derleyerek
 * doğrular: her isim (değer VE tip) core'un bugünkü yüzeyinde hâlâ var mı?
 *
 * Neden `tsc`: core'un export yüzeyini elle çıkarmak tip-only export'ları
 * kaçırır (`Bun.Transpiler.scan` yalnızca değerleri görür), bu da `type
 * RbacVariables` gibi import'larda YANLIŞ ALARM üretirdi. Kararı zaten
 * derleyici veriyor; onu çağırmak hem tam kapsam hem sıfır kopya kural demek.
 *
 * Kapsam sınırı: yalnızca import YÜZEYİ doğrulanır (isimlerin varlığı), çağrı
 * imzaları değil. `enforce(authz)` → `enforce(authz, user)` gibi bir değişiklik
 * ancak tüketicinin tamamı derlenerek yakalanır.
 */

const WORKSPACE_DIRECTORY = ".surface-check";
const TSCONFIG_NAME = "tsconfig.json";
const MODULE_PREFIX = "module-";
const SOURCE_EXTENSION = ".ts";
const TSC_ENTRY = "node_modules/typescript/bin/tsc";
const BUN_EXECUTABLE = "bun";

/**
 * Bir uyumsuzluk — sentetik dosyaya değil, TÜKETİCİNİN kaynağına bağlanmış
 * hâliyle. `tsc` `module-33.ts` der; geliştiricinin görmesi gereken, hangi
 * ifadenin hangi dosyada kırıldığıdır.
 */
export interface SurfaceDiagnostic {
  /** `tsc` mesajı, sentetik dosya/konum öneki temizlenmiş. */
  message: string;
  /** Kırılan import ifadesi (tüketici kaynağındaki hâliyle). */
  statement: string;
  /** Bu ifadeyi içeren tüketici dosyaları. */
  usedBy: string[];
}

export interface SurfaceCheckResult {
  /** Derlenen benzersiz ifade sayısı. */
  checkedStatements: number;
  /** Boşsa yüzey uyumlu. */
  diagnostics: SurfaceDiagnostic[];
}

/**
 * Her ifade AYRI dosyaya yazılır: iki tüketici dosyası aynı ismi import
 * ettiğinde (ör. `guard`) tek dosyada "duplicate identifier" çakışması olurdu.
 */
function renderModules(statements: readonly string[]): { name: string; content: string }[] {
  return statements.map((statement, index) => ({
    name: `${MODULE_PREFIX}${index}${SOURCE_EXTENSION}`,
    content: `${statement};\nexport {};\n`,
  }));
}

/**
 * Core'un kendi `tsconfig`'ini genişletir ki peer tipleri ve `bun-types` core'un
 * `node_modules`'ünden doğal olarak çözülsün. İki katılık gevşetilir:
 * sentetik dosyalarda import'lar KULLANILMAZ, bu core'un kuralı değil bu
 * doğrulamanın doğasıdır.
 */
function renderTsconfig(packageName: string): string {
  return JSON.stringify(
    {
      extends: `../${TSCONFIG_NAME}`,
      compilerOptions: {
        noEmit: true,
        noUnusedLocals: false,
        noUnusedParameters: false,
        baseUrl: "..",
        paths: { [`${packageName}/*`]: ["src/*"] },
      },
      include: [`*${SOURCE_EXTENSION}`],
    },
    null,
    2
  );
}

/** `tsc` satır biçimi: `<dosya>(<satır>,<sütun>): <mesaj>`. */
const TSC_LINE = /^(\S+?)\((\d+),(\d+)\):\s*(.*)$/;
const MODULE_INDEX = new RegExp(`${MODULE_PREFIX}(\\d+)\\${SOURCE_EXTENSION}$`);

/** Sentetik dosya adından ifade sırasını çıkarır; eşleşmezse `null`. */
function statementIndexOf(filePath: string): number | null {
  const match = MODULE_INDEX.exec(filePath.replace(/\\/g, "/"));
  return match ? Number(match[1]) : null;
}

/**
 * `tsc` çıktısını tüketici kaynağına bağlı tanılara çevirir. Eşleştirilemeyen
 * satırlar (genel derleyici hataları) atılmaz; ifadesiz olarak raporlanır —
 * sessizce yutmak, kontrolü yanlış yeşile çevirirdi.
 */
function toDiagnostics(
  output: string,
  statements: readonly string[],
  usedByStatement: ReadonlyMap<string, string[]>
): SurfaceDiagnostic[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const parsed = TSC_LINE.exec(line);
      const index = parsed ? statementIndexOf(parsed[1]) : null;
      if (index === null || !statements[index]) {
        return { message: line, statement: "", usedBy: [] };
      }
      const statement = statements[index];
      return { message: parsed?.[4] ?? line, statement, usedBy: usedByStatement.get(statement) ?? [] };
    });
}

/** İfade → onu içeren tüketici dosyaları. */
function groupUsageByStatement(imports: readonly ConsumerImport[]): Map<string, string[]> {
  const usage = new Map<string, Set<string>>();
  for (const entry of imports) {
    const files = usage.get(entry.statement) ?? new Set<string>();
    files.add(entry.file);
    usage.set(entry.statement, files);
  }
  return new Map([...usage].map(([statement, files]) => [statement, [...files].sort()]));
}

export async function checkImportSurface(
  imports: readonly ConsumerImport[],
  coreRoot: string,
  packageName: string
): Promise<SurfaceCheckResult> {
  const statements = [...new Set(imports.map((entry) => entry.statement))].sort();
  const workspace = resolve(coreRoot, WORKSPACE_DIRECTORY);

  try {
    await rm(workspace, { recursive: true, force: true });

    for (const module of renderModules(statements)) {
      await Bun.write(join(workspace, module.name), module.content);
    }
    await Bun.write(join(workspace, TSCONFIG_NAME), renderTsconfig(packageName));

    const tsc = Bun.spawn(
      [BUN_EXECUTABLE, resolve(coreRoot, TSC_ENTRY), "--noEmit", "--project", workspace],
      { cwd: coreRoot, stdout: "pipe", stderr: "pipe" }
    );

    const [stdout, stderr] = await Promise.all([
      new Response(tsc.stdout).text(),
      new Response(tsc.stderr).text(),
    ]);
    await tsc.exited;

    return {
      checkedStatements: statements.length,
      diagnostics: toDiagnostics(`${stdout}\n${stderr}`, statements, groupUsageByStatement(imports)),
    };
  } finally {
    // Çalışma alanı geçicidir; başarısızlıkta bile geride bırakılmaz.
    await rm(workspace, { recursive: true, force: true });
  }
}
