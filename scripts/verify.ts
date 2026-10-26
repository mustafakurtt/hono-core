import { resolve } from "node:path";

/**
 * YEREL DOĞRULAMA — `bun run verify`
 *
 * CI'ın yaptığını tek komutta, yerelde yapar; ayrıca CI'ın yapamadığını da:
 * bilinen tüketicilere karşı salt okunur uyum kontrolü. Her etiketten önce
 * koşulur (bkz. docs/surumler/README.md "yayın öncesi kontrol listesi").
 *
 *   1. typecheck
 *   2. testler — DB testleri ATLANIRSA başarısız sayılır (yayın öncesi hepsi koşmalı)
 *   3. check:consumer — `.consumers` dosyasındaki her yol için
 *
 * DB: `docker compose up -d` (port 5433). `DATABASE_URL` verilmemişse
 * docker-compose.yml'deki adres kullanılır.
 *
 * `.consumers`: satır başına bir tüketici yolu (core köküne göre ya da mutlak);
 * `#` ile başlayan satırlar yorumdur. Makineye özgü olduğu için depoya girmez
 * (.gitignore). Dosya yoksa bu adım uyarıyla atlanır.
 */

const CORE_ROOT = resolve(import.meta.dir, "..");
const DEFAULT_DATABASE_URL = "postgres://postgres:postgres@localhost:5433/hono_core_test";
const CONSUMERS_FILE = resolve(CORE_ROOT, ".consumers");

interface StepResult {
  name: string;
  ok: boolean;
  note?: string;
}

async function run(command: string[], env: Record<string, string> = {}): Promise<{ code: number; output: string }> {
  const proc = Bun.spawn(command, {
    cwd: CORE_ROOT,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, output: stdout + stderr };
}

async function readConsumers(): Promise<string[]> {
  const file = Bun.file(CONSUMERS_FILE);
  if (!(await file.exists())) return [];
  return (await file.text())
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

const results: StepResult[] = [];

const typecheck = await run(["bun", "run", "typecheck"]);
results.push({ name: "typecheck", ok: typecheck.code === 0 });
if (typecheck.code !== 0) console.log(typecheck.output);

const databaseUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
const tests = await run(["bun", "test"], { DATABASE_URL: databaseUrl });
const summary = tests.output.match(/^\s*\d+ (pass|fail|skip)$/gm)?.map((line) => line.trim()) ?? [];
const skipped = summary.some((line) => line.endsWith("skip"));
results.push({
  name: "test",
  ok: tests.code === 0 && !skipped,
  note: skipped ? `${summary.join(", ")} — DB kapalı mı? docker compose up -d` : summary.join(", "),
});
if (tests.code !== 0) console.log(tests.output);

const consumers = await readConsumers();
if (consumers.length === 0) {
  results.push({ name: "check:consumer", ok: true, note: "atlandı — .consumers dosyası yok" });
}
for (const consumer of consumers) {
  const check = await run(["bun", "run", "scripts/check-consumer.ts", consumer]);
  results.push({ name: `check:consumer ${consumer}`, ok: check.code === 0 });
  if (check.code !== 0) console.log(check.output);
}

console.log("");
for (const { name, ok, note } of results) console.log(`${ok ? "✓" : "✗"} ${name}${note ? `  (${note})` : ""}`);

process.exit(results.every((result) => result.ok) ? 0 : 1);
