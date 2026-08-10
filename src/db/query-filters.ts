import { and, eq, isNull, sql, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";

/**
 * Repository'lerin paylaştığı filtre kurma mantığı. `BaseRepository` (tekil `id`)
 * ve `CompositeKeyRepository` (bileşik anahtar) aynı kuralları uygular; kural iki
 * yerde yaşamasın diye buraya alındı.
 *
 * Saf fonksiyonlardır: durum tutmaz, `db`ye dokunmaz.
 */

/** Okuma metodlarında yumuşak silinmiş kayıtları da dahil etme seçeneği. */
export interface ReadOptions {
  withDeleted?: boolean;
}

/** Tablodaki bir kolonu adıyla çözer; yoksa/geçersizse FIRLATIR. */
export function resolveColumn(table: PgTable, name: string, context: string): PgColumn {
  const column = (table as unknown as Record<string, unknown>)[name] as PgColumn | undefined;
  if (!column || typeof (column as { name?: unknown }).name !== "string") {
    throw new Error(`${context}: '${name}' bu tabloda bir kolon değil.`);
  }
  return column;
}

/**
 * `{ kolon: değer }` nesnesini `and(eq | isNull)` zincirine çevirir. Değer `null`
 * ise `IS NULL`. Boş nesne tüm satırları hedefler (`1 = 1`) — yalnızca okumalarda
 * anlamlıdır; yazma metodları bunu ayrıca engeller (bkz. `requireScopedFilter`).
 *
 * Güvenlik: bir kolon değeri `undefined` verilirse HATA fırlatır. `undefined`
 * neredeyse her zaman bir bug'dır (ör. tanımsız değişken) ve sessizce geçerse
 * "tüm tabloyu hedefle"ye dönüşebilir — `IS NULL` istiyorsan açıkça `null` geç.
 */
export function buildEqualityFilter(
  table: PgTable,
  filter: Record<string, unknown>,
  context: string
): SQL {
  const conditions: SQL[] = [];

  for (const [name, value] of Object.entries(filter)) {
    if (value === undefined) {
      throw new Error(`${context}: '${name}' değeri undefined. IS NULL için açıkça null geç.`);
    }
    const column = resolveColumn(table, name, context);
    conditions.push(value === null ? isNull(column) : eq(column, value));
  }

  if (conditions.length === 0) return sql`1 = 1`;
  return conditions.length === 1 ? conditions[0] : (and(...conditions) as SQL);
}

/**
 * Yazma (toplu update/delete) için filtreyi doğrular: BOŞ filtreyle toplu işlemi
 * engeller. Kasıtlı "tümünü sil/güncelle" istisnai bir iştir ve bilerek ham
 * Drizzle ile yazılmalıdır — kaza eseri `{}` tabloyu silmesin.
 */
export function requireScopedFilter(
  table: PgTable,
  filter: Record<string, unknown>,
  context: string
): SQL {
  if (Object.keys(filter).length === 0) {
    throw new Error(`${context}: boş filtreyle toplu yazma engellendi (tüm tabloyu etkilerdi).`);
  }
  return buildEqualityFilter(table, filter, context);
}

/** Soft-delete açıksa ve `withDeleted` istenmemişse "deletedAt IS NULL" koşulu. */
export function aliveFilter(
  deletedAt: PgColumn | undefined,
  options?: ReadOptions
): SQL | undefined {
  if (!deletedAt || options?.withDeleted) return undefined;
  return isNull(deletedAt);
}

/** Bir koşulu canlılık filtresiyle AND'ler. */
export function withAliveFilter(
  condition: SQL,
  deletedAt: PgColumn | undefined,
  options?: ReadOptions
): SQL {
  const alive = aliveFilter(deletedAt, options);
  return alive ? (and(condition, alive) as SQL) : condition;
}

/**
 * `softDelete: true` verilmişse tablodaki `deletedAt` kolonunu çözer; kolon yoksa
 * FIRLATIR (yapılandırma hatası açılışta yakalansın).
 */
export function resolveDeletedAt(
  table: PgTable,
  softDelete: boolean,
  context: string
): PgColumn | undefined {
  if (!softDelete) return undefined;
  const column = (table as unknown as Record<string, unknown>).deletedAt as PgColumn | undefined;
  if (!column) {
    throw new Error(`${context}: softDelete=true ama tabloda \`deletedAt\` kolonu yok.`);
  }
  return column;
}
