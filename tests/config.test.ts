import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { createEnv, envBoolean } from "../src/config";

describe("createEnv", () => {
  const schema = z.object({ PORT: z.string(), DEBUG: envBoolean(false) });

  test("geçerli kaynağı doğrulayıp döndürür", () => {
    const env = createEnv(schema, { source: { PORT: "3000", DEBUG: "true" } });
    expect(env).toEqual({ PORT: "3000", DEBUG: true });
  });

  test("geçersizse eksik alanları TEK TEK listeleyen hata fırlatır", () => {
    // Ham `schema.parse()` çıktısı okunmaz; başlangıç hatası okunur olmalı.
    expect(() => createEnv(schema, { source: {} })).toThrow(/PORT/);
  });

  test("başlık enjekte edilebilir (dil projede)", () => {
    expect(() => createEnv(schema, { source: {}, intro: "Ortam değişkenleri hatalı:" })).toThrow(
      /Ortam değişkenleri hatalı:/
    );
  });
});

describe("envBoolean", () => {
  const parse = (raw: string | undefined, fallback = false) =>
    z.object({ FLAG: envBoolean(fallback) }).parse(raw === undefined ? {} : { FLAG: raw }).FLAG;

  test('"false" TRUE olmaz — z.coerce.boolean() tuzağı', () => {
    // Boolean("false") === true olduğu için bu yardımcı var; regresyon kilidi.
    expect(parse("false")).toBe(false);
    expect(parse("0")).toBe(false);
    expect(parse("off")).toBe(false);
  });

  test("bilinen doğruluk değerlerini kabul eder", () => {
    for (const raw of ["1", "true", "yes", "on", "TRUE", " True "]) {
      expect(parse(raw)).toBe(true);
    }
  });

  test("tanımsız veya boş değer varsayılana düşer", () => {
    expect(parse(undefined, true)).toBe(true);
    expect(parse("", true)).toBe(true);
    expect(parse("   ", false)).toBe(false);
  });

  test("tanınmayan değer varsayılan DEĞİL, false olur", () => {
    // Yalnızca bilinen doğruluk değerleri true sayılır; gerisi kapalıdır.
    expect(parse("belki", true)).toBe(false);
  });
});
