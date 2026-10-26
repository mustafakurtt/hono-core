import { describe, expect, test } from "bun:test";
import { createECDH, createPublicKey, verify } from "node:crypto";
import { assertVapidKeys, encryptPayload, vapidAuthorization } from "../src/push";
import { decryptPayload } from "../src/push/testing";

/**
 * TÜKETİCİ UYUMU — mevcut kurulumların verisi geçişten sonra da çalışmalı:
 *   - `.env`'deki VAPID anahtarları (rfcear `push:keys` biçimi: `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`,
 *     base64url). Anahtar değişirse tüm cihazların yeniden abone olması gerekir.
 *   - DB'deki abonelik anahtarları: rfcear `packages/contracts/src/schemas/push.ts` şemasından geçmiş değerler.
 */

/** Bir kez `generateVapidKeys()` ile üretilip gömüldü; değiştirilmemeli. */
const VAPID_ENV = {
  VAPID_PUBLIC_KEY: "BJ_EuHVDBoJOKlW2vdq5QibKtSZl1tXbrJoXf64ykNWfa2Dq5eXZV60s22ZgYeoaodlZ7QDQCBwL9hw9fG5C4Rs",
  VAPID_PRIVATE_KEY: "-rnz4gmudPCi21japINL7gsPGKFikQDSJ7Ywb5zVq3I",
  VAPID_SUBJECT: "mailto:info@example.com",
};

// contracts şemasındaki regex'lerin birebir aynısı (`base64url(86, 88)` ve `base64url(21, 24)`).
const P256DH_SCHEMA = /^[A-Za-z0-9_-]{86,88}$/;
const AUTH_SCHEMA = /^[A-Za-z0-9_-]{21,24}$/;

describe("tüketici uyumu", () => {
  test("rfcear biçimindeki sabit VAPID anahtarı assert'ten geçer ve doğrulanabilir imza üretir", () => {
    const keys = { publicKey: VAPID_ENV.VAPID_PUBLIC_KEY, privateKey: VAPID_ENV.VAPID_PRIVATE_KEY };
    expect(() => assertVapidKeys(keys)).not.toThrow();

    const header = vapidAuthorization("https://web.push.apple.com/abc", keys, VAPID_ENV.VAPID_SUBJECT);
    const match = /^vapid t=([\w-]+\.[\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header);
    expect(match).not.toBeNull();
    const [, signingInput, signature, k] = match as unknown as [string, string, string, string];
    expect(k).toBe(VAPID_ENV.VAPID_PUBLIC_KEY);

    const point = Buffer.from(keys.publicKey, "base64url");
    const publicKey = createPublicKey({
      format: "jwk",
      key: { kty: "EC", crv: "P-256", x: point.subarray(1, 33).toString("base64url"), y: point.subarray(33).toString("base64url") },
    });
    expect(verify("sha256", Buffer.from(signingInput), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url"))).toBe(
      true
    );
  });

  test("contracts şemasından geçen abonelik anahtarlarıyla şifrelenir; dolgulu biçim de kabul edilir", () => {
    const ecdh = createECDH("prime256v1");
    ecdh.generateKeys();
    const point = ecdh.getPublicKey();
    const auth = Buffer.from("0123456789abcdef");
    const receiver = ecdh.getPrivateKey().toString("base64url");

    // Tarayıcının `PushSubscription.toJSON()` çıktısı: dolgusuz base64url, şemadan geçer.
    const stored = { p256dh: point.toString("base64url"), auth: auth.toString("base64url") };
    expect(stored.p256dh).toMatch(P256DH_SCHEMA);
    expect(stored.auth).toMatch(AUTH_SCHEMA);
    const body = encryptPayload(Buffer.from("bildirim"), stored);
    expect(decryptPayload(body, receiver, stored.auth).toString("utf8")).toBe("bildirim");
  });

  test("gevşek çözme: dolgulu ya da standart alfabedeki anahtar da kabul edilir", () => {
    const ecdh = createECDH("prime256v1");
    ecdh.generateKeys();
    const point = ecdh.getPublicKey();
    const auth = Buffer.from("0123456789abcdef");
    const receiver = ecdh.getPrivateKey().toString("base64url");

    for (const keys of [
      { p256dh: `${point.toString("base64url")}=`, auth: `${auth.toString("base64url")}==` },
      { p256dh: point.toString("base64"), auth: auth.toString("base64") },
    ]) {
      const body = encryptPayload(Buffer.from("bildirim"), keys);
      expect(decryptPayload(body, receiver, auth.toString("base64url")).toString("utf8")).toBe("bildirim");
    }
  });
});
