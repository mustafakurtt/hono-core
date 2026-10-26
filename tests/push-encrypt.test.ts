import { describe, expect, test } from "bun:test";
import { encryptPayload, MAX_PAYLOAD_BYTES } from "../src/push";
import { decryptPayload } from "../src/push/testing";

/**
 * v0.7.0'da rfcear/laputa `packages/core/src/push/encrypt.ts`'ten taşındı. "web push şifreleme"
 * describe'ı kaynaktaki `encrypt.test.ts`'in birebir kopyasıdır (yalnızca import yolları değişti);
 * "sınırlar" sonradan eklendi.
 */

// RFC 8291 Ek A: tüm girdiler ve beklenen çıktı.
const RFC = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  body:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_y" +
    "l95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

const b = (value: string) => Buffer.from(value, "base64url");
const keys = { p256dh: RFC.uaPublic, auth: RFC.auth };

describe("web push şifreleme", () => {
  test("RFC 8291 Ek A test vektörü", () => {
    const body = encryptPayload(Buffer.from(RFC.plaintext), keys, { salt: b(RFC.salt), localPrivateKey: b(RFC.asPrivate) });
    expect(body.toString("base64url")).toBe(RFC.body);
  });

  test("RFC vektörü alıcının anahtarıyla açılır", () => {
    expect(decryptPayload(b(RFC.body), RFC.uaPrivate, RFC.auth).toString("utf8")).toBe(RFC.plaintext);
  });

  test("rastgele anahtarla şifrelenen içerik alıcıda açılır, her seferinde farklıdır", () => {
    const payload = JSON.stringify({ title: "Yeni talep", body: "Görüşme: 15 Ekim 14:00" });
    const first = encryptPayload(Buffer.from(payload), keys);
    const second = encryptPayload(Buffer.from(payload), keys);
    expect(first.equals(second)).toBe(false);
    expect(decryptPayload(first, RFC.uaPrivate, RFC.auth).toString("utf8")).toBe(payload);
  });

  test("yanlış anahtarla açılmaz", () => {
    const body = encryptPayload(Buffer.from("gizli"), keys);
    expect(() => decryptPayload(body, RFC.asPrivate, RFC.auth)).toThrow();
  });

  test("bozuk anahtar ve fazla büyük içerik reddedilir", () => {
    expect(() => encryptPayload(Buffer.from("x"), { p256dh: "AAAA", auth: RFC.auth })).toThrow("p256dh");
    expect(() => encryptPayload(Buffer.from("x"), { p256dh: RFC.uaPublic, auth: "AAAA" })).toThrow("auth");
    const big = Buffer.alloc(MAX_PAYLOAD_BYTES + 1, 97);
    expect(() => encryptPayload(big, keys)).toThrow("exceeds");
    expect(encryptPayload(big.subarray(1), keys).length).toBe(4096);
  });
});

describe("web push şifreleme — sınırlar", () => {
  test("MAX_PAYLOAD_BYTES 3993: tam sınırdaki içerik 4096 baytlık tek kayda sığar ve açılır", () => {
    expect(MAX_PAYLOAD_BYTES).toBe(3993);
    const exact = Buffer.alloc(3993, 0x61);
    const body = encryptPayload(exact, keys);
    expect(body.length).toBe(4096);
    // Başlıktaki kayıt boyutu (rs) 4096, anahtar uzunluğu 65.
    expect(body.readUInt32BE(16)).toBe(4096);
    expect(body[20]).toBe(65);
    expect(decryptPayload(body, RFC.uaPrivate, RFC.auth).equals(exact)).toBe(true);
  });

  test("3994 bayt reddedilir; hata mesajı web push: önekli", () => {
    expect(() => encryptPayload(Buffer.alloc(3994), keys)).toThrow("web push: payload exceeds 3993 bytes");
  });

  test("bozuk p256dh reddedilir: yanlış uzunluk ya da sıkıştırılmış nokta", () => {
    const point = b(RFC.uaPublic);
    const compressed = Buffer.concat([Buffer.from([0x02]), point.subarray(1, 33)]).toString("base64url");
    const wrongPrefix = Buffer.concat([Buffer.from([0x05]), point.subarray(1)]).toString("base64url");
    for (const p256dh of ["", compressed, wrongPrefix, RFC.uaPublic.slice(0, -4)]) {
      expect(() => encryptPayload(Buffer.from("x"), { p256dh, auth: RFC.auth })).toThrow("web push: p256dh");
    }
  });

  test("bozuk auth reddedilir: 16 bayttan kısa ya da uzun", () => {
    for (const auth of ["", Buffer.alloc(15).toString("base64url"), Buffer.alloc(17).toString("base64url")]) {
      expect(() => encryptPayload(Buffer.from("x"), { p256dh: RFC.uaPublic, auth })).toThrow("web push: auth");
    }
  });

  test("boş içerik de şifrelenir ve açılır", () => {
    const body = encryptPayload(new Uint8Array(0), keys);
    expect(decryptPayload(body, RFC.uaPrivate, RFC.auth).length).toBe(0);
  });
});
