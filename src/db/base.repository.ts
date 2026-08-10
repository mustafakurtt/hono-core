import { and, desc, eq, lt, sql, type InferInsertModel, type InferSelectModel, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { PgRepository } from "./pg-repository";
import type { ReadOptions } from "./query-filters";
import type { Database, IdOf, WithId } from "./types";

export type { ReadOptions };
export type { Database, IdOf, WithId };

/**
 * ⚠️ Drizzle + PostgreSQL'e ÖZGÜ modül. core/'un tek DB/ORM-bağımlı parçası
 * (base.entity ile birlikte). Yine de PROJE-BAĞIMSIZDIR: env okumaz, proje
 * alanı bilmez — `id` kolonu olan HERHANGİ bir pg tablosu için çalışır.
 *
 * Yetenekler: mekanik CRUD + yumuşak silme (soft delete) + composite-where
 * okuma/yazma + keyset sayfalama + transaction + ilişkisel sorgu erişimi. Feature
 * repo'ları bunu EXTEND eder; mekanik işleri buradan alır, yalnızca özel/ilişkisel
 * sorgularını yazar (protected `query` ile tam tipli).
 */

/**
 * Bir tablonun kolonlarından oluşan basit eşitlik filtresi. `null` verilirse
 * `IS NULL`, aksi halde `= value` olarak yorumlanır. (Aralık/ilike gibi gelişmiş
 * operatörler için `this.query` ilişkisel API'si kullanılmalı.)
 */
export type WhereFilter<TTable extends WithId> = Partial<InferSelectModel<TTable>>;

export interface BaseRepositoryOptions<TQuery> {
  /**
   * true ise `deleteById` YUMUŞAK siler (deletedAt=now) ve okuma metodları silinmiş
   * kayıtları varsayılan olarak hariç tutar. Tablo `deletedAt` kolonu taşımalı
   * (bkz. base.entity `softDeleteColumn`).
   */
  softDelete?: boolean;
  /**
   * Bu tablonun ilişkisel sorgu kurucusu (`db.query.<table>`). Alt sınıflara tam
   * tipli relational erişim (`with`/`columns`/`orderBy`) sağlar — `this.query`.
   */
  query?: TQuery;
}

/** Keyset (cursor) sayfalama seçenekleri — tek tablo, JOIN'siz akışlar için. */
export interface KeysetOptions<TTable extends WithId> extends ReadOptions {
  /** Ek eşitlik filtresi (ör. `{ userId }`). */
  where?: WhereFilter<TTable>;
  /** Sıralama/cursor kolonu (ör. `table.createdAt`). Genelde artan/zamansal bir kolon. */
  cursorColumn: PgColumn;
  /** Son görülen satırın cursor değeri; verildiğinde `cursorColumn < cursor` uygulanır. */
  cursor?: unknown;
  limit: number;
}

export class BaseRepository<TTable extends WithId, TQuery = unknown> extends PgRepository<TTable> {
  /** Alt sınıfların tam tipli ilişkisel sorgular çalıştırması için (db.query.<table>). */
  protected readonly query?: TQuery;

  constructor(db: Database, table: TTable, options: BaseRepositoryOptions<TQuery> = {}) {
    super(db, table, "BaseRepository", options.softDelete ?? false);
    this.query = options.query;
  }

  // ── Yazma ──────────────────────────────────────────────────────────────
  async create(values: InferInsertModel<TTable>): Promise<InferSelectModel<TTable>> {
    const rows = (await this.db.insert(this.table).values(values as any).returning()) as InferSelectModel<TTable>[];
    return rows[0];
  }

  async createMany(values: InferInsertModel<TTable>[]): Promise<InferSelectModel<TTable>[]> {
    if (values.length === 0) return [];
    return (await this.db.insert(this.table).values(values as any).returning()) as InferSelectModel<TTable>[];
  }

  async updateById(
    id: IdOf<TTable>,
    values: Partial<InferInsertModel<TTable>>
  ): Promise<InferSelectModel<TTable> | undefined> {
    const rows = (await this.db
      .update(this.table)
      .set(values as any)
      .where(eq(this.table.id, id))
      .returning()) as InferSelectModel<TTable>[];
    return rows[0];
  }

  /**
   * softDelete=true ise deletedAt=now (yumuşak), değilse fiziksel siler. Kayıt
   * etkilendiyse true. (Zaten yumuşak silinmiş kayıt tekrar "silinir"se yine true.)
   */
  async deleteById(id: IdOf<TTable>): Promise<boolean> {
    return (await this.deleteMatching(eq(this.table.id, id))) > 0;
  }

  /** softDelete ayarından BAĞIMSIZ olarak kaydı fiziksel siler. */
  async hardDeleteById(id: IdOf<TTable>): Promise<boolean> {
    const rows = (await this.db.delete(this.table).where(eq(this.table.id, id)).returning()) as unknown[];
    return rows.length > 0;
  }

  /** Yumuşak silinmiş kaydı geri getirir (deletedAt=null). softDelete gerektirir. */
  async restoreById(id: IdOf<TTable>): Promise<InferSelectModel<TTable> | undefined> {
    this.assertSoftDelete("restoreById");
    const rows = (await this.db
      .update(this.table)
      .set({ deletedAt: null } as any)
      .where(eq(this.table.id, id))
      .returning()) as InferSelectModel<TTable>[];
    return rows[0];
  }

  // ── Okuma ──────────────────────────────────────────────────────────────
  async findById(id: IdOf<TTable>, options?: ReadOptions): Promise<InferSelectModel<TTable> | undefined> {
    const rows = (await this.db
      .select()
      .from(this.table as PgTable)
      .where(this.scoped(eq(this.table.id, id), options))
      .limit(1)) as InferSelectModel<TTable>[];
    return rows[0];
  }

  async findAll(options?: ReadOptions & { limit?: number; offset?: number }): Promise<InferSelectModel<TTable>[]> {
    let query = this.db.select().from(this.table as PgTable).$dynamic();
    const alive = this.aliveOnly(options);
    if (alive) query = query.where(alive);
    return (await this.applyRange(query, options)) as InferSelectModel<TTable>[];
  }

  async existsById(id: IdOf<TTable>, options?: ReadOptions): Promise<boolean> {
    const rows = (await this.db
      .select({ one: sql<number>`1` })
      .from(this.table as PgTable)
      .where(this.scoped(eq(this.table.id, id), options))
      .limit(1)) as unknown[];
    return rows.length > 0;
  }

  // ── Composite-where okuma (birden çok kolonla, örn. tenant/parent scope) ──
  /**
   * Basit eşitlik filtresiyle tek satır. İlişki (`with`) gerekmiyorsa `this.query`
   * yerine bunu kullan: `findOne({ id, clubId })`. Soft-delete açıksa silinmişi hariç
   * tutar (`withDeleted` ile dahil edilir).
   */
  async findOne(where: WhereFilter<TTable>, options?: ReadOptions): Promise<InferSelectModel<TTable> | undefined> {
    const rows = (await this.db
      .select()
      .from(this.table as PgTable)
      .where(this.scoped(this.buildWhere(where), options))
      .limit(1)) as InferSelectModel<TTable>[];
    return rows[0];
  }

  /** Basit eşitlik filtresiyle satır listesi (opsiyonel limit/offset). */
  async findMany(
    where: WhereFilter<TTable>,
    options?: ReadOptions & { limit?: number; offset?: number }
  ): Promise<InferSelectModel<TTable>[]> {
    let query = this.db
      .select()
      .from(this.table as PgTable)
      .where(this.scoped(this.buildWhere(where), options))
      .$dynamic();
    return (await this.applyRange(query, options)) as InferSelectModel<TTable>[];
  }

  /** Basit eşitlik filtresiyle en az bir satır var mı? */
  async existsWhere(where: WhereFilter<TTable>, options?: ReadOptions): Promise<boolean> {
    const rows = (await this.db
      .select({ one: sql<number>`1` })
      .from(this.table as PgTable)
      .where(this.scoped(this.buildWhere(where), options))
      .limit(1)) as unknown[];
    return rows.length > 0;
  }

  /**
   * Keyset (cursor) sayfalama: `cursorColumn`'a göre AZALAN sıralı, `cursor`
   * verildiğinde `cursorColumn < cursor` uygulanır. OFFSET'e göre derin sayfalarda
   * hızlı ve araya yeni kayıt girince satır atlamaz — feed/log akışları için. Yalnızca
   * TEK tablo (JOIN yok); aktör vb. birleştiren listeler kendi sorgusunu yazmalı.
   */
  async listKeyset(options: KeysetOptions<TTable>): Promise<InferSelectModel<TTable>[]> {
    const filters: SQL[] = [];
    const base = options.where ? this.buildWhere(options.where) : undefined;
    if (base) filters.push(base);
    if (options.cursor !== undefined) filters.push(lt(options.cursorColumn, options.cursor));
    const alive = this.aliveOnly(options);
    if (alive) filters.push(alive);

    let query = this.db.select().from(this.table as PgTable).$dynamic();
    if (filters.length) query = query.where(and(...filters) as SQL);
    return (await query.orderBy(desc(options.cursorColumn)).limit(options.limit)) as InferSelectModel<TTable>[];
  }

  // ── Composite-where yazma ────────────────────────────────────────────────
  /**
   * Basit eşitlik filtresine uyan satırları günceller, güncellenenleri döner
   * (`update ... where(id=.. and clubId=..)` boilerplate'inin yerine). Not: yazma,
   * yalnızca verilen `where`'e göre eşleşir — soft-delete canlılık filtresi UYGULANMAZ
   * (mevcut `updateById`/`deleteById` semantiğiyle tutarlı).
   */
  async updateWhere(
    where: WhereFilter<TTable>,
    values: Partial<InferInsertModel<TTable>>
  ): Promise<InferSelectModel<TTable>[]> {
    return (await this.db
      .update(this.table)
      .set(values as any)
      .where(this.requireScopedWhere(where, "updateWhere"))
      .returning()) as InferSelectModel<TTable>[];
  }

  /**
   * Basit eşitlik filtresine uyan satırları siler. `deleteById` gibi `softDelete`
   * ayarına saygı duyar (soft: deletedAt=now; aksi halde fiziksel). Etkilenen satır sayısı.
   */
  async deleteWhere(where: WhereFilter<TTable>): Promise<number> {
    return this.deleteMatching(this.requireScopedWhere(where, "deleteWhere"));
  }

  // ── Transaction ──────────────────────────────────────────────────────────
  /**
   * Bir transaction başlatır ve tx'e bağlı bir CRUD repo (+ ham tx) verir. İçeride
   * fırlatılan hata otomatik ROLLBACK'e yol açar. Alt sınıfın ÖZEL metodlarını
   * transaction içinde çalıştırmak için ham `tx`'i (Database) kullanın.
   */
  async transaction<T>(
    fn: (repo: BaseRepository<TTable, TQuery>, tx: Database) => Promise<T>
  ): Promise<T> {
    return this.db.transaction(async (tx) => {
      const scoped = new BaseRepository(tx as unknown as Database, this.table, {
        softDelete: this.softDelete,
        query: this.query,
      });
      return fn(scoped, tx as unknown as Database);
    }) as Promise<T>;
  }

  // ── Yardımcılar ────────────────────────────────────────────────────────
  // Canlılık/filtre/silme semantiği ortak tabandadır (`pg-repository.ts`);
  // burada yalnızca bu sınıfa özgü isimlendirme ve kontroller kalır.
  private buildWhere(where: WhereFilter<TTable>): SQL {
    return this.filterOf(where, "buildWhere");
  }

  private requireScopedWhere(where: WhereFilter<TTable>, method: string): SQL {
    return this.requiredFilterOf(where, method);
  }

  private assertSoftDelete(method: string) {
    if (!this.softDelete) {
      throw new Error(`BaseRepository.${method}: yalnızca softDelete=true iken kullanılabilir.`);
    }
  }
}
