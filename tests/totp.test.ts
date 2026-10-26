import { describe, expect, test } from "bun:test";
import { base32, hotp, matchStep, otpauthUri, stepAt } from "../src/auth";

/**
 * v0.5.0'da rfcear/laputa `packages/core/src/auth/totp.ts`'ten taşındı. "totp" describe'ı
 * kaynaktaki testin birebir kopyasıdır; ayarlanabilir seçenekler sonradan eklendi ve
 * varsayılanları kaynaktaki sabitlerle aynıdır.
 */

// RFC 6238 Ek B (SHA-1): 8 haneli değerlerin son 6 hanesi.
const RFC_SECRET = Buffer.from("12345678901234567890");
const VECTORS: [number, string][] = [
  [59, "287082"],
  [1111111109, "081804"],
  [1234567890, "005924"],
  [2000000000, "279037"],
  [20000000000, "353130"],
];

describe("totp", () => {
  test("RFC 6238 test vektörleri", () => {
    for (const [seconds, code] of VECTORS) expect(hotp(RFC_SECRET, stepAt(seconds * 1000))).toBe(code);
  });

  test("base32 (RFC 4648)", () => {
    expect(base32(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
    expect(base32(RFC_SECRET)).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  });

  test("±1 adım kabul, fazlası ve kullanılmış adım ret", () => {
    const now = 1_700_000_000_000;
    const step = stepAt(now);
    expect(matchStep(RFC_SECRET, hotp(RFC_SECRET, step - 1), null, now)).toBe(step - 1);
    expect(matchStep(RFC_SECRET, hotp(RFC_SECRET, step + 1), null, now)).toBe(step + 1);
    expect(matchStep(RFC_SECRET, hotp(RFC_SECRET, step - 2), null, now)).toBeNull();
    expect(matchStep(RFC_SECRET, hotp(RFC_SECRET, step), step, now)).toBeNull();
    expect(matchStep(RFC_SECRET, "12345", null, now)).toBeNull();
  });
});

describe("totp seçenekleri", () => {
  const now = 1_700_000_000_000;

  test("otpauth adresi kaynakla aynı (varsayılanlar)", () => {
    // Kaynak `otpauthUri`'nin bu girdiyle ürettiği değer.
    expect(otpauthUri("Örnek Panel", "a@b.co", RFC_SECRET)).toBe(
      "otpauth://totp/%C3%96rnek%20Panel%3Aa%40b.co?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ" +
        "&issuer=%C3%96rnek%20Panel&algorithm=SHA1&digits=6&period=30"
    );
  });

  test("8 hane: RFC 6238 Ek B'nin tam değerleri", () => {
    const full: [number, string][] = [
      [59, "94287082"],
      [1111111109, "07081804"],
      [1234567890, "89005924"],
    ];
    for (const [seconds, code] of full) expect(hotp(RFC_SECRET, stepAt(seconds * 1000), { digits: 8 })).toBe(code);
    const step = stepAt(now);
    expect(matchStep(RFC_SECRET, hotp(RFC_SECRET, step, { digits: 8 }), null, now, { digits: 8 })).toBe(step);
    expect(matchStep(RFC_SECRET, hotp(RFC_SECRET, step), null, now, { digits: 8 })).toBeNull();
  });

  test("adım süresi ve pencere ayarlanabilir", () => {
    const options = { stepSeconds: 60, window: 0 };
    const step = stepAt(now, options);
    expect(step).toBe(Math.floor(now / 60_000));
    expect(matchStep(RFC_SECRET, hotp(RFC_SECRET, step), null, now, options)).toBe(step);
    expect(matchStep(RFC_SECRET, hotp(RFC_SECRET, step + 1), null, now, options)).toBeNull();
    expect(matchStep(RFC_SECRET, hotp(RFC_SECRET, stepAt(now) + 2), null, now, { window: 2 })).toBe(stepAt(now) + 2);
    expect(otpauthUri("X", "y", RFC_SECRET, { stepSeconds: 60, digits: 8 })).toEndWith("&digits=8&period=60");
  });

  test("geçersiz seçenek anlaşılır hata verir", () => {
    expect(() => hotp(RFC_SECRET, 1, { digits: 5 })).toThrow("digits");
    expect(() => hotp(RFC_SECRET, 1, { digits: 9 })).toThrow("digits");
    expect(() => stepAt(now, { stepSeconds: 0 })).toThrow("stepSeconds");
    expect(() => matchStep(RFC_SECRET, "123456", null, now, { window: -1 })).toThrow("window");
  });
});
