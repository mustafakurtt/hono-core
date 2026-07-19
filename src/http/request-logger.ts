import type { Context, Next } from "hono";
import { LogLevel, type EmittableLogLevel, type Logger } from "../logger/logger";

/**
 * Taşınabilir istek-loglama middleware FABRİKASI. `hono/logger()`'ın (renkli
 * metin) yerine her istek için tek satır yapılandırılmış log üretir.
 *
 * core/ proje-bağımsız kalsın diye logger, requestId okuma yolu, status→seviye
 * eşlemesi, mesajlar ve ek alanlar DIŞARIDAN enjekte edilir — aynı desen
 * `createErrorHandler` / `createLogger` ile kullanılıyor (core mekanizmayı
 * tanımlar, proje kurar). Bkz. `src/core/http/error-handler.ts`.
 */
export interface RequestLoggerOptions {
  /** Projenin kök/child logger'ı (ör. `logger.child({ module: "http" })`). */
  logger: Logger;
  /** requestId'yi context'ten okuma yolu. Varsayılan `c.get("requestId")` (error-handler ile aynı). */
  getRequestId?: (c: Context) => string | undefined;
  /**
   * HTTP status → log seviyesi. Varsayılan: 5xx→Error, 4xx→Warn, aksi Info.
   * `Silent` KABUL EDİLMEZ (bkz. EmittableLogLevel): bir satırı susturmak için
   * seviye değil `skip` kullanılır.
   */
  getLevel?: (status: number) => EmittableLogLevel;
  /** Seviye/duruma göre log mesajı. Varsayılan nötr İngilizce; proje TR ile override eder. */
  getMessage?: (level: EmittableLogLevel, status: number) => string;
  /**
   * Standart alanlara eklenecek proje-özel alanlar (ör. userId, tenant). Açık
   * genişletme dikişi: ileride alan eklemek çekirdeği değiştirmesin (OCP).
   */
  getExtraFields?: (c: Context) => Record<string, unknown>;
  /**
   * `true` dönerse istek LOGLANMAZ (yalnızca log satırı atlanır; istek normal işler).
   * Sık pollanan altyapı uçlarının (Prometheus `/metrics`, load-balancer `/health`)
   * gürültüsünü kesmek için — bunlar saniyeler içinde logu doldurur ve sinyal taşımaz.
   */
  skip?: (c: Context) => boolean;
}

/** Her istekte loglanan sabit iskelet; `getExtraFields` bunun üstüne eklenir. */
export interface RequestLogFields {
  requestId: string | undefined;
  method: string;
  path: string;
  status: number;
  durationMs: number;
}

/**
 * Varsayılan seviye eşlemesi. 400/500 çıplak birer sabit değil, HTTP'nin
 * evrensel semantik sınırları (istemci/sunucu hatası) — isimlendirmek gürültü olur.
 */
const defaultGetLevel = (status: number): EmittableLogLevel =>
  status >= 500 ? LogLevel.Error : status >= 400 ? LogLevel.Warn : LogLevel.Info;

/** Nötr İngilizce varsayılan mesajlar; projeler `getMessage` ile kendi dillerini enjekte eder. */
const DEFAULT_MESSAGES: Record<EmittableLogLevel, string> = {
  [LogLevel.Trace]: "request completed",
  [LogLevel.Debug]: "request completed",
  [LogLevel.Info]: "request completed",
  [LogLevel.Warn]: "request failed",
  [LogLevel.Error]: "request errored",
  [LogLevel.Fatal]: "request errored",
};

export function createRequestLogger(options: RequestLoggerOptions) {
  const {
    logger,
    getRequestId = (c) => c.get("requestId"),
    getLevel = defaultGetLevel,
    getMessage,
    getExtraFields,
    skip,
  } = options;

  return async (c: Context, next: Next) => {
    // Atlanan uçlar (ör. /metrics, /health) hiç loglanmaz — zaman ölçümü de gereksiz.
    if (skip?.(c)) return next();

    const start = Date.now();
    await next();
    const durationMs = Date.now() - start;
    const status = c.res.status;
    const level = getLevel(status);

    const fields: RequestLogFields & Record<string, unknown> = {
      requestId: getRequestId(c),
      method: c.req.method,
      path: c.req.path,
      status,
      durationMs,
      ...getExtraFields?.(c),
    };

    const message = getMessage?.(level, status) ?? DEFAULT_MESSAGES[level];
    // `level` pino'nun LogFn metod adlarından biri; tip-güvenli indeksleme.
    logger[level](fields, message);
  };
}
