/**
 * Cache PORT'u (storage-agnostik). core/'un mevcut felsefesi: proje-bağımsız
 * arayüz + değiştirilebilir adaptörler (bkz. createRedisClient, BaseRepository).
 *
 * Bilinçli olarak STRING-değerlidir: Redis'in doğal modeliyle birebir örtüşür,
 * in-memory için de trivial. Serialization (obje ↔ string) burada DEĞİL, üst
 * kattaki `Cache` facade + `Codec`'te yapılır (SRP: depolama, serialization'dan ayrı).
 *
 * TTL saniye cinsindendir. Adaptörler Liskov-substitutable olmalı: aynı sözleşme
 * bellek / Redis / no-op için de geçerlidir.
 */
export interface CacheStore {
  /** Anahtar yoksa (veya süresi dolduysa) `null`. */
  get(key: string): Promise<string | null>;

  /**
   * Değeri yazar. `ttlSeconds` verilirse o süre sonunda düşer; verilmezse
   * (veya <= 0) süresiz saklanır (adaptörün kendi tahliye politikasına tabi).
   */
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;

  /** Verilen anahtarları siler. Boş dizi no-op'tur. Olmayan anahtarlar sorun değil. */
  delete(keys: string[]): Promise<void>;
}
