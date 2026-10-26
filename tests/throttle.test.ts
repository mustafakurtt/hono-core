import { describe, expect, test } from "bun:test";
import { createThrottle } from "../src/ratelimit";

/**
 * v0.5.0'da rfcear/laputa `packages/core/src/ratelimit/throttle.ts`'ten taşındı. İlk üç test
 * kaynaktakinin birebir kopyasıdır.
 */
describe("createThrottle", () => {
  test("pencere içinde en fazla max kez izin verir, pencere dolunca sıfırlanır", () => {
    const allow = createThrottle({ windowMs: 1000, max: 2 });
    expect([allow("a", 0), allow("a", 10), allow("a", 20)]).toEqual([true, true, false]);
    expect(allow("b", 20)).toBe(true);
    expect(allow("a", 1000)).toBe(true);
  });

  test("blocked saymadan bakar", () => {
    const fail = createThrottle({ windowMs: 1000, max: 2 });
    expect(fail.blocked("a", 0)).toBe(false);
    fail("a", 0);
    fail("a", 10);
    expect([fail.blocked("a", 20), fail.blocked("a", 20), fail.blocked("a", 1000)]).toEqual([true, true, false]);
  });

  test("anahtar sayısı sınırlı kalır", () => {
    const allow = createThrottle({ windowMs: 60_000, max: 1, maxKeys: 3 });
    for (let i = 0; i < 100; i++) allow(`k${i}`, i);
    expect(allow("k99", 200)).toBe(false);
    expect(allow("yeni", 200)).toBe(true);
  });

  test("pencere ilk sayımda açılır, sonraki sayımlar uzatmaz (sabit pencere)", () => {
    const allow = createThrottle({ windowMs: 1000, max: 1 });
    allow("a", 0);
    expect(allow("a", 900)).toBe(false);
    expect(allow("a", 1000)).toBe(true);
  });

  test("geçersiz ayar anlaşılır hata verir (maxKeys: 0 sonsuz döngüye girerdi)", () => {
    expect(() => createThrottle({ windowMs: 1000, max: 1, maxKeys: 0 })).toThrow("maxKeys");
    expect(() => createThrottle({ windowMs: 1000, max: 0 })).toThrow("max");
    expect(() => createThrottle({ windowMs: 0, max: 1 })).toThrow("windowMs");
  });
});
