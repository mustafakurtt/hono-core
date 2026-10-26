import { describe, expect, test } from "bun:test";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { createSecretBox, generateRecoveryCodes, hashRecoveryCode } from "../src/auth";

/**
 * v0.5.0'da rfcear/laputa `packages/core/src/auth/secret-box.ts`'ten taşındı. İlk iki describe
 * kaynaktaki testlerin birebir kopyasıdır (laputa kopyası yalnızca SECRET metninde farklıdır).
 * Üretimde iki proje bu biçimle mühürlenmiş 2FA sırları saklıyor: davranış DEĞİŞMEMELİ.
 */
const SECRET = "rfcear:totp:deneme-sirri";
const box = createSecretBox(SECRET);

describe("createSecretBox", () => {
  test("mühürlenen açılır", () => {
    const plain = randomBytes(20);
    expect(box.unseal(box.seal(plain)).equals(Buffer.from(plain))).toBe(true);
  });

  test("her mühür farklı (rastgele iv)", () => {
    const plain = randomBytes(20);
    expect(box.seal(plain)).not.toBe(box.seal(plain));
  });

  /**
   * BİÇİM KİLİDİ: kutu `v1.<iv>.<tag>.<gövde>` ve anahtar `sha256(secret)`. Bu test, bu dosyadan
   * bağımsız olarak (elle şifrelenmiş bir kutuyla) aynı sonucu bekler. Düşerse, veritabanında
   * duran eski kayıtlar açılamaz hale gelmiş demektir.
   */
  test("önceki sürümün mühürlediği kutu açılır", () => {
    const plain = Buffer.from("gizli-totp-sirri");
    const key = createHash("sha256").update(SECRET).digest();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const body = Buffer.concat([cipher.update(plain), cipher.final()]);
    const legacy = [
      "v1",
      iv.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      body.toString("base64url"),
    ].join(".");

    expect(box.unseal(legacy).toString()).toBe("gizli-totp-sirri");
  });

  test("başka sır açamaz", () => {
    const other = createSecretBox("baska-sir");
    expect(() => other.unseal(box.seal(randomBytes(8)))).toThrow();
  });

  test("kurcalanmış kutu açılmaz", () => {
    const [version, iv, tag, body] = box.seal(Buffer.from("abc")).split(".");
    const flipped = `${body!.slice(0, -2)}${body!.slice(-2) === "AA" ? "AB" : "AA"}`;
    expect(() => box.unseal([version, iv, tag, flipped].join("."))).toThrow();
  });

  test("bozuk biçim anlaşılır hata verir", () => {
    expect(() => box.unseal("v2.a.b.c")).toThrow("unknown format");
    expect(() => box.unseal("tek-parca")).toThrow("unknown format");
  });
});

describe("kurtarma kodları", () => {
  test("10 kod, XXXXX-XXXXX biçiminde ve karışan karakter yok", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    for (const code of codes) expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/);
    expect(new Set(codes).size).toBe(10);
  });

  test("sayı istenebilir", () => {
    expect(generateRecoveryCodes(3)).toHaveLength(3);
  });

  test("özet büyük/küçük harf ve tire farkını yok sayar", () => {
    const [code] = generateRecoveryCodes(1);
    expect(hashRecoveryCode(code!.toLowerCase())).toBe(hashRecoveryCode(code!.replace("-", "")));
  });

  test("farklı kod farklı özet", () => {
    expect(hashRecoveryCode("ABCDE-FGHJK")).not.toBe(hashRecoveryCode("ABCDE-FGHJL"));
  });
});

/**
 * UYUMLULUK VEKTÖRLERİ: aşağıdaki değerler core'a taşınmadan ÖNCE, kaynak projelerin kendi
 * `packages/core/src/auth/secret-box.ts`'i ile bir kez üretilip buraya sabit olarak gömüldü
 * (RFC 6238'in test sırrı mühürlendi). Biçim kilidi testi biçimi bu dosyadaki koda göre yeniden
 * kurar; bunlar ise gerçekten eski kodun ürettiği baytları açar. İkisi birlikte, veritabanındaki
 * mevcut kayıtların core sürümüyle açılabildiğini kanıtlar. ASLA yeniden üretilmemeli.
 */
describe("secret-box uyumluluğu (kaynak projelerin mühürlediği değerler)", () => {
  const TOTP_SECRET = Buffer.from("12345678901234567890");
  const VECTORS: [project: string, secret: string, sealed: string][] = [
    ["rfcear", "rfcear:totp:deneme-sirri", "v1.dL5L_Pigy-IuVCTA.f459g4V5nnv8_h9JtLDCqQ._1-loas0KcUhC-RncvKTjz7F1-Q"],
    ["laputa", "laputa:totp:deneme-sirri", "v1.XFAHwjziG-uG0ati.HFUM9e93wGql3kr7r05Low.BO3a3dM60drhp77AmLAzQoFp21c"],
  ];

  for (const [project, secret, sealed] of VECTORS) {
    test(`${project} kopyasının mühürlediği kutu açılır`, () => {
      expect(createSecretBox(secret).unseal(sealed).equals(TOTP_SECRET)).toBe(true);
    });
  }

  test("yeni mühür eski biçimle aynı yapıda (iv 12, tag 16 bayt, base64url)", () => {
    const parts = box.seal(TOTP_SECRET).split(".");
    expect(parts).toHaveLength(4);
    const [version, iv, tag, body] = parts as [string, string, string, string];
    expect(version).toBe("v1");
    for (const part of [iv, tag, body]) expect(part).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(iv, "base64url")).toHaveLength(12);
    expect(Buffer.from(tag, "base64url")).toHaveLength(16);
    expect(Buffer.from(body, "base64url")).toHaveLength(TOTP_SECRET.length);
  });

  test("kurtarma kodu özeti kaynakla aynı (veritabanındaki özetler eşleşir)", () => {
    expect(hashRecoveryCode("ABCDE-FGHJK")).toBe("f57cbf1e3e471b25db4b8ad0844df41b2dae9c7d1944944d128e49294d412f66");
  });
});
