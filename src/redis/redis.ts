import { Redis, type RedisOptions } from "ioredis";
import type { Logger } from "../logger/logger";

export type { Redis };

/**
 * Taşınabilir Redis istemci fabrikası. core/ proje-bağımsız kalsın diye URL ve
 * seçenekler dışarıdan verilir (env core'a girmez). Bağlantı hatalarını yutmadan
 * loglamak yaygın bir ihtiyaç olduğu için opsiyonel bir `logger` alır; verilmezse
 * hata olayına dokunmaz (çağıran kendi handler'ını ekler).
 */
export interface CreateRedisOptions {
  url: string;
  options?: RedisOptions;
  /** Verilirse `error` olayı bu logger'a yazılır (İngilizce, dev-facing). */
  logger?: Logger;
}

export function createRedisClient({ url, options, logger }: CreateRedisOptions): Redis {
  const client = options ? new Redis(url, options) : new Redis(url);

  if (logger) {
    client.on("error", (err) => logger.error({ err }, "redis connection error"));
  }

  return client;
}
