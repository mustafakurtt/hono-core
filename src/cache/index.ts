/**
 * core/cache barrel — storage-agnostik, proje-bağımsız cache altyapısı.
 * Proje kurulumu (shared/cache) ve testler buradan tek noktadan import eder.
 *
 * Katmanlar: CacheStore (port) → adaptörler (memory/redis/null) → Cache (tipli
 * facade: getOrSet + single-flight + namespace) + Codec (serialization).
 */
export { Cache, type CacheOptions, type WriteOptions } from "./cache";
export type { CacheStore } from "./cache.store";
export { jsonCodec, type Codec } from "./codec";

export { InMemoryCacheStore, type InMemoryCacheStoreOptions } from "./stores/memory.store";
export { RedisCacheStore, type RedisCacheClient } from "./stores/redis.store";
export { NullCacheStore } from "./stores/null.store";
