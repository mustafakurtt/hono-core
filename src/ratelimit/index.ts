/**
 * core/ratelimit barrel — storage-agnostik, proje-bağımsız hız sınırlama altyapısı.
 * Proje kurulumu (middlewares/rate-limit.middleware.ts) ve testler buradan tek
 * noktadan import eder.
 *
 * Katmanlar: RateLimitStore (port) → adaptörler (memory/redis) → createRateLimiter
 * (Hono middleware fabrikası: anahtarlama + başlıklar + fail-open).
 */
export { createRateLimiter, type CreateRateLimiterOptions } from "./rate-limiter";
export type { RateLimitStore, RateLimitHit } from "./ratelimit.store";

export {
  InMemoryRateLimitStore,
  type InMemoryRateLimitStoreOptions,
} from "./stores/memory.store";
export {
  RedisRateLimitStore,
  type RateLimitRedisClient,
  type RateLimitPipeline,
} from "./stores/redis.store";
export { emailKey } from "./email-key";
// Middleware olmayan, süreç içi olay sayacı (hatalı kod/şifre denemeleri, denetim satırı seyreltme).
export { createThrottle, type CreateThrottleOptions, type Throttle } from "./throttle";
