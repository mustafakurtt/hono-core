import type { CacheStore } from "./cache.store";
import { jsonCodec, type Codec } from "./codec";
import type { Logger } from "../logger/logger";

export interface CacheOptions {
  /** Alttaki depolama adaptörü (memory / redis / null). */
  store: CacheStore;
  /** Serialization stratejisi. Varsayılan `jsonCodec`. */
  codec?: Codec;
  /** Anahtar öneki (namespace). Genelde `namespace()` ile kurulur. */
  prefix?: string;
  /** `ttlSeconds` verilmeyen yazımlarda kullanılacak varsayılan TTL (saniye). */
  defaultTtlSeconds?: number;
  /** Verilirse decode hataları buraya yazılır (dev-facing, İngilizce). */
  logger?: Logger;
}

export interface WriteOptions {
  /** Bu yazıma özel TTL (saniye). Verilmezse `defaultTtlSeconds`. */
  ttlSeconds?: number;
}

/**
 * Tipli cache facade. Bir `CacheStore` (depolama) + `Codec` (serialization) üzerine
 * ergonomik, storage-agnostik bir katman kurar. Feature'lar doğrudan store/redis'e
 * değil, bir `Cache` (genelde namespace'li) örneğine bağımlıdır (DIP).
 *
 * Öne çıkan yetenek `getOrSet` (read-through) + SINGLE-FLIGHT: aynı anahtar için
 * eşzamanlı miss'lerde loader yalnızca BİR kez çalışır (cache stampede koruması) —
 * ani trafik dalgasında DB'yi tek sorguya indirger.
 *
 * Not: single-flight süreç-yereldir (aynı instance içindeki eşzamanlı çağrılar).
 * Instance'lar arası koordinasyon amaçlanmaz; paylaşımlı sonuç zaten cache'e yazılır.
 *
 * DAYANIKLILIK (fail-open): cache bir OPTİMİZASYONDUR, doğruluk kaynağı değil. Store
 * I/O hatası (ör. Redis anlık kopması) OKUMADA miss'e düşer (kaynağa gidilir) ve
 * getOrSet'in İÇ YAZIMINDA yutulur (değer zaten hesaplandı) — böylece bir Redis
 * takılması isteği düşürmez (rate-limit ile aynı fail-open ilkesi). İSTİSNA: açık
 * `delete` (invalidasyon) hatayı YUTMAZ, çağırana yükseltir — bir invalidasyonu
 * sessizce kaçırmak bayat/yanlış yetki gibi doğruluk hatalarına yol açardı.
 */
export class Cache {
  private readonly store: CacheStore;
  private readonly codec: Codec;
  private readonly prefix: string;
  private readonly defaultTtlSeconds?: number;
  private readonly logger?: Logger;
  /** Uçuştaki yüklemeler (tam anahtar → promise). Çocuk namespace'lerle PAYLAŞILIR. */
  private readonly inFlight: Map<string, Promise<unknown>>;

  constructor(options: CacheOptions, inFlight?: Map<string, Promise<unknown>>) {
    this.store = options.store;
    this.codec = options.codec ?? jsonCodec;
    this.prefix = options.prefix ?? "";
    this.defaultTtlSeconds = options.defaultTtlSeconds;
    this.logger = options.logger;
    // Kök örnek yeni bir harita kurar; çocuklar kökünkini paylaşır ki aynı TAM
    // anahtar farklı namespace nesnelerinden çağrılsa bile tek yükleme olsun.
    this.inFlight = inFlight ?? new Map();
  }

  /**
   * Anahtar önekli çocuk cache. Aynı store/codec/logger'ı ve single-flight
   * haritasını paylaşır; yalnızca anahtar uzayı `prefix:` ile izole olur.
   * Zincirlenebilir: `cache.namespace("university").namespace("faculties")`.
   */
  namespace(prefix: string): Cache {
    return new Cache(
      {
        store: this.store,
        codec: this.codec,
        prefix: this.prefix ? `${this.prefix}:${prefix}` : prefix,
        defaultTtlSeconds: this.defaultTtlSeconds,
        logger: this.logger,
      },
      this.inFlight
    );
  }

  /** Cache'ten tipli değer; yoksa/bozuksa/store hatasında `null` (miss). */
  async get<T>(key: string): Promise<T | null> {
    const raw = await this.safeStoreGet(this.k(key));
    if (raw === null) return null;
    return this.tryDecode<T>(this.k(key), raw);
  }

  async set<T>(key: string, value: T, options?: WriteOptions): Promise<void> {
    const ttl = options?.ttlSeconds ?? this.defaultTtlSeconds;
    await this.store.set(this.k(key), this.codec.encode(value), ttl);
  }

  /** Bir veya birden çok anahtarı geçersiz kılar. */
  async delete(key: string | string[]): Promise<void> {
    const keys = (Array.isArray(key) ? key : [key]).map((k) => this.k(k));
    await this.store.delete(keys);
  }

  /**
   * Read-through: cache'te varsa döner; yoksa `loader` ile hesaplar, cache'ler ve
   * döner. Eşzamanlı miss'lerde single-flight sayesinde loader tek kez koşar.
   *
   * loader `null`/`undefined` dönerse CACHE'LENMEZ (negatif cache'ten kaçınma):
   * "bulunamadı" durumları invalidasyonla temizlenemeyeceği için kalıcı yanlış
   * sonuç riski taşır — bu tür kontroller çağıran katmanda yapılmalı.
   */
  async getOrSet<T>(key: string, loader: () => Promise<T>, options?: WriteOptions): Promise<T> {
    const fullKey = this.k(key);

    const cached = await this.tryGetRaw<T>(fullKey);
    if (cached !== MISS) return cached;

    // Uçuşta aynı anahtar varsa ona bağlan (stampede koruması).
    const pending = this.inFlight.get(fullKey);
    if (pending) return pending as Promise<T>;

    const promise = (async () => {
      const value = await loader();
      if (value !== null && value !== undefined) {
        const ttl = options?.ttlSeconds ?? this.defaultTtlSeconds;
        try {
          await this.store.set(fullKey, this.codec.encode(value), ttl);
        } catch (err) {
          // Yazma best-effort: değer zaten hesaplandı; cache yazımı isteği düşürmesin.
          this.logger?.warn({ err, key: fullKey }, "cache write failed; returning loaded value");
        }
      }
      return value;
    })();

    this.inFlight.set(fullKey, promise);
    try {
      return await promise;
    } finally {
      this.inFlight.delete(fullKey);
    }
  }

  // ── Yardımcılar ────────────────────────────────────────────────────────
  /** Ham anahtarı namespace önekiyle tam anahtara çevirir. */
  private k(key: string): string {
    return this.prefix ? `${this.prefix}:${key}` : key;
  }

  /** Tam anahtar üzerinden get + decode; miss'i sentinel ile ayırt eder (null da geçerli değer olabilir). */
  private async tryGetRaw<T>(fullKey: string): Promise<T | typeof MISS> {
    const raw = await this.safeStoreGet(fullKey);
    if (raw === null) return MISS;
    const decoded = this.tryDecode<T>(fullKey, raw);
    return decoded === null ? MISS : decoded;
  }

  /**
   * Store okuma sarmalayıcısı: I/O hatasını (ör. Redis kopması) YUTAR, loglar ve
   * `null` (miss) döner. Cache doğruluk kaynağı değildir — okuma hatasında kaynağa
   * düşülür, istek düşmez (fail-open). Bozuk-değer temizliği `tryDecode`'ta.
   */
  private async safeStoreGet(fullKey: string): Promise<string | null> {
    try {
      return await this.store.get(fullKey);
    } catch (err) {
      this.logger?.warn({ err, key: fullKey }, "cache read failed; treating as miss");
      return null;
    }
  }

  /**
   * Decode'u güvenli yapar: bozuk/format-değişmiş bir değer varsa (ör. codec
   * güncellemesi) bunu MISS gibi ele al, bozuk anahtarı sil ki tekrar hesaplansın.
   */
  private tryDecode<T>(fullKey: string, raw: string): T | null {
    try {
      return this.codec.decode<T>(raw);
    } catch (err) {
      this.logger?.warn({ err, key: fullKey }, "cache decode failed; treating as miss");
      // best-effort temizlik; hatayı yutup miss'e düşer.
      void this.store.delete([fullKey]).catch(() => {});
      return null;
    }
  }
}

/** getOrSet içinde "cache'te yok" ile "değeri null" ayrımı için özel sentinel. */
const MISS = Symbol("cache-miss");
