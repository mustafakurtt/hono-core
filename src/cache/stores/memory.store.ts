import type { CacheStore } from "../cache.store";

interface Entry {
  value: string;
  /** epoch ms; `null` = süresiz. */
  expiresAt: number | null;
}

export interface InMemoryCacheStoreOptions {
  /**
   * Üst sınır. Aşılınca EN ESKİ erişilen anahtar atılır (basit LRU). Süreç belleğinin
   * sınırsız şişmesini önler. Varsayılan 10.000.
   */
  maxEntries?: number;
}

/**
 * Süreç-içi cache adaptörü. Bağımlılıksız — test, tek-instance kurulum veya
 * Redis'in gereksiz olduğu senaryolar için. Süre dolumu TEMBELDİR (get sırasında
 * kontrol edilir; arka planda timer yok) + `maxEntries` ile LRU tahliyesi.
 *
 * DİKKAT (çok-instance): süreç-yereldir, instance'lar arası paylaşılmaz. Birden
 * çok uygulama instance'ı çalışırken paylaşımlı cache gerekiyorsa RedisCacheStore.
 */
export class InMemoryCacheStore implements CacheStore {
  private readonly store = new Map<string, Entry>();
  private readonly maxEntries: number;

  constructor(options: InMemoryCacheStoreOptions = {}) {
    this.maxEntries = options.maxEntries ?? 10_000;
  }

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;

    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }

    // LRU: erişilen anahtarı sona taşı (Map ekleme-sırasını korur).
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    // Yeniden yazımda sıralamayı tazelemek için önce sil.
    this.store.delete(key);
    this.store.set(key, {
      value,
      expiresAt: ttlSeconds && ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null,
    });
    this.evictIfNeeded();
  }

  async delete(keys: string[]): Promise<void> {
    for (const key of keys) this.store.delete(key);
  }

  /** maxEntries aşıldıysa en eski (ilk) anahtarları at. */
  private evictIfNeeded(): void {
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }
}
