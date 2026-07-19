import type { Context, MiddlewareHandler, Next } from "hono";
import type { Logger } from "../logger/logger";
import { TooManyRequestsError } from "../http/errors";
import type { RateLimitStore } from "./ratelimit.store";

/**
 * Taşınabilir hız sınırlayıcı FABRİKASI. core/ proje-bağımsız kalsın diye depolama
 * (`store`), anahtarlama (`keyFn`), mesaj ve kapatma anahtarı DIŞARIDAN enjekte
 * edilir — aynı dikiş deseni: createLogger / createErrorHandler / createMetrics.
 *
 * ════════════════════════════════════════════════════════════════════════
 * ANAHTARLAMA — neden `keyFn` zorunlu bir dikiş?
 * ════════════════════════════════════════════════════════════════════════
 * "IP başına limit" varsayılanı çok yaygın ve çok yerde YANLIŞTIR: NAT arkasındaki
 * bir kurum (kampüs, okul, şirket) tek public IP'den çıkar; IP'ye anahtarlamak, bir
 * kişi limiti doldurduğunda TÜM KURUMU kilitler. Doğru anahtar genelde *korunan
 * kaynağın kimliğidir* (e-posta, userId). Core bu kararı veremez (projeye bağlı),
 * bu yüzden varsayılan sunmaz — `keyFn` zorunludur ve proje bilinçli seçer.
 *
 * `keyFn` `null` dönerse limit UYGULANMAZ (ör. body'de e-posta yok → zaten
 * doğrulama reddedecek).
 *
 * FAIL-OPEN: store hatası (ör. Redis kopması) isteği DÜŞÜRMEZ, geçirir. Gerekçe:
 * hız sınırı bir korumadır, doğruluk kaynağı değil — Redis düştüğünde tüm API'yi
 * kilitlemek, limitin aşılmasına izin vermekten çok daha kötüdür. (Aynı ilke:
 * core/cache okuma yolu.)
 */
export interface CreateRateLimiterOptions {
  /** Sayaçların tutulduğu adaptör (memory / redis). */
  store: RateLimitStore;
  /** Anahtar öneki — endpoint'ler birbirinin sayacını yemesin. */
  keyPrefix: string;
  /** Pencere başına izin verilen istek sayısı. */
  limit: number;
  /** Pencere uzunluğu (saniye). */
  windowSeconds: number;
  /**
   * İsteği kime sayacağımızı belirler. `null` → limit uygulanmaz. Varsayılanı
   * bilinçli olarak YOK (yukarıdaki anahtarlama notu).
   */
  keyFn: (c: Context) => string | null | Promise<string | null>;
  /**
   * Limit aşımında fırlatılacak mesaj (genelde bir çeviri ANAHTARI; dil projede).
   * `{minutes}` / `{seconds}` parametreleri interpolasyon için geçilir.
   * Varsayılan "rateLimit.exceeded".
   */
  message?: string;
  /** Makine-okur kod. Varsayılan TooManyRequestsError'ın "RATE_LIMITED"'ı. */
  code?: string;
  /**
   * true ise sınırlayıcı tamamen devre dışı (test/CI). Fonksiyon da olabilir —
   * env'i açılışta değil çağrı anında okumak isteyen projeler için.
   */
  disabled?: boolean | (() => boolean);
  /** Verilirse store hataları buraya yazılır (dev-facing, İngilizce). */
  logger?: Logger;
}

/** `RateLimit-*` bilgi başlıkları — istemci limiti proaktif yönetebilsin. */
function setRateLimitHeaders(c: Context, limit: number, remaining: number, ttlSeconds: number) {
  c.header("RateLimit-Limit", String(limit));
  c.header("RateLimit-Remaining", String(remaining));
  c.header("RateLimit-Reset", String(ttlSeconds));
}

export function createRateLimiter(options: CreateRateLimiterOptions): MiddlewareHandler {
  const {
    store,
    keyPrefix,
    limit,
    windowSeconds,
    keyFn,
    message = "rateLimit.exceeded",
    code,
    disabled = false,
    logger,
  } = options;

  const isDisabled = typeof disabled === "function" ? disabled : () => disabled;

  return async (c: Context, next: Next) => {
    if (isDisabled()) return next();

    const identity = await keyFn(c);
    if (identity === null) return next(); // kimlik çıkarılamadı → sınırlama yok

    const key = `ratelimit:${keyPrefix}:${identity}`;

    let count: number;
    let ttlSeconds: number;
    try {
      ({ count, ttlSeconds } = await store.hit(key, windowSeconds));
    } catch (err) {
      // FAIL-OPEN — bkz. dosya başındaki gerekçe.
      logger?.error({ err, keyPrefix }, "rate limit store failed; letting request through");
      return next();
    }

    setRateLimitHeaders(c, limit, Math.max(0, limit - count), ttlSeconds);

    if (count > limit) {
      c.header("Retry-After", String(ttlSeconds));
      // Zarfı/dili burada KURMUYORUZ: fırlatırız, app.onError tek noktadan 429 +
      // i18n + requestId'ye çevirir (authMiddleware'in UnauthorizedError deseni).
      // Yukarıda set edilen başlıklar Hono'nun hazırlanmış başlıklarıdır ve
      // onError'ın ürettiği cevaba taşınır.
      throw new TooManyRequestsError(message, {
        ...(code ? { code } : {}),
        params: { seconds: ttlSeconds, minutes: Math.max(1, Math.ceil(ttlSeconds / 60)) },
      });
    }

    await next();
  };
}
