export interface CreateThrottleOptions {
  /** Pencere süresi (ms). Pencere anahtarın İLK sayımında açılır ve uzamaz (sabit pencere). */
  windowMs: number;
  /** Pencere başına izin verilen sayım. */
  max: number;
  /**
   * Bellekte tutulan en fazla anahtar. Aşılınca süresi dolanlar, yetmezse en eskiler atılır.
   * Varsayılan 10.000.
   */
  maxKeys?: number;
}

/** Sayar ve "evet/hayır" der; `blocked` saymadan bakar. `now` test için saat dikişidir. */
export interface Throttle {
  (key: string, now?: number): boolean;
  blocked: (key: string, now?: number) => boolean;
}

const DEFAULT_MAX_KEYS = 10_000;

const isPositiveInteger = (value: number) => Number.isInteger(value) && value > 0;

/**
 * Anahtar başına pencere içinde en fazla `max` kez "evet" der. Denetim kaydının gürültüyle
 * (aynı saldırının binlerce satırı) doldurulmasını önler: saldırı yine görünür, ama pencere
 * başına sınırlı satırla. `blocked` saymadan bakar (yalnızca hataları sayan sınırlar için:
 * önce `blocked`, hata olunca çağır).
 * Bellek sınırlıdır: `maxKeys` aşılınca süresi dolanlar, yetmezse en eskiler atılır.
 *
 * `createRateLimiter`'dan farkı: middleware değil, eşzamanlı ve süreç içi bir sayaçtır; isteği
 * değil, çağıranın seçtiği olayı (hatalı 2FA kodu, yazılan denetim satırı) sayar.
 *
 * DİKKAT: süreç-yereldir (çok instance'ta her biri ayrı sayar). Anahtarlar saldırganın
 * üretebildiği değerlerse (oturum kimliği, e-posta), yeni anahtar yağdırarak en eski sayaçları
 * attırabilir; kaba kuvvet sınırları kimliği doğrulanmış kullanıcı kimliğine bağlanmalı.
 */
export function createThrottle({ windowMs, max, maxKeys = DEFAULT_MAX_KEYS }: CreateThrottleOptions): Throttle {
  // maxKeys < 1 iken aşağıdaki budama döngüsü boş Map'te sonsuza dek döner.
  if (!(windowMs > 0)) throw new Error(`throttle: windowMs must be positive, got ${windowMs}`);
  if (!isPositiveInteger(max)) throw new Error(`throttle: max must be a positive integer, got ${max}`);
  if (!isPositiveInteger(maxKeys)) throw new Error(`throttle: maxKeys must be a positive integer, got ${maxKeys}`);

  const hits = new Map<string, { count: number; resetAt: number }>();

  const prune = (now: number) => {
    for (const [key, entry] of hits) if (entry.resetAt <= now) hits.delete(key);
    while (hits.size >= maxKeys) hits.delete(hits.keys().next().value!);
  };

  const allow = (key: string, now = Date.now()): boolean => {
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      if (hits.size >= maxKeys) prune(now);
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    entry.count += 1;
    return entry.count <= max;
  };

  const blocked = (key: string, now = Date.now()) => {
    const entry = hits.get(key);
    return !!entry && entry.resetAt > now && entry.count >= max;
  };

  return Object.assign(allow, { blocked });
}
