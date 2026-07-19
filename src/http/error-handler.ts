import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Logger } from "../logger/logger";
import type { Translate } from "../i18n/translator";
import { isHttpError } from "./errors";

/**
 * Taşınabilir merkezi hata yakalayıcı FABRİKASI. core/ proje-bağımsız kalsın
 * diye dil (fallback mesaj/katalog), logger ve "eski düz Error'lar iş hatası mı?"
 * konvansiyonu DIŞARIDAN enjekte edilir — aynı desen `createLogger` /
 * `setGuardAuditSink` ile kullanılıyor (core mekanizmayı tanımlar, proje kurar).
 *
 * Hata sınıflandırma sırası:
 *   1. Hono `HTTPException`      → kendi status'u + mesajıyla döner.
 *   2. `HttpError` (bizim sözleşme, expose) → status'unu KENDİ taşır (+ code).
 *   3. Eski düz Error konvansiyonu (opsiyonel classifier) → 400. HttpError'a
 *      geçiş bitene kadarki GERİ UYUM dikişi; bu proje `err.constructor === Error`
 *      kullanır ama core bunu bilmez, enjekte edilir.
 *   4. Diğer her şey (altyapı) → loglanır, jenerik fallback 500. Mesaj SIZMAZ.
 *
 * Çeviri: `translate` verilirse tüm kullanıcı-cephesi mesajları isteğin diline
 * çevrilir. Mesaj metni aslında bir çeviri ANAHTARIDIR (örn. "university.notFound");
 * katalogda yoksa çevirmen aynen döndürür, bu yüzden anahtara göç etmemiş düz
 * metinler bozulmaz. `translate` verilmezse mesajlar olduğu gibi döner (geri uyum).
 */
export interface ErrorHandlerOptions {
  logger: Logger;
  /** Beklenmeyen (altyapı) hatalarda dönen jenerik mesaj (anahtar da olabilir). */
  fallbackMessage: string;
  /**
   * Proje konvansiyonuna göre "bu düz Error aslında bir iş kuralı hatası mı?".
   * Verilmezse yalnızca HttpError/HTTPException iş hatası sayılır.
   */
  isBusinessError?: (error: unknown) => error is Error;
  /** requestId'yi context'ten okuma yolu (proje konvansiyonu). Varsayılan `c.get("requestId")`. */
  getRequestId?: (c: Context) => string | undefined;
  /** Mesaj anahtarlarını çeviren fonksiyon (proje kataloğuyla kurulur). */
  translate?: Translate;
  /** İsteğin dilini context'ten okuma yolu. Varsayılan `c.get("locale")`. */
  getLocale?: (c: Context) => string;
}

export function createErrorHandler(options: ErrorHandlerOptions) {
  const {
    logger,
    fallbackMessage,
    isBusinessError,
    getRequestId = (c) => c.get("requestId"),
    translate,
    getLocale = (c) => (c.get("locale") as string | undefined) ?? "",
  } = options;

  return (err: Error, c: Context) => {
    const requestId = getRequestId(c);
    // Mesaj bir çeviri anahtarı olabilir; katalogda yoksa aynen döner.
    const localize = (message: string, params?: Record<string, unknown>) =>
      translate ? translate(message, getLocale(c), params) : message;

    if (err instanceof HTTPException) {
      return c.json({ success: false, message: localize(err.message), requestId }, err.status);
    }

    if (isHttpError(err) && err.expose) {
      return c.json(
        {
          success: false,
          message: localize(err.message, err.params),
          ...(err.code ? { code: err.code } : {}),
          ...(err.details !== undefined ? { details: err.details } : {}),
          requestId,
        },
        err.status
      );
    }

    if (isBusinessError?.(err) && err.message) {
      return c.json({ success: false, message: localize(err.message), requestId }, 400);
    }

    logger.error({ requestId, method: c.req.method, path: c.req.path, err }, "beklenmeyen hata");
    return c.json({ success: false, message: localize(fallbackMessage), requestId }, 500);
  };
}
