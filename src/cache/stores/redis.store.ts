import type { CacheStore } from "../cache.store";

/**
 * RedisCacheStore'un ihtiyaç duyduğu MİNİMAL komut yüzeyi (ISP). Doğrudan ioredis'e
 * bağlanmak yerine yapısal bir arayüz alırız: ioredis `Redis`i bunu zaten karşılar,
 * ama test'te sahtelemek ya da başka bir istemci takmak da mümkün olur.
 */
export interface RedisCacheClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", ttlSeconds: number): Promise<unknown>;
  set(key: string, value: string): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
}

/**
 * Redis destekli cache adaptörü. Paylaşımlı/çok-instance kurulumun varsayılanı.
 * TTL'i Redis'in kendi `EX` süre-dolumuna devreder (get sırasında kontrol yok).
 */
export class RedisCacheStore implements CacheStore {
  constructor(private readonly client: RedisCacheClient) {}

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds && ttlSeconds > 0) {
      await this.client.set(key, value, "EX", ttlSeconds);
    } else {
      await this.client.set(key, value);
    }
  }

  async delete(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    await this.client.del(...keys);
  }
}
