import { describe, expect, test } from "bun:test";
import { createECDH, createPublicKey, verify } from "node:crypto";
import { assertVapidKeys, generateVapidKeys, vapidAuthorization, type VapidKeys } from "../src/push";

/**
 * v0.7.0'da rfcear/laputa `packages/core/src/push/vapid.ts`'ten taşındı. "vapid" describe'ı kaynaktaki
 * `vapid.test.ts`'in birebir kopyasıdır (yalnızca import yolu değişti). Kaynakta bu dosyanın ilk testi
 * ~%0,4 olasılıkla kırılıyordu: `generateVapidKeys` baştaki sıfır baytı düşmüş 31 baytlık gizli anahtar
 * üretebiliyordu. Düzeltme ve regresyonu "gizli anahtar dolgusu" describe'ında.
 */

const ENDPOINT = "https://web.push.apple.com/QGuQyavXutnMH8sVNSLVQJ8XE0sS";

function parse(header: string) {
  const match = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header);
  if (!match) throw new Error(`unexpected header: ${header}`);
  const [, head, claims, signature, key] = match as unknown as [string, string, string, string, string];
  return { head, claims, signature, key };
}

describe("vapid", () => {
  test("üretilen anahtarlar doğru biçimde ve tutarlı", () => {
    const keys = generateVapidKeys();
    expect(Buffer.from(keys.publicKey, "base64url").length).toBe(65);
    expect(Buffer.from(keys.privateKey, "base64url").length).toBe(32);
    expect(() => assertVapidKeys(keys)).not.toThrow();
    expect(() => assertVapidKeys({ ...keys, publicKey: generateVapidKeys().publicKey })).toThrow("does not match");
  });

  test("belirteç açık anahtarla doğrulanır; aud, exp, sub doğru", () => {
    const keys = generateVapidKeys();
    const now = 1_700_000_000_000;
    const { head, claims, signature, key } = parse(vapidAuthorization(ENDPOINT, keys, "mailto:info@example.com", now));
    expect(key).toBe(keys.publicKey);
    expect(JSON.parse(Buffer.from(head, "base64url").toString())).toEqual({ typ: "JWT", alg: "ES256" });
    expect(JSON.parse(Buffer.from(claims, "base64url").toString())).toEqual({
      aud: "https://web.push.apple.com",
      exp: 1_700_000_000 + 12 * 3600,
      sub: "mailto:info@example.com",
    });

    const point = Buffer.from(keys.publicKey, "base64url");
    const publicKey = createPublicKey({
      format: "jwk",
      key: { kty: "EC", crv: "P-256", x: point.subarray(1, 33).toString("base64url"), y: point.subarray(33).toString("base64url") },
    });
    const signed = Buffer.from(`${head}.${claims}`);
    const sig = Buffer.from(signature, "base64url");
    expect(sig.length).toBe(64);
    expect(verify("sha256", signed, { key: publicKey, dsaEncoding: "ieee-p1363" }, sig)).toBe(true);
    expect(verify("sha256", Buffer.from(`${head}.x`), { key: publicKey, dsaEncoding: "ieee-p1363" }, sig)).toBe(false);
  });

  test("iletişim adresi mailto: ya da https: olmalı", () => {
    expect(() => vapidAuthorization(ENDPOINT, generateVapidKeys(), "info@example.com")).toThrow("subject");
  });
});

/** Başlığı çözer ve imzanın verilen açık anahtarla doğrulandığını döner. */
function decode(header: string, publicKey: string) {
  const { head, claims, signature, key } = parse(header);
  const point = Buffer.from(publicKey, "base64url");
  const jwk = createPublicKey({
    format: "jwk",
    key: { kty: "EC", crv: "P-256", x: point.subarray(1, 33).toString("base64url"), y: point.subarray(33).toString("base64url") },
  });
  const sig = Buffer.from(signature, "base64url");
  return {
    key,
    signatureLength: sig.length,
    valid: verify("sha256", Buffer.from(`${head}.${claims}`), { key: jwk, dsaEncoding: "ieee-p1363" }, sig),
    claims: JSON.parse(Buffer.from(claims, "base64url").toString()) as { aud: string; exp: number; sub: string },
  };
}

describe("vapid — belirteç", () => {
  const keys = generateVapidKeys();
  const now = 1_700_000_000_000;

  test("aud endpoint'in origin'idir; standart dışı port dahil, yol ve sorgu hariç", () => {
    const header = vapidAuthorization("https://push.example.com:8443/send/abc?x=1", keys, "mailto:a@b.c", now);
    expect(decode(header, keys.publicKey).claims.aud).toBe("https://push.example.com:8443");
    expect(decode(vapidAuthorization(ENDPOINT, keys, "mailto:a@b.c", now), keys.publicKey).claims.aud).toBe("https://web.push.apple.com");
  });

  test("exp en fazla now + 86400; 86401, 0, negatif ve kesirli ttl reddedilir", () => {
    const max = decode(vapidAuthorization(ENDPOINT, keys, "mailto:a@b.c", now, 86_400), keys.publicKey);
    expect(max.claims.exp).toBe(now / 1000 + 86_400);
    expect(max.valid).toBe(true);
    expect(decode(vapidAuthorization(ENDPOINT, keys, "mailto:a@b.c", now, 1), keys.publicKey).claims.exp).toBe(now / 1000 + 1);
    for (const ttl of [86_401, 0, -1, 1.5, Number.NaN]) {
      expect(() => vapidAuthorization(ENDPOINT, keys, "mailto:a@b.c", now, ttl)).toThrow("vapid: ttlSeconds");
    }
  });

  test("sub iletişim adresidir; https: de kabul edilir", () => {
    expect(decode(vapidAuthorization(ENDPOINT, keys, "https://example.com/iletisim", now), keys.publicKey).claims.sub).toBe(
      "https://example.com/iletisim"
    );
    expect(() => vapidAuthorization(ENDPOINT, keys, "http://example.com", now)).toThrow("vapid: subject");
  });

  test("imza 64 bayt (ham r||s) ve açık anahtarla doğrulanır", () => {
    const decoded = decode(vapidAuthorization(ENDPOINT, keys, "mailto:a@b.c", now), keys.publicKey);
    expect(decoded.signatureLength).toBe(64);
    expect(decoded.valid).toBe(true);
  });
});

/**
 * Başı 0x00 olan sabit bir gizli skaler: `ECDH.getPrivateKey()` bunu 31 bayt verir (kaynaktaki hatanın
 * nedeni). Deterministik: rastgele anahtar beklemeden aynı durumu her koşuda üretir.
 */
const LEADING_ZERO_SCALAR = Buffer.concat([Buffer.from([0x00]), Buffer.from(Array.from({ length: 31 }, (_, i) => i + 1))]);

function keysFromScalar(scalar: Buffer): { ecdh: ReturnType<typeof createECDH>; point: Buffer } {
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(scalar);
  return { ecdh, point: ecdh.getPublicKey() };
}

describe("vapid — gizli anahtar dolgusu", () => {
  test("generateVapidKeys her zaman 32/65 bayt üretir ve assert'ten geçer (2000 deneme)", () => {
    for (let i = 0; i < 2000; i++) {
      const keys = generateVapidKeys();
      expect(Buffer.from(keys.privateKey, "base64url").length).toBe(32);
      expect(Buffer.from(keys.publicKey, "base64url").length).toBe(65);
      expect(() => assertVapidKeys(keys)).not.toThrow();
    }
  });

  test("başı 0x00 olan skaler: node 31 bayt verir; 32 baytlık biçim geçer ve imzalar", () => {
    const { ecdh, point } = keysFromScalar(LEADING_ZERO_SCALAR);
    // Hatanın nedeni: kaynak `getPrivateKey().subarray(-32)` ile bunu olduğu gibi (31 bayt) yazıyordu.
    expect(ecdh.getPrivateKey().length).toBe(31);

    const keys: VapidKeys = { publicKey: point.toString("base64url"), privateKey: LEADING_ZERO_SCALAR.toString("base64url") };
    expect(() => assertVapidKeys(keys)).not.toThrow();
    expect(decode(vapidAuthorization(ENDPOINT, keys, "mailto:a@b.c"), keys.publicKey).valid).toBe(true);
  });

  test("31 baytlık girdi (eski kopyaların ürettiği) soldan sıfırla tamamlanıp kabul edilir", () => {
    const { ecdh, point } = keysFromScalar(LEADING_ZERO_SCALAR);
    const keys: VapidKeys = { publicKey: point.toString("base64url"), privateKey: ecdh.getPrivateKey().toString("base64url") };
    expect(Buffer.from(keys.privateKey, "base64url").length).toBe(31);
    expect(() => assertVapidKeys(keys)).not.toThrow();
    const decoded = decode(vapidAuthorization(ENDPOINT, keys, "mailto:a@b.c"), keys.publicKey);
    expect(decoded.valid).toBe(true);
    expect(decoded.signatureLength).toBe(64);
  });

  test("33 baytlık girdi reddedilir (node baştaki sıfırı sessizce kabul etse de)", () => {
    const { point } = keysFromScalar(LEADING_ZERO_SCALAR);
    const keys: VapidKeys = {
      publicKey: point.toString("base64url"),
      privateKey: Buffer.concat([Buffer.from([0x00]), LEADING_ZERO_SCALAR]).toString("base64url"),
    };
    expect(() => assertVapidKeys(keys)).toThrow("32 bytes");
    expect(() => vapidAuthorization(ENDPOINT, keys, "mailto:a@b.c")).toThrow("32 bytes");
    expect(() => assertVapidKeys({ ...keys, privateKey: "" })).toThrow("32 bytes");
  });

  test("açık anahtar bayt olarak karşılaştırılır: dolgulu ya da standart alfabedeki yazım eşleşir", () => {
    // Standart alfabede '+' ya da '/' içeren bir anahtar bulunana dek üret (her denemede ~%100 olası).
    let keys = generateVapidKeys();
    while (!/[+/]/.test(Buffer.from(keys.publicKey, "base64url").toString("base64"))) keys = generateVapidKeys();
    const point = Buffer.from(keys.publicKey, "base64url");
    const standard = point.toString("base64");
    expect(standard).toEndWith("=");

    for (const publicKey of [`${keys.publicKey}=`, standard]) {
      expect(() => assertVapidKeys({ ...keys, publicKey })).not.toThrow();
      // `k=` her zaman kanonik base64url'dir.
      expect(parse(vapidAuthorization(ENDPOINT, { ...keys, publicKey }, "mailto:a@b.c")).key).toBe(keys.publicKey);
    }
    expect(() => assertVapidKeys({ ...keys, privateKey: `${keys.privateKey}=` })).not.toThrow();
  });

  test("bozuk açık anahtar reddedilir", () => {
    const keys = generateVapidKeys();
    expect(() => assertVapidKeys({ ...keys, publicKey: "AAAA" })).toThrow("vapid: public key");
    expect(() => vapidAuthorization(ENDPOINT, { ...keys, publicKey: "AAAA" }, "mailto:a@b.c")).toThrow("vapid: public key");
  });
});
