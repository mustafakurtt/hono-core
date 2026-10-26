/**
 * core/db barrel — Drizzle + PostgreSQL için proje-bağımsız veri-erişim altyapısı.
 * Feature repo'ları ve şema dosyaları buradan tek noktadan import eder.
 */
export {
  BaseRepository,
  type Database,
  type WithId,
  type IdOf,
  type WhereFilter,
  type ReadOptions,
  type KeysetOptions,
  type BaseRepositoryOptions,
} from "./base.repository";

export {
  CompositeKeyRepository,
  type CompositeKey,
  type CompositeWhere,
  type CompositeKeyRepositoryOptions,
} from "./composite.repository";

export { uuidPrimaryKey, timestamps, softDeleteColumn } from "./base.entity";

export { paginate, type Page, type PaginateQuery } from "./pagination";
