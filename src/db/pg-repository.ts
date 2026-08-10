import { sql, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { Database } from "./types";
import {
  aliveFilter,
  buildEqualityFilter,
  requireScopedFilter,
  resolveDeletedAt,
  withAliveFilter,
  type ReadOptions,
} from "./query-filters";

/**
 * İki repository'nin (tekil `id` ve bileşik anahtar) ORTAK tabanı.
 *
 * Paylaşılanlar, anahtar modelinden BAĞIMSIZ olanlardır: tablo/bağlantı
 * durumu, yumuşak silme semantiği, filtre kurma ve sayfalama. Anahtara bağlı
 * her şey (findById / findByKey, upsert…) alt sınıflarda kalır.
 *
 * Neden ortak taban: yumuşak silme semantiği iki yerde yaşarsa er ya da geç
 * ayrışır — biri `withDeleted`'ı unutur, diğeri silmeyi fiziksel yapar. Tek
 * yerde durması bir tercih değil, doğruluk meselesi.
 */
export abstract class PgRepository<TTable extends PgTable> {
  /** Soft-delete açıksa `deletedAt` kolonu; kapalıysa `undefined`. */
  protected readonly deletedAt?: PgColumn;

  protected constructor(
    protected readonly db: Database,
    protected readonly table: TTable,
    /** Hata mesajlarında görünen sınıf adı (ör. "BaseRepository"). */
    protected readonly repositoryName: string,
    protected readonly softDelete: boolean
  ) {
    this.deletedAt = resolveDeletedAt(table, softDelete, repositoryName);
  }

  /** Yumuşak silinmiş kayıtlar hariç, tüm satırların sayısı. */
  async count(options?: ReadOptions): Promise<number> {
    let query = this.db
      .select({ value: sql<number>`cast(count(*) as int)` })
      .from(this.table as PgTable)
      .$dynamic();

    const alive = this.aliveOnly(options);
    if (alive) query = query.where(alive);

    const rows = (await query) as { value: number }[];
    return rows[0]?.value ?? 0;
  }

  // ── Alt sınıflara açık yardımcılar ─────────────────────────────────────
  /** Soft-delete açıksa ve `withDeleted` istenmemişse "deletedAt IS NULL". */
  protected aliveOnly(options?: ReadOptions): SQL | undefined {
    return aliveFilter(this.deletedAt, options);
  }

  /** Bir koşulu canlılık filtresiyle AND'ler. */
  protected scoped(condition: SQL, options?: ReadOptions): SQL {
    return withAliveFilter(condition, this.deletedAt, options);
  }

  /** `{ kolon: değer }` → SQL. Boş nesne tüm satırları hedefler. */
  protected filterOf(where: Record<string, unknown>, method: string): SQL {
    return buildEqualityFilter(this.table, where, `${this.repositoryName}.${method}`);
  }

  /** Yazma için filtre: boş nesne REDDEDİLİR (tüm tabloyu etkilerdi). */
  protected requiredFilterOf(where: Record<string, unknown>, method: string): SQL {
    return requireScopedFilter(this.table, where, `${this.repositoryName}.${method}`);
  }

  /** `limit`/`offset` verilmişse uygular; verilmemişse sorguyu olduğu gibi döner. */
  protected applyRange<TQuery extends { limit(n: number): TQuery; offset(n: number): TQuery }>(
    query: TQuery,
    options?: { limit?: number; offset?: number }
  ): TQuery {
    let ranged = query;
    if (options?.limit !== undefined) ranged = ranged.limit(options.limit);
    if (options?.offset !== undefined) ranged = ranged.offset(options.offset);
    return ranged;
  }

  /**
   * Koşula uyan satırları siler ve etkilenen sayıyı döner. `softDelete` açıksa
   * `deletedAt` damgalanır, değilse satır fiziksel olarak silinir — silme
   * semantiğinin TEK tanımı burasıdır.
   */
  protected async deleteMatching(condition: SQL): Promise<number> {
    if (this.softDelete) {
      const rows = (await this.db
        .update(this.table)
        .set({ deletedAt: new Date() } as never)
        .where(condition)
        .returning()) as unknown[];
      return rows.length;
    }
    const rows = (await this.db.delete(this.table).where(condition).returning()) as unknown[];
    return rows.length;
  }
}
