import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * Taşınabilir HTTP hata sözleşmesi. core/ proje-bağımsız kalır: bu sınıflar dil
 * BİLMEZ, mesajı çağıran verir (Türkçe metinler feature katmanında kalır).
 *
 * Kritik fikir: iş kuralı hataları artık status'unu KENDİ taşır. Eskiden merkezi
 * katman status'u mesaj metninden ("bulunamadı" → 404) çıkarıyordu; bu çıkarım
 * dile yapışıktı ve başka bir projeye/dile taşınamıyordu. Açık `status` alanı bu
 * bağımlılığı ortadan kaldırır.
 *
 * `expose`: mesaj istemciye gösterilmeye güvenli mi? HttpError'lar bilinçli
 * fırlatıldığı için varsayılan `true`. Altyapı hataları (pg, drizzle, TypeError...)
 * bu sınıftan TÜREMEZ; merkezi handler onları jenerik 500'e düşürür, mesaj sızmaz.
 *
 * `code`: opsiyonel makine-okur kod — frontend'in mesajı string eşleştirmeden
 * ayırt edebilmesi için (örn. "EMAIL_NOT_VERIFIED").
 *
 * `details`: opsiyonel yapılandırılmış ek bilgi (örn. doğrulama hatalarında
 * alan-bazlı issue listesi). Handler bunu cevaba olduğu gibi ekler.
 *
 * `params`: `message` bir çeviri anahtarıysa, şablondaki `{param}` yerlerine
 * konulacak değerler (örn. { domain }). Çeviri handler'da, isteğin diline göre
 * yapılır; katalog yoksa `message` düz metin gibi aynen döner (geri uyum).
 */
export interface HttpErrorOptions {
  code?: string;
  expose?: boolean;
  details?: unknown;
  params?: Record<string, unknown>;
  cause?: unknown;
}

export class HttpError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code?: string;
  readonly expose: boolean;
  readonly details?: unknown;
  readonly params?: Record<string, unknown>;

  constructor(status: ContentfulStatusCode, message: string, options?: HttpErrorOptions) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    // new.target: alt sınıftan çağrılınca "NotFoundError" vb. verir.
    this.name = new.target.name;
    this.status = status;
    this.code = options?.code;
    this.expose = options?.expose ?? true;
    this.details = options?.details;
    this.params = options?.params;
  }
}

export class BadRequestError extends HttpError {
  constructor(message: string, options?: HttpErrorOptions) {
    super(400, message, options);
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message: string, options?: HttpErrorOptions) {
    super(401, message, options);
  }
}

export class ForbiddenError extends HttpError {
  constructor(message: string, options?: HttpErrorOptions) {
    super(403, message, options);
  }
}

export class NotFoundError extends HttpError {
  constructor(message: string, options?: HttpErrorOptions) {
    super(404, message, options);
  }
}

export class ConflictError extends HttpError {
  constructor(message: string, options?: HttpErrorOptions) {
    super(409, message, options);
  }
}

/**
 * Hız sınırı aşıldı. `code` varsayılan "RATE_LIMITED" — frontend'in mesaj metnine
 * string-match etmeden 429'u ayırt edebilmesi için (aynı EMAIL_NOT_VERIFIED
 * konvansiyonu). `Retry-After`/`RateLimit-*` başlıkları hatayı fırlatan katmanın
 * sorumluluğudur (bkz. core/ratelimit/rate-limiter.ts).
 */
export class TooManyRequestsError extends HttpError {
  constructor(message: string, options?: Omit<HttpErrorOptions, "code"> & { code?: string }) {
    super(429, message, { ...options, code: options?.code ?? "RATE_LIMITED" });
  }
}

/**
 * Girdi doğrulama hatası (422 değil, proje konvansiyonu gereği 400). `code`
 * varsayılan "VALIDATION_ERROR" — frontend string eşleştirmeden ayırt eder;
 * `details` alan-bazlı issue listesini taşır. Doğrulama katmanı (bkz.
 * core/http/validation.ts) bunu fırlatır, `app.onError` diğer HttpError'lar
 * gibi tek noktadan çevirir.
 */
export class ValidationError extends HttpError {
  constructor(message: string, options?: Omit<HttpErrorOptions, "code"> & { code?: string }) {
    super(400, message, { ...options, code: options?.code ?? "VALIDATION_ERROR" });
  }
}

export const isHttpError = (error: unknown): error is HttpError => error instanceof HttpError;
