import { describe, expect, test } from "bun:test";
import { createECDH, createPublicKey, verify } from "node:crypto";
import webpush from "web-push";
import { assertVapidKeys, generateVapidKeys, vapidAuthorization, type VapidKeys } from "../src/push";
import { decryptPayload } from "../src/push/testing";

/**
 * BİRLİKTE ÇALIŞABİLİRLİK — core'un kendi yazdığı kripto, yaygın `web-push` kütüphanesiyle (yalnızca dev
 * bağımlılığı) karşılaştırılır. Yalnızca genel API kullanılır (`generateVAPIDKeys`, `generateRequestDetails`);
 * ağ yok: `generateRequestDetails` isteği kurar ama göndermez.
 */

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/interop-test";
const SUBJECT = "mailto:interop@example.com";

/** Test aboneliği: tarayıcının yapacağı gibi yeni bir P-256 çifti ve 16 baytlık auth. */
function testSubscription() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = Buffer.from(Array.from({ length: 16 }, (_, i) => i * 7 + 3)).toString("base64url");
  return {
    subscription: { endpoint: ENDPOINT, keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth } },
    privateKey: ecdh.getPrivateKey().toString("base64url"),
  };
}

function parseAuthorization(header: string) {
  const match = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header);
  if (!match) throw new Error(`unexpected header: ${header}`);
  const [, head, claims, signature, key] = match as unknown as [string, string, string, string, string];
  const json = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString()) as Record<string, unknown>;
  return { head: json(head), claims: json(claims), signingInput: `${head}.${claims}`, signature: Buffer.from(signature, "base64url"), key };
}

function verifies(parsed: ReturnType<typeof parseAuthorization>, publicKey: string) {
  const point = Buffer.from(publicKey, "base64url");
  const key = createPublicKey({
    format: "jwk",
    key: { kty: "EC", crv: "P-256", x: point.subarray(1, 33).toString("base64url"), y: point.subarray(33).toString("base64url") },
  });
  return verify("sha256", Buffer.from(parsed.signingInput), { key, dsaEncoding: "ieee-p1363" }, parsed.signature);
}

describe("web-push ile birlikte çalışabilirlik", () => {
  test("web-push'un şifrelediği gövde core decryptPayload ile açılır", () => {
    const { subscription, privateKey } = testSubscription();
    for (const payload of ["merhaba", JSON.stringify({ title: "Yeni talep", body: "Görüşme: 15 Ekim 14:00 — ğüşiöç" }), "x".repeat(3000)]) {
      const details = webpush.generateRequestDetails(subscription, payload, {
        vapidDetails: { subject: SUBJECT, ...generateVapidKeys() },
      });
      expect(details.headers["Content-Encoding"]).toBe("aes128gcm");
      expect(decryptPayload(details.body!, privateKey, subscription.keys.auth).toString("utf8")).toBe(payload);
    }
  });

  test("web-push.generateVAPIDKeys() çıktısı assertVapidKeys'ten geçer ve core ile imzalanır (200 deneme)", () => {
    for (let i = 0; i < 200; i++) {
      const keys: VapidKeys = webpush.generateVAPIDKeys();
      expect(() => assertVapidKeys(keys)).not.toThrow();
      expect(verifies(parseAuthorization(vapidAuthorization(ENDPOINT, keys, SUBJECT)), keys.publicKey)).toBe(true);
    }
  });

  test("core'un ürettiği VAPID anahtarlarını web-push kabul eder (32 baytlık gizli anahtar şartı)", () => {
    const { subscription } = testSubscription();
    for (let i = 0; i < 200; i++) {
      const keys = generateVapidKeys();
      expect(() => webpush.generateRequestDetails(subscription, "x", { vapidDetails: { subject: SUBJECT, ...keys } })).not.toThrow();
    }
  });

  test("core JWT'si web-push'unkiyle aynı başlık/claim yapısında; ikisi de doğrulanır", () => {
    const keys = generateVapidKeys();
    const { subscription } = testSubscription();
    const now = Date.now();
    const theirs = parseAuthorization(
      String(webpush.generateRequestDetails(subscription, "x", { vapidDetails: { subject: SUBJECT, ...keys } }).headers.Authorization)
    );
    const ours = parseAuthorization(vapidAuthorization(ENDPOINT, keys, SUBJECT, now));

    expect(ours.head).toEqual(theirs.head);
    expect(Object.keys(ours.claims).sort()).toEqual(Object.keys(theirs.claims).sort());
    expect(ours.claims.aud).toBe(theirs.claims.aud as string);
    expect(ours.claims.sub).toBe(theirs.claims.sub as string);
    // İkisinin varsayılanı da 12 saat; saniye sınırına denk gelme payı.
    expect(Math.abs((ours.claims.exp as number) - (theirs.claims.exp as number))).toBeLessThanOrEqual(2);
    expect(ours.key).toBe(theirs.key);
    expect(ours.signature.length).toBe(64);
    expect(theirs.signature.length).toBe(64);
    expect(verifies(ours, keys.publicKey)).toBe(true);
    expect(verifies(theirs, keys.publicKey)).toBe(true);
  });
});
