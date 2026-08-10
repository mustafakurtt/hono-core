import { describe, expect, test } from "bun:test";
import { createJwt, generatePassword, hashPassword, verifyPassword } from "../src/auth";

describe("createJwt", () => {
  const jwt = createJwt<{ sub: string; org: string }>({
    secret: "test-secret-en-az-32-karakter-olsun-diye",
    expiresInSeconds: 60,
  });

  test("sign → verify turu payload'ı korur", async () => {
    const token = await jwt.sign({ sub: "u1", org: "o1" });
    const payload = await jwt.verify(token);

    expect(payload).toMatchObject({ sub: "u1", org: "o1" });
  });

  test("verify exp claim'i ekler", async () => {
    const payload = await jwt.verify(await jwt.sign({ sub: "u1", org: "o1" }));
    expect(typeof (payload as { exp?: number }).exp).toBe("number");
  });

  test("kurcalanmış token doğrulanmaz", async () => {
    const token = await jwt.sign({ sub: "u1", org: "o1" });
    const bozuk = token.slice(0, -3) + "aaa";

    expect(await jwt.verify(bozuk)).toBeNull();
  });

  test("başka secret ile imzalanan token doğrulanmaz", async () => {
    const digerJwt = createJwt<{ sub: string; org: string }>({
      secret: "tamamen-baska-bir-secret-degeri-32-karakter",
      expiresInSeconds: 60,
    });
    const token = await digerJwt.sign({ sub: "u1", org: "o1" });

    expect(await jwt.verify(token)).toBeNull();
  });

  test("süresi dolmuş token doğrulanmaz", async () => {
    const kisaJwt = createJwt<{ sub: string }>({
      secret: "test-secret-en-az-32-karakter-olsun-diye",
      expiresInSeconds: -10, // zaten geçmişte
    });

    expect(await kisaJwt.verify(await kisaJwt.sign({ sub: "u1" }))).toBeNull();
  });

  test("çöp girdi doğrulanmaz (fırlatmaz, null döner)", async () => {
    expect(await jwt.verify("bu.bir.jwt.degil")).toBeNull();
    expect(await jwt.verify("")).toBeNull();
  });
});

describe("password", () => {
  test("hash → verify turu", async () => {
    const hash = await hashPassword("Sifre1234!");

    expect(hash).not.toBe("Sifre1234!");
    expect(await verifyPassword("Sifre1234!", hash)).toBe(true);
    expect(await verifyPassword("YanlisSifre", hash)).toBe(false);
  });

  test("aynı şifre farklı hash üretir (salt)", async () => {
    const [a, b] = await Promise.all([hashPassword("aynisifre"), hashPassword("aynisifre")]);
    expect(a).not.toBe(b);
  });

  test("generatePassword: istenen uzunlukta ve her seferinde farklı", () => {
    const a = generatePassword(16);
    const b = generatePassword(16);

    expect(a).toHaveLength(16);
    expect(a).not.toBe(b);
  });

  test("üretilen geçici şifre hash'lenip doğrulanabiliyor", async () => {
    const gecici = generatePassword();
    expect(await verifyPassword(gecici, await hashPassword(gecici))).toBe(true);
  });

  test("her karakter sınıfından en az biri GARANTİ", () => {
    // Eskiden tek alfabede ofsetle indekslendiği için "büyük harf" yuvası
    // bazen küçük harf, "küçük harf" yuvası bazen rakam üretiyordu (~20.000'de
    // 1). Nadir olduğu için elle fark edilmezdi; bu döngü invaryantı kilitler.
    for (let i = 0; i < 2_000; i++) {
      const password = generatePassword(12);
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[0-9]/);
      expect(password).toMatch(/[!@#$%&*?]/);
    }
  });

  test("karıştırılabilir karakterler (I O l 0 1) kullanılmaz", () => {
    // Geçici şifre çoğu zaman elle okunup yazılır.
    for (let i = 0; i < 500; i++) {
      expect(generatePassword(20)).not.toMatch(/[IOl01]/);
    }
  });

  test("istenen uzunluk asgarinin altındaysa asgariye yükseltilir", () => {
    // 4 karakter garantili önek + gövde; daha kısası sınıf garantisini bozardı.
    expect(generatePassword(2).length).toBeGreaterThanOrEqual(8);
  });
});
