import type { RateLimitHit, RateLimitStore } from "../ratelimit.store";

interface Window {
  count: number;
  /** epoch ms — pencerenin kapanma anı. */
  expiresAt: number;
}

export interface InMemoryRateLimitStoreOptions {
  /**
   * Üst sınır. Aşılınca en eski pencereler atılır. Süreç belleğinin sınırsız
   * şişmesini önler — anahtar uzayı kullanıcı girdisinden (e-posta/IP) geldiği için
   * bu bir savunma önlemidir, sadece hijyen değil. Varsayılan 10.000.
   */
  maxEntries?: number;
  /** Test edilebilirlik için saat dikişi (bkz. InMemoryCacheStore). Varsayılan Date.now. */
  now?: () => number;
}

/**
 * Süreç-içi sabit pencere adaptörü. Bağımlılıksız — test, tek-instance kurulum
 * veya Redis'in gereksiz olduğu senaryolar için. Süre dolumu TEMBELDİR (hit
 * sırasında kontrol edilir; arka planda timer yok).
 *
 * DİKKAT (çok-instance): süreç-yereldir. İki instance çalışırken her biri ayrı
 * sayar → efektif limit 2× olur. Paylaşımlı/gerçek limit gerekiyorsa
 * RedisRateLimitStore. (Aynı uyarı: InMemoryCacheStore.)
 */
export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly windows = new Map<string, Window>();
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: InMemoryRateLimitStoreOptions = {}) {
    this.maxEntries = options.maxEntries ?? 10_000;
    this.now = options.now ?? Date.now;
  }

  async hit(key: string, windowSeconds: number): Promise<RateLimitHit> {
    const now = this.now();
    const existing = this.windows.get(key);

    // Pencere yok ya da kapanmış → yenisini başlat.
    if (!existing || existing.expiresAt <= now) {
      const fresh: Window = { count: 1, expiresAt: now + windowSeconds * 1000 };
      this.windows.delete(key); // LRU sırasını tazele
      this.windows.set(key, fresh);
      this.evictIfNeeded();
      return { count: 1, ttlSeconds: windowSeconds };
    }

    // Açık pencere → yalnızca sayacı artır. expiresAt'e DOKUNMA: tazelersek
    // sürekli istek alan anahtarın penceresi hiç kapanmaz (bkz. port sözleşmesi).
    existing.count += 1;
    return {
      count: existing.count,
      ttlSeconds: Math.max(1, Math.ceil((existing.expiresAt - now) / 1000)),
    };
  }

  /** maxEntries aşıldıysa en eski (ilk eklenen) pencereleri at. */
  private evictIfNeeded(): void {
    while (this.windows.size > this.maxEntries) {
      const oldest = this.windows.keys().next().value;
      if (oldest === undefined) break;
      this.windows.delete(oldest);
    }
  }
}
