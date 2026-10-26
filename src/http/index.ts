/**
 * core/http barrel — proje-bağımsız HTTP kenar altyapısı: hata sözleşmesi,
 * tek hata çıkışı, yanıt zarfı, istek logu, düzgün kapanma.
 *
 * Tasarım: core mekanizmayı sağlar, dili/mesajı/logger'ı proje ENJEKTE eder
 * (createErrorHandler/createResponder hep fabrikadır).
 *
 * DOĞRULAMA MIDDLEWARE'İ BURADA DEĞİL: `createValidator` ayrı bir alt yoldan
 * gelir — `@mustafakurtt/hono-core/http/validation`. Gerekçe: bu barrel'ı hata
 * sözleşmesi için import eden HER proje, opsiyonel olması gereken
 * `@hono/zod-validator` peer'ını kurmak zorunda kalıyordu. Aynı ilke
 * `RedisCacheStore`'un ioredis'i import etmemesiyle aynı (bkz. cache/stores).
 *
 * `createZodErrorMapper` ise BURADADIR: kenar-bağımsızdır, zod'u yalnızca tip
 * olarak kullanır ve servis katmanındaki `safeParse` için gereklidir.
 */
export {
  HttpError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  TooManyRequestsError,
  ValidationError,
  isHttpError,
  type HttpErrorOptions,
} from "./errors";

export { createErrorHandler, type ErrorHandlerOptions } from "./error-handler";
export { createResponder, type ResponderOptions } from "./respond";
export {
  createZodErrorMapper,
  type CreateZodErrorMapperOptions,
  type FormattedZodError,
  type MessageTranslator,
  type ZodErrorFormatter,
  type ZodErrorMapper,
} from "./zod-error";
export {
  createRequestLogger,
  type RequestLoggerOptions,
  type RequestLogFields,
} from "./request-logger";
export {
  createShutdownManager,
  type ShutdownManagerOptions,
  type ShutdownManager,
  type ProcessSignal,
} from "./shutdown";
export { createClientIp, ipKey, type ClientIp, type ClientIpOptions } from "./client-ip";
