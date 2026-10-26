import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * RFC 6238 TOTP (HMAC-SHA1, 30 sn, 6 hane): Google Authenticator, Microsoft Authenticator,
 * 1Password vb. hepsiyle uyumlu varsayılanlar. Dış paket yok; RFC test vektörleriyle sınanır.
 *
 * Adım süresi, hane sayısı ve kabul penceresi `TotpOptions` ile değiştirilebilir; verilmezse
 * yukarıdaki varsayılanlar kullanılır. Değiştiren proje, aynı ayarı `otpauthUri`'ye de
 * vermelidir: doğrulayıcı uygulama kodu o adresteki `digits`/`period`'a göre üretir.
 */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const DEFAULT_STEP_SECONDS = 30;
const DEFAULT_DIGITS = 6;
/** Telefon saati kayabilir: bir önceki ve bir sonraki adım da kabul edilir (±30 sn). */
const DEFAULT_WINDOW = 1;
/** RFC 4226 §5.3: en az 6 hane; 31 bitlik değerden anlamlı en fazla 8 hane alınır. */
const MIN_DIGITS = 6;
const MAX_DIGITS = 8;

export interface TotpOptions {
  /** Bir kodun geçerli olduğu süre (sn). Varsayılan 30. */
  stepSeconds?: number;
  /** Kod uzunluğu (6–8). Varsayılan 6. */
  digits?: number;
  /** Saat kayması toleransı (adım): `window: 1` → önceki/şimdiki/sonraki adım. Varsayılan 1. */
  window?: number;
}

const isPositiveInteger = (value: number) => Number.isInteger(value) && value > 0;

function resolveOptions({
  stepSeconds = DEFAULT_STEP_SECONDS,
  digits = DEFAULT_DIGITS,
  window = DEFAULT_WINDOW,
}: TotpOptions): Required<TotpOptions> {
  if (!isPositiveInteger(stepSeconds)) throw new Error(`totp: stepSeconds must be a positive integer, got ${stepSeconds}`);
  if (!Number.isInteger(digits) || digits < MIN_DIGITS || digits > MAX_DIGITS) {
    throw new Error(`totp: digits must be an integer between ${MIN_DIGITS} and ${MAX_DIGITS}, got ${digits}`);
  }
  if (!Number.isInteger(window) || window < 0) throw new Error(`totp: window must be a non-negative integer, got ${window}`);
  return { stepSeconds, digits, window };
}

/** 20 bayt (160 bit) rastgele TOTP sırrı; RFC 4226'nın önerdiği uzunluk. */
export const generateSecret = () => randomBytes(20);

export function base32(bytes: Uint8Array) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return bits > 0 ? out + ALPHABET[(value << (5 - bits)) & 31] : out;
}

export function hotp(secret: Uint8Array, counter: number, options: Pick<TotpOptions, "digits"> = {}) {
  const { digits } = resolveOptions(options);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", secret).update(message).digest();
  const offset = mac[mac.length - 1]! & 15;
  const binary = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, "0");
}

export const stepAt = (ms: number, options: Pick<TotpOptions, "stepSeconds"> = {}) =>
  Math.floor(ms / 1000 / resolveOptions(options).stepSeconds);

/**
 * Kod geçerliyse eşleşen zaman adımını döner. `lastStep` ve öncesi reddedilir: aynı kod
 * (ör. omuz üstünden görülen) ikinci kez kullanılamaz.
 *
 * Deneme sınırı YOKTUR: 6 haneli kod kaba kuvvetle bulunabilir, çağıran hatalı denemeleri
 * sınırlamalıdır (ör. `@mustafakurtt/hono-core/ratelimit`'in `createThrottle`'ı).
 */
export function matchStep(
  secret: Uint8Array,
  code: string,
  lastStep: number | null,
  now = Date.now(),
  options: TotpOptions = {}
) {
  const resolved = resolveOptions(options);
  if (code.length !== resolved.digits || !/^\d+$/.test(code)) return null;
  const current = stepAt(now, resolved);
  for (let step = current - resolved.window; step <= current + resolved.window; step++) {
    if (lastStep !== null && step <= lastStep) continue;
    if (timingSafeEqual(Buffer.from(hotp(secret, step, resolved)), Buffer.from(code))) return step;
  }
  return null;
}

/**
 * Doğrulayıcı uygulamanın QR ile okuduğu adres. `issuer` uygulamada görünen addır
 * ("Örnek Panel" gibi) ve projeye aittir: core adını bilmez.
 */
export const otpauthUri = (
  issuer: string,
  account: string,
  secret: Uint8Array,
  options: Pick<TotpOptions, "stepSeconds" | "digits"> = {}
) => {
  const { digits, stepSeconds } = resolveOptions(options);
  return (
    `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${base32(secret)}` +
    `&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${digits}&period=${stepSeconds}`
  );
};
