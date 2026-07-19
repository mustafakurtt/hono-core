/**
 * Rate limit PORT'u (storage-agnostik). core/'un mevcut felsefesi: proje-bağımsız
 * arayüz + değiştirilebilir adaptörler (bkz. CacheStore, createRedisClient).
 *
 * Sözleşme bilinçli olarak TEK metod: `hit`. Sayacı artırmak ve pencerenin kalan
 * süresini öğrenmek ATOMİK olmalıdır — ayrı `incr`/`ttl`/`expire` metodları
 * sunsaydık, çağıran katman bunları kendi sırasıyla çağırır ve yarış koşulu
 * (aynı anda iki istek → iki EXPIRE → pencere sürekli uzar) adaptörden çağırana
 * SIZARDI. Atomikliği adaptör garanti eder: Redis pipeline'ı ile, bellek
 * adaptöründe tek-thread'li JS ile.
 *
 * Adaptörler Liskov-substitutable olmalı: aynı sözleşme bellek/Redis için geçerli.
 */
export interface RateLimitHit {
  /** Bu pencerede o anahtar için görülen istek sayısı (bu istek DAHİL). */
  count: number;
  /** Pencerenin bitmesine kalan süre (saniye). `Retry-After`/`RateLimit-Reset` için. */
  ttlSeconds: number;
}

export interface RateLimitStore {
  /**
   * `key` için sayacı 1 artırır ve pencerenin kalan süresini döner. Anahtar yoksa
   * pencereyi başlatır (count=1, ttl=windowSeconds).
   *
   * Adaptör, pencere ömrünü ilk istekte kurmalı ve SONRAKİ isteklerde
   * TAZELEMEMELİDİR — aksi halde sürekli istek alan bir anahtarın penceresi hiç
   * kapanmaz (kayan değil, sabit pencere semantiği).
   */
  hit(key: string, windowSeconds: number): Promise<RateLimitHit>;
}
