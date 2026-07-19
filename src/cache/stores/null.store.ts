import type { CacheStore } from "../cache.store";

/**
 * No-op adaptör: her okuma miss, yazma/silme yok sayılır. Cache'i tamamen
 * KAPATMAK için (test, hata ayıklama, geçici devre dışı bırakma). Liskov gereği
 * uygulama cache olmadan da doğru çalışmalı — bu store onu doğrular.
 */
export class NullCacheStore implements CacheStore {
  async get(): Promise<string | null> {
    return null;
  }

  async set(): Promise<void> {
    // bilinçli no-op
  }

  async delete(): Promise<void> {
    // bilinçli no-op
  }
}
