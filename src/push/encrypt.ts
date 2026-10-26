import { createCipheriv, createECDH, createHmac, randomBytes } from "node:crypto";

/**
 * Web Push içeriğini şifreler (RFC 8291, `aes128gcm` / RFC 8188). İçeriği yalnızca aboneliğin sahibi olan
 * tarayıcı açabilir; aradaki push servisi (Apple, Google, Mozilla) yalnızca şifreli baytları görür.
 *
 * Abonelik anahtarları tarayıcının `PushSubscription.toJSON().keys` değeridir (base64url).
 * `salt` ve `localPrivateKey` yalnızca test vektörleri içindir; gerçek kullanımda her mesajda rastgeledir.
 */
export interface PushKeys {
  p256dh: string;
  auth: string;
}

/** YALNIZCA test vektörü; üretimde verilmez (her mesajda rastgele salt ve geçici anahtar kullanılır). */
export interface EncryptOptions {
  salt?: Uint8Array;
  localPrivateKey?: Uint8Array;
}

/** Tek kayıt; push servisleri 4096 baytın üstünü kabul etmez. */
const RECORD_SIZE = 4096;
const HEADER_SIZE = 16 + 4 + 1 + 65;
const TAG_SIZE = 16;
/** Düz metne eklenen son kayıt ayıracı (RFC 8188 §2). */
const LAST_RECORD = 0x02;
export const MAX_PAYLOAD_BYTES = RECORD_SIZE - HEADER_SIZE - TAG_SIZE - 1;

const hmac = (key: Uint8Array, ...parts: Uint8Array[]) => createHmac("sha256", key).update(Buffer.concat(parts)).digest();
const label = (text: string) => Buffer.from(`${text}\0`, "latin1");
const ONE = Buffer.from([1]);

export function encryptPayload(plaintext: Uint8Array, keys: PushKeys, options: EncryptOptions = {}): Buffer {
  const uaPublic = Buffer.from(keys.p256dh, "base64url");
  const authSecret = Buffer.from(keys.auth, "base64url");
  if (uaPublic.length !== 65 || uaPublic[0] !== 0x04) throw new Error("web push: p256dh must be an uncompressed P-256 point");
  if (authSecret.length !== 16) throw new Error("web push: auth secret must be 16 bytes");
  if (plaintext.length > MAX_PAYLOAD_BYTES) throw new Error(`web push: payload exceeds ${MAX_PAYLOAD_BYTES} bytes`);

  // Her mesajda yeni, tek kullanımlık anahtar çifti (gönderenin kalıcı anahtarı burada kullanılmaz).
  const ecdh = createECDH("prime256v1");
  if (options.localPrivateKey) ecdh.setPrivateKey(Buffer.from(options.localPrivateKey));
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const sharedSecret = ecdh.computeSecret(uaPublic);
  const salt = Buffer.from(options.salt ?? randomBytes(16));

  // RFC 8291 §3.3–3.4: HKDF'nin iki aşaması; 32 baytlık çıktı tek HMAC bloğuna sığar.
  const prkKey = hmac(authSecret, sharedSecret);
  const ikm = hmac(prkKey, label("WebPush: info"), uaPublic, asPublic, ONE);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, label("Content-Encoding: aes128gcm"), ONE).subarray(0, 16);
  const nonce = hmac(prk, label("Content-Encoding: nonce"), ONE).subarray(0, 12);

  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const body = Buffer.concat([cipher.update(plaintext), cipher.update(Buffer.from([LAST_RECORD])), cipher.final(), cipher.getAuthTag()]);

  // Başlık: salt (16) | kayıt boyutu (4, big-endian) | anahtar uzunluğu (1) | gönderenin geçici açık anahtarı (65).
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header[20] = asPublic.length;
  return Buffer.concat([header, asPublic, body]);
}
