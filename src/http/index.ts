/**
 * core/http barrel — proje-bağımsız HTTP kenar altyapısı: hata sözleşmesi,
 * tek hata çıkışı, doğrulama, yanıt zarfı, istek logu, düzgün kapanma.
 *
 * Tasarım: core mekanizmayı sağlar, dili/mesajı/logger'ı proje ENJEKTE eder
 * (createErrorHandler/createValidator/createResponder hep fabrikadır).
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
export { createValidator, type CreateValidatorOptions } from "./validation";
export { createResponder, type ResponderOptions } from "./respond";
export {
  createRequestLogger,
  type RequestLoggerOptions,
  type RequestLogFields,
} from "./request-logger";
export {
  createShutdownManager,
  type ShutdownManagerOptions,
  type ShutdownManager,
} from "./shutdown";
