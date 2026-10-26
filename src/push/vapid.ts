import { createECDH, createPrivateKey, sign } from "node:crypto";

/**
 * VAPID (RFC 8292): push servisine "bu bildirimi bu sunucu gönderiyor" diye kendini tanıtan imzalı belirteç.
 * Tarayıcı aboneliği bu açık anahtara bağlar; anahtar değişirse eski abonelikler geçersiz olur ve cihazların
 * yeniden abone olması gerekir. Bu yüzden anahtar bir kez üretilir ve sır gibi saklanır.
 *
 * Biçim (web-push kütüphaneleriyle aynı): açık anahtar 65 baytlık sıkıştırılmamış nokta, gizli anahtar
 * 32 baytlık skaler; ikisi de base64url. Girdi gevşek çözülür (standart alfabe ve `=` dolgusu da kabul
 * edilir). Baştaki sıfır baytı düşmüş, 32 bayttan kısa bir gizli anahtar soldan sıfırla tamamlanır;
 * 32 bayttan uzunu reddedilir.
 */
export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

/** Servisler en çok 24 saat kabul eder; saat kaymasına pay bırakılır. */
const DEFAULT_TTL_SECONDS = 12 * 60 * 60;
/** RFC 8292 §2: `exp` şimdiden en fazla 24 saat sonra olabilir. */
const MAX_TTL_SECONDS = 24 * 60 * 60;
const SCALAR_SIZE = 32;

const b64 = (value: string | Uint8Array) => Buffer.from(value).toString("base64url");

/**
 * `ECDH.getPrivateKey()` skaleri büyük tamsayı gibi verir: baştaki sıfır baytları düşer (~%0,4 olasılıkla
 * 31 bayt). JWK `d` ve web-push uyumu için her zaman 32 bayta tamamlanır.
 */
function padScalar(scalar: Buffer): Buffer {
  if (scalar.length > SCALAR_SIZE) throw new Error("vapid: private key must be 32 bytes");
  if (scalar.length === SCALAR_SIZE) return scalar;
  return Buffer.concat([Buffer.alloc(SCALAR_SIZE - scalar.length), scalar]);
}

export function generateVapidKeys(): VapidKeys {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { publicKey: b64(ecdh.getPublicKey()), privateKey: b64(padScalar(ecdh.getPrivateKey())) };
}

function decodeKeys({ publicKey, privateKey }: VapidKeys) {
  const point = Buffer.from(publicKey, "base64url");
  const scalar = Buffer.from(privateKey, "base64url");
  if (point.length !== 65 || point[0] !== 0x04) throw new Error("vapid: public key must be an uncompressed P-256 point");
  if (scalar.length === 0) throw new Error("vapid: private key must be 32 bytes");
  return { point, scalar: padScalar(scalar) };
}

function signingKey(point: Buffer, scalar: Buffer) {
  return createPrivateKey({
    format: "jwk",
    key: { kty: "EC", crv: "P-256", d: b64(scalar), x: b64(point.subarray(1, 33)), y: b64(point.subarray(33)) },
  });
}

/** Anahtar çiftinin tutarlı olduğunu açılışta denetlemek için (yanlış kopyalanmış değer erken yakalanır). */
export function assertVapidKeys(keys: VapidKeys): void {
  const { point, scalar } = decodeKeys(keys);
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(scalar);
  // Baytlar karşılaştırılır: aynı anahtarın dolgulu ya da standart alfabedeki yazımı da eşleşir.
  if (!ecdh.getPublicKey().equals(point)) throw new Error("vapid: public key does not match private key");
  signingKey(point, scalar);
}

/**
 * `Authorization` başlığının değeri. `subject` iletişim adresidir (`mailto:` ya da `https:`): push servisi
 * bir sorun görürse bu adrese yazar. `ttlSeconds` belirtecin ömrüdür: 1..86400 arası tamsayı.
 * `k=` her zaman kanonik base64url'dir (girdi dolgulu yazılmış olsa da).
 */
export function vapidAuthorization(
  endpoint: string,
  keys: VapidKeys,
  subject: string,
  now = Date.now(),
  ttlSeconds = DEFAULT_TTL_SECONDS
): string {
  if (!/^(mailto:|https:)/.test(subject)) throw new Error("vapid: subject must be a mailto: or https: URI");
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > MAX_TTL_SECONDS) {
    throw new Error(`vapid: ttlSeconds must be an integer between 1 and ${MAX_TTL_SECONDS}`);
  }
  const { point, scalar } = decodeKeys(keys);
  const header = b64(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const claims = b64(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + ttlSeconds, sub: subject }));
  // JWS ES256 imzası ham r||s (64 bayt) ister; DER değil.
  const signature = sign("sha256", Buffer.from(`${header}.${claims}`), { key: signingKey(point, scalar), dsaEncoding: "ieee-p1363" });
  return `vapid t=${header}.${claims}.${b64(signature)}, k=${b64(point)}`;
}
