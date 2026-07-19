import type { RateLimitHit, RateLimitStore } from "../ratelimit.store";

/**
 * RedisRateLimitStore'un ihtiyaç duyduğu MİNİMAL komut yüzeyi (ISP). Doğrudan
 * ioredis'e bağlanmak yerine yapısal bir arayüz alırız: ioredis `Redis`i bunu
 * zaten karşılar, ama test'te sahtelemek ya da başka bir istemci takmak da mümkün
 * olur (aynı desen: RedisCacheClient).
 */
export interface RateLimitRedisClient {
  pipeline(): RateLimitPipeline;
  expire(key: string, seconds: number): Promise<unknown>;
}

export interface RateLimitPipeline {
  incr(key: string): RateLimitPipeline;
  ttl(key: string): RateLimitPipeline;
  exec(): Promise<[Error | null, unknown][] | null>;
}

/**
 * Redis destekli sabit pencere (fixed-window) adaptörü. Çok-instance güvenlidir:
 * sayaç Redis'te tutulur ve `INCR` atomiktir — iki instance aynı anda artırsa bile
 * sayı kaybolmaz.
 *
 * `INCR` + `TTL` tek pipeline'da (tek gidiş-dönüş) gider. `EXPIRE` yalnızca TTL
 * yoksa (ilk istek, ya da anahtar bir şekilde ömürsüz kalmışsa) atılır — her
 * istekte tazelenirse pencere hiç kapanmaz ve limit anlamsızlaşırdı.
 *
 * ⚠️ Sabit pencerenin bilinen sınırı: pencere SINIRINDA 2× burst mümkündür
 * (pencerenin son anında `limit` kadar + yeni pencerenin ilk anında `limit` kadar).
 * Kabul edilebilir bir denge; daha sıkı garanti için sliding-window gerekir.
 */
export class RedisRateLimitStore implements RateLimitStore {
  constructor(private readonly client: RateLimitRedisClient) {}

  async hit(key: string, windowSeconds: number): Promise<RateLimitHit> {
    const results = await this.client.pipeline().incr(key).ttl(key).exec();

    // exec() null dönerse (bağlantı kopması) veya komut hata verdiyse: çağıran
    // katmanın fail-open'ı devreye girsin diye FIRLAT — sessizce 0 saymak, limiti
    // sessizce kapatmak olurdu (üstelik ilk `count=0` her isteği geçirirdi).
    if (!results) throw new Error("rate limit: redis pipeline döndürmedi");
    const [incrResult, ttlResult] = results;
    if (incrResult?.[0]) throw incrResult[0];
    if (ttlResult?.[0]) throw ttlResult[0];

    const count = incrResult[1] as number;
    let ttlSeconds = ttlResult[1] as number;

    // TTL < 0: -2 (anahtar yok, yarışta silinmiş) veya -1 (ömürsüz) → pencereyi kur.
    if (ttlSeconds < 0) {
      await this.client.expire(key, windowSeconds);
      ttlSeconds = windowSeconds;
    }

    return { count, ttlSeconds };
  }
}
