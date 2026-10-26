import { createDecipheriv, createECDH, createHmac } from "node:crypto";

const hmac = (key: Uint8Array, ...parts: Uint8Array[]) => createHmac("sha256", key).update(Buffer.concat(parts)).digest();
const label = (text: string) => Buffer.from(`${text}\0`, "latin1");
const ONE = Buffer.from([1]);

/**
 * `encryptPayload`'ın tersi: alıcının (tarayıcının) yaptığı iş. Sunucu bunu üretimde kullanmaz; testlerde
 * gönderilen içeriğin gerçekten açılabildiğini ve ne taşıdığını doğrulamak içindir (RFC 8291, tek kayıt).
 *
 * Alıcı tarafı, YALNIZCA testler: tek kayıt, `rs` (kayıt boyutu) yok sayılır. Gelen trafiğe karşı kullanılmaz;
 * bu yüzden `/push`'tan değil `/push/testing`'den export edilir.
 */
export function decryptPayload(body: Uint8Array, receiverPrivateKey: string, auth: string): Buffer {
  const data = Buffer.from(body);
  const salt = data.subarray(0, 16);
  const keyLength = data[20] ?? 0;
  const senderPublic = data.subarray(21, 21 + keyLength);
  const sealed = data.subarray(21 + keyLength);

  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(Buffer.from(receiverPrivateKey, "base64url"));
  const prkKey = hmac(Buffer.from(auth, "base64url"), ecdh.computeSecret(senderPublic));
  const ikm = hmac(prkKey, label("WebPush: info"), ecdh.getPublicKey(), senderPublic, ONE);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, label("Content-Encoding: aes128gcm"), ONE).subarray(0, 16);
  const nonce = hmac(prk, label("Content-Encoding: nonce"), ONE).subarray(0, 12);

  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(sealed.subarray(-16));
  const padded = Buffer.concat([decipher.update(sealed.subarray(0, -16)), decipher.final()]);
  if (padded.at(-1) !== 0x02) throw new Error("web push: unexpected record delimiter");
  return padded.subarray(0, -1);
}
