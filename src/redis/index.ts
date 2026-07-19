/**
 * core/redis barrel — ioredis istemci fabrikası (env okumaz, URL enjekte edilir).
 *
 * NOT: abone (subscriber) bağlantısı AYRI bir istemci olmalıdır — ioredis
 * abone modundaki bir bağlantıda normal komutlara izin vermez.
 */
export { createRedisClient, type CreateRedisOptions } from "./redis";
