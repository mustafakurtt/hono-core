/**
 * core/logger barrel — proje-bağımsız, storage/transport-agnostik loglama altyapısı.
 * Proje kurulumu (shared/logger) ve core'daki tüketiciler buradan tek noktadan
 * import eder; alt dosya yollarına bağlanmaz (core/cache/index.ts deseni).
 */
export {
  createLogger,
  LogLevel,
  type CreateLoggerOptions,
  type EmittableLogLevel,
  type Logger,
  type TransportTargetOptions,
} from "./logger";
