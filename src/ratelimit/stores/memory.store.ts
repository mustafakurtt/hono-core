import { evictUnderPressure } from "../evict";
import type { RateLimitHit, RateLimitStore } from "../ratelimit.store";

interface Window {
  count: number;
  /** epoch ms — pencerenin kapanma anı. */
  expiresAt: number;
}

export interface InMemoryRateLimitStoreOptions {
  /**
   * Sert üst sınır. Aşılınca önce süresi dolmuş, sonra en düşük sayılı (eşitlikte en eski)
   * pencereler atılır — yüksek sayılı (engellenmiş) pencereler en son. Süreç belleğinin sınırsız
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
 *
 * TAHLİYE: eskiden salt ekleme sırasıyla (FIFO) atılıyordu; saldırgan kurbanın limitini
 * doldurup ~maxEntries yeni anahtar göndererek kilidi sıfırlayabiliyordu. Artık sayı bazlı:
 * engellenmiş bir pencere yüksek sayılıdır, düşük sayılılardan sonra atılır. Store limiti
 * bilmez (port sözleşmesi değişmedi), sayı tek başına yeterli sinyaldir. Gerekçe ve
 * karmaşıklık: ../evict.ts.
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
      this.windows.delete(key); // açılış sırasını tazele (tahliyede eşitlikte en eski önce)
      this.windows.set(key, fresh);
      evictUnderPressure(this.windows, this.maxEntries, (w) => w.expiresAt <= now, key);
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
}
