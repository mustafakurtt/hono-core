import { sql, type InferInsertModel, type InferSelectModel, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { PgRepository } from "./pg-repository";
import { buildEqualityFilter, resolveColumn, type ReadOptions } from "./query-filters";
import type { Database } from "./types";

/**
 * ⚠️ Drizzle + PostgreSQL'e ÖZGÜ modül (base.repository ile aynı ailede).
 *
 * BİLEŞİK BİRİNCİL ANAHTARLI tablolar için. `BaseRepository` tablonun tekil bir
 * `id` kolonu olmasını ŞART koşar (`findById`/`updateById`/`deleteById` ona
 * dayanır); çeviri tabloları `(kaynakId, locale)`, ayarlar `(key, locale)`, RBAC
 * bağ tabloları `(roleId, permissionId)` gibi anahtarlarda bu mümkün değildir.
 * Yapay bir `id` kolonu eklemek yalnızca çekirdeği memnun etmek için tabloyu
 * bozmak olurdu.
 *
 * `BaseRepository`'yi genişletmek yerine AYRI bir sınıf: `IdOf` etrafındaki her
 * imza değişmek zorunda kalırdı ve iki farklı anahtar modeli tek sınıfta
 * karışırdı. Filtre kuralları ise ortaktır (bkz. `query-filters.ts`).
 *
 * Asıl yeteneği `upsert`'tür — bileşik anahtarlı tabloların baskın erişim
 * deseni "varsa güncelle, yoksa ekle"dir ve `BaseRepository`'de karşılığı yoktur.
 */

/** Anahtar kolon adlarından oluşan, tam olarak doldurulması gereken anahtar. */
export type CompositeKey<
  TTable extends PgTable,
  TKey extends keyof InferSelectModel<TTable> & string,
> = Pick<InferSelectModel<TTable>, TKey>;

/** Bir tablonun kolonlarından oluşan basit eşitlik filtresi. */
export type CompositeWhere<TTable extends PgTable> = Partial<InferSelectModel<TTable>>;

export interface CompositeKeyRepositoryOptions<
  TTable extends PgTable,
  TKey extends keyof InferSelectModel<TTable> & string,
  TQuery,
> {
  /** Bileşik birincil anahtarı oluşturan kolon adları. Sıra önemsizdir. */
  keyColumns: readonly TKey[];
  /**
   * true ise `deleteByKey` YUMUŞAK siler ve okumalar silinmişi hariç tutar.
   * Tablo `deletedAt` kolonu taşımalı.
   */
  softDelete?: boolean;
  /** Bu tablonun ilişkisel sorgu kurucusu (`db.query.<table>`) — alt sınıflar için. */
  query?: TQuery;
}

const UPDATED_AT = "updatedAt";

export class CompositeKeyRepository<
  TTable extends PgTable,
  TKey extends keyof InferSelectModel<TTable> & string,
  TQuery = unknown,
> extends PgRepository<TTable> {
  protected readonly query?: TQuery;
  private readonly keyColumns: readonly TKey[];
  private readonly keyNames: ReadonlySet<string>;
  private readonly updatedAt?: PgColumn;

  constructor(
    db: Database,
    table: TTable,
    options: CompositeKeyRepositoryOptions<TTable, TKey, TQuery>
  ) {
    if (options.keyColumns.length === 0) {
      throw new Error("CompositeKeyRepository: keyColumns boş olamaz.");
    }
    super(db, table, "CompositeKeyRepository", options.softDelete ?? false);

    this.keyColumns = options.keyColumns;
    this.keyNames = new Set(options.keyColumns);
    this.query = options.query;
    // Kolon varsa upsert onu tazeler (aşağıya bkz.); yoksa sessizce atlanır.
    this.updatedAt = (table as unknown as Record<string, unknown>)[UPDATED_AT] as
      | PgColumn
      | undefined;

    // Anahtar adları açılışta doğrulanır — yazım hatası ilk sorguya kadar beklemesin.
    for (const name of this.keyColumns) {
      resolveColumn(table, name, "CompositeKeyRepository");
    }
  }

  // ── Yazma ──────────────────────────────────────────────────────────────
  /**
   * "Varsa güncelle, yoksa ekle" — bileşik anahtarlı tabloların baskın deseni.
   *
   * `onConflictDoNothing` DEĞİL `onConflictDoUpdate` kullanılır: doNothing, var
   * olan satırdaki değişiklikleri (ör. bir açıklama metninin güncellenmesi)
   * SESSİZCE yutar ve veriyi bayat bırakır.
   *
   * `updatedAt` kolonu varsa çakışma güncellemesinde otomatik tazelenir:
   * Drizzle'ın `$onUpdate` kancası yalnızca `.update()` çağrılarında çalışır,
   * upsert'te çalışmaz — elle tazelenmezse satır güncellenir ama zaman damgası
   * eski kalırdı.
   */
  async upsert(values: InferInsertModel<TTable>): Promise<InferSelectModel<TTable>> {
    const rows = await this.upsertMany([values]);
    return rows[0] ?? (await this.findByKey(this.keyOf(values), { withDeleted: true }))!;
  }

  /** `upsert`in toplu hâli; tek sorguda gider. Boş dizi no-op'tur. */
  async upsertMany(values: InferInsertModel<TTable>[]): Promise<InferSelectModel<TTable>[]> {
    if (values.length === 0) return [];

    const assignments = this.conflictAssignments(values);
    const insert = this.db.insert(this.table).values(values as any);

    // Yalnızca anahtar kolonlar verilmişse güncellenecek bir şey yoktur; boş bir
    // SET listesi geçersiz SQL üretirdi.
    const rows =
      Object.keys(assignments).length > 0
        ? await insert
            .onConflictDoUpdate({ target: this.targetColumns(), set: assignments as any })
            .returning()
        : await insert.onConflictDoNothing().returning();

    return rows as InferSelectModel<TTable>[];
  }

  /** Anahtara göre günceller; satır yoksa `undefined`. */
  async updateByKey(
    key: CompositeKey<TTable, TKey>,
    values: Partial<InferInsertModel<TTable>>
  ): Promise<InferSelectModel<TTable> | undefined> {
    const rows = (await this.db
      .update(this.table)
      .set(values as any)
      .where(this.keyFilter(key))
      .returning()) as InferSelectModel<TTable>[];
    return rows[0];
  }

  /** `softDelete` ayarına saygı duyar: soft ise deletedAt=now, değilse fiziksel siler. */
  async deleteByKey(key: CompositeKey<TTable, TKey>): Promise<boolean> {
    return (await this.deleteMatching(this.keyFilter(key))) > 0;
  }

  /** Eşitlik filtresine uyan satırları siler. Boş filtre ENGELLENİR. */
  async deleteWhere(where: CompositeWhere<TTable>): Promise<number> {
    return this.deleteMatching(this.requiredFilterOf(where, "deleteWhere"));
  }

  // ── Okuma ──────────────────────────────────────────────────────────────
  async findByKey(
    key: CompositeKey<TTable, TKey>,
    options?: ReadOptions
  ): Promise<InferSelectModel<TTable> | undefined> {
    const rows = (await this.db
      .select()
      .from(this.table as PgTable)
      .where(this.scoped(this.keyFilter(key), options))
      .limit(1)) as InferSelectModel<TTable>[];
    return rows[0];
  }

  async existsByKey(key: CompositeKey<TTable, TKey>, options?: ReadOptions): Promise<boolean> {
    const rows = (await this.db
      .select({ one: sql<number>`1` })
      .from(this.table as PgTable)
      .where(this.scoped(this.keyFilter(key), options))
      .limit(1)) as unknown[];
    return rows.length > 0;
  }

  /** Eşitlik filtresiyle satır listesi. Boş filtre tüm (canlı) satırları verir. */
  async findMany(
    where: CompositeWhere<TTable> = {},
    options?: ReadOptions & { limit?: number; offset?: number }
  ): Promise<InferSelectModel<TTable>[]> {
    const query = this.db
      .select()
      .from(this.table as PgTable)
      .where(this.scoped(this.filterOf(where, "findMany"), options))
      .$dynamic();
    return (await this.applyRange(query, options)) as InferSelectModel<TTable>[];
  }

  // ── Transaction ────────────────────────────────────────────────────────
  /** Tx'e bağlı bir repo (+ ham tx) verir; içeride fırlatılan hata ROLLBACK eder. */
  async transaction<T>(
    fn: (repo: CompositeKeyRepository<TTable, TKey, TQuery>, tx: Database) => Promise<T>
  ): Promise<T> {
    return this.db.transaction(async (tx) => {
      const scoped = new CompositeKeyRepository(tx as unknown as Database, this.table, {
        keyColumns: this.keyColumns,
        softDelete: this.softDelete,
        query: this.query,
      });
      return fn(scoped, tx as unknown as Database);
    }) as Promise<T>;
  }

  // ── Yardımcılar ────────────────────────────────────────────────────────
  private targetColumns(): PgColumn[] {
    return this.keyColumns.map((name) =>
      resolveColumn(this.table, name, "CompositeKeyRepository")
    );
  }

  /** Anahtarı SQL koşuluna çevirir; eksik anahtar alanı hata verir. */
  private keyFilter(key: CompositeKey<TTable, TKey>): SQL {
    for (const name of this.keyColumns) {
      if ((key as Record<string, unknown>)[name] === undefined) {
        throw new Error(`CompositeKeyRepository: anahtar alanı '${name}' eksik.`);
      }
    }
    return buildEqualityFilter(
      this.table,
      key as Record<string, unknown>,
      "CompositeKeyRepository.keyFilter"
    );
  }

  /** Insert değerlerinden anahtar kısmını ayıklar. */
  private keyOf(values: InferInsertModel<TTable>): CompositeKey<TTable, TKey> {
    const source = values as Record<string, unknown>;
    const key: Record<string, unknown> = {};
    for (const name of this.keyColumns) key[name] = source[name];
    return key as CompositeKey<TTable, TKey>;
  }

  /**
   * Çakışmada güncellenecek kolonlar: verilen değerlerin anahtar OLMAYAN
   * alanları (tüm satırların birleşimi — toplu upsert'te satırlar farklı alanlar
   * taşıyabilir) + varsa tazelenen `updatedAt`.
   */
  private conflictAssignments(values: InferInsertModel<TTable>[]): Record<string, unknown> {
    const assignments: Record<string, unknown> = {};

    for (const row of values) {
      for (const name of Object.keys(row as Record<string, unknown>)) {
        if (this.keyNames.has(name) || name === UPDATED_AT) continue;
        // Değeri EXCLUDED'dan al: toplu upsert'te her satır kendi değerini almalı.
        assignments[name] = sql.raw(`excluded."${this.columnName(name)}"`);
      }
    }

    if (this.updatedAt && Object.keys(assignments).length > 0) {
      assignments[UPDATED_AT] = new Date();
    }
    return assignments;
  }

  /** TS alan adından gerçek SQL kolon adına. */
  private columnName(field: string): string {
    return resolveColumn(this.table, field, "CompositeKeyRepository").name;
  }
}
