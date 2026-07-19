/**
 * core/storage barrel — proje-bağımsız nesne depolama altyapısı (port + adaptörler
 * + MIME yardımcıları). Proje kurulumu (shared/storage) ve testler buradan import eder.
 *
 * Katmanlar: StorageStore (port) → adaptörler (local disk / memory) + mime helpers.
 * Serialization/DB/URL üretimi burada DEĞİL (SRP): onlar proje katmanının işidir.
 */
export type { StorageStore, StoredObject } from "./storage.port";
export { LocalDiskStorage } from "./stores/local.store";
export { InMemoryStorage } from "./stores/memory.store";
export {
  IMAGE_MIME_TO_EXT,
  extensionOf,
  contentTypeForExtension,
  sniffImageMime,
} from "./mime";
