import type { InferSelectModel } from "drizzle-orm";
import type { PgAsyncDatabase, PgColumn, PgTable } from "drizzle-orm/pg-core";

/**
 * `/db` modülünün paylaşılan tipleri. Ayrı dosyada duruyorlar ki ortak taban
 * (`pg-repository.ts`) ile alt sınıflar arasında import döngüsü oluşmasın.
 */

/** Drizzle veritabanı örneği (driver-agnostik: postgres-js, node-postgres...). */
export type Database = PgAsyncDatabase<any, any>;

/** Tekil `id` birincil anahtarı olan tablo — `BaseRepository`'nin şartı. */
export type WithId = PgTable & { id: PgColumn };

export type IdOf<TTable extends WithId> = InferSelectModel<TTable>["id"];
