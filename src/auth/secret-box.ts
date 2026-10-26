import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Veritabanında duran küçük sırları (TOTP sırrı gibi) AES-256-GCM ile mühürler: yalnızca bir
 * veritabanı yedeği sızarsa sır ele geçmesin. Anahtar verilen metinden türetilir (SHA-256);
 * o metin değişirse eski kutular AÇILAMAZ — çağıran bunu belgelemeli.
 *
 * Biçim: `v1.<iv>.<tag>.<gövde>` (hepsi base64url). Sürüm öneki, ileride algoritma
 * değiştirilirse eski kayıtların tanınması içindir.
 *
 * BİÇİM KİLİTLİDİR: rfcear ve laputa bu biçimle mühürlenmiş sırları saklıyor. Anahtar türetme,
 * kodlama, ayraç, IV (12 bayt) ve tag (16 bayt) uzunluğu değişmemeli; yeni bir biçim gerekirse
 * `v2` olarak EKLENİR ve `v1` açılmaya devam eder. Bkz. `tests/secret-box.test.ts`.
 */
export interface SecretBox {
  seal: (plain: Uint8Array) => string;
  unseal: (box: string) => Buffer;
}

const b64 = (buffer: Buffer) => buffer.toString("base64url");

export function createSecretBox(secret: string): SecretBox {
  const key = createHash("sha256").update(secret).digest();

  return {
    seal(plain) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const body = Buffer.concat([cipher.update(plain), cipher.final()]);
      return ["v1", b64(iv), b64(cipher.getAuthTag()), b64(body)].join(".");
    },

    unseal(box) {
      const [version, iv, tag, body] = box.split(".");
      if (version !== "v1" || !iv || !tag || !body) throw new Error("secret box: unknown format");
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]);
    },
  };
}

/** Karışan karakterler (0/O, 1/I) yok; 10 karakter ≈ 50 bit, tek kullanımlık. */
const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Doğrulayıcı telefonunu kaybedene verilen yedek kodlar (`XXXXX-XXXXX`). */
export function generateRecoveryCodes(count = 10) {
  return Array.from({ length: count }, () => {
    const chars = [...randomBytes(10)].map((byte) => RECOVERY_ALPHABET[byte & 31]).join("");
    return `${chars.slice(0, 5)}-${chars.slice(5)}`;
  });
}

/** Büyük/küçük harf ve tire farkı önemsiz. Kodlar yüksek entropili: tuzsuz SHA-256 yeterli. */
export const hashRecoveryCode = (code: string) =>
  createHash("sha256").update(code.toUpperCase().replace(/[^A-Z0-9]/g, "")).digest("hex");
