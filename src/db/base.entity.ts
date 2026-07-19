import { timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * ⚠️ Drizzle + PostgreSQL'e ÖZGÜ modül. core/'un tek DB/ORM-bağımlı parçası
 * (base.repository ile birlikte). Yine de PROJE-BAĞIMSIZDIR: env okumaz, proje
 * alanı/tablosu bilmez — yalnızca yeniden kullanılabilir kolon setleri sunar.
 *
 * Tablolar bunları spread ederek ortak kolonları tek yerden alır:
 *
 *   export const posts = pgTable("posts", {
 *     id: uuidPrimaryKey(),
 *     ...timestamps,
 *     ...softDeleteColumn,
 *     title: text("title").notNull(),
 *   });
 */

/** UUID birincil anahtar, DB tarafında rastgele üretilir. */
export const uuidPrimaryKey = () => uuid("id").primaryKey().defaultRandom();

/** created_at + updated_at (updated_at her UPDATE'te otomatik güncellenir). */
export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/**
 * Yumuşak silme (soft delete) kolonu. NULL = kayıt canlı; dolu = silinmiş sayılır.
 * `BaseRepository({ softDelete: true })` bu kolonu okur/yazar.
 */
export const softDeleteColumn = {
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
};
