import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createClientIp, ipKey, parseForwardedFor } from "../src/http";
import { emailKey } from "../src/ratelimit";
import { paginate } from "../src/db/pagination";
import { diffChanges } from "../src/rbac";

/**
 * v0.5.0'da tüketicilerden (rfcear/laputa `packages/core`) core'a taşınan saf
 * yardımcılar. Testlerin çoğu kaynak projeden birebir alındı: davranış taşıma
 * sırasında değişmemeli.
 */

describe("ipKey", () => {
  test("IPv4 olduğu gibi kalır, IPv4'e eşlenmiş IPv6 IPv4 olur", () => {
    expect(ipKey("203.0.113.7")).toBe("203.0.113.7");
    expect(ipKey("::ffff:203.0.113.7")).toBe("203.0.113.7");
  });

  test("aynı /64 bloktaki adresler tek anahtar", () => {
    const key = "2a01:4f8:c17:1a2b::/64";
    expect(ipKey("2a01:4f8:c17:1a2b::1")).toBe(key);
    expect(ipKey("2a01:04f8:0c17:1a2b:dead:beef:0:1")).toBe(key);
    expect(ipKey("2A01:4F8:C17:1A2B:FFFF:FFFF:FFFF:FFFF")).toBe(key);
    expect(ipKey("2a01:4f8:c17:1a2b::1%eth0")).toBe(key);
    expect(ipKey("2a01:4f8:c17:1a2c::1")).not.toBe(key);
  });

  test("kısaltma önekte olsa da doğru açılır", () => {
    expect(ipKey("2001:db8::")).toBe("2001:db8:0:0::/64");
    expect(ipKey("::1")).toBe("0:0:0:0::/64");
    expect(ipKey("fe80::1:2:3:4")).toBe("fe80:0:0:0::/64");
  });

  // fenixAVM'nin kendi `rateLimitSubject`'inden alınan vektörler (İ-81, K-160).
  test("köşeli parantez ve port soyulur", () => {
    expect(ipKey("[2001:db8:1:2::1]:443")).toBe("2001:db8:1:2::/64");
    expect(ipKey("[2001:db8:1:2::1]")).toBe("2001:db8:1:2::/64");
    expect(ipKey("203.0.113.5:5678")).toBe("203.0.113.5");
  });

  test("çözülemeyen biçim olduğu gibi kalır (bozuk adresler tek kovada birleşmez)", () => {
    expect(ipKey("1::2::3")).toBe("1::2::3");
    expect(ipKey("2001:db8::zzzz")).toBe("2001:db8::zzzz");
  });
});

describe("parseForwardedFor", () => {
  test("en sağdaki değer alınır, port kırpılır, çıplak IPv6'ya dokunulmaz", () => {
    expect(parseForwardedFor("6.6.6.6, 203.0.113.7", 1)).toBe("203.0.113.7");
    expect(parseForwardedFor("6.6.6.6, 203.0.113.7:51234", 1)).toBe("203.0.113.7");
    expect(parseForwardedFor("[2001:db8::1]:443", 1)).toBe("2001:db8::1");
    expect(parseForwardedFor("2001:db8::1", 1)).toBe("2001:db8::1");
    expect(parseForwardedFor("::ffff:203.0.113.7", 1)).toBe("::ffff:203.0.113.7");
  });

  test("boş başlık ya da güvenilir proxy yoksa sonuç yok", () => {
    for (const value of [undefined, null, "", " , "]) expect(parseForwardedFor(value, 1)).toBeUndefined();
    expect(parseForwardedFor("203.0.113.7", 0)).toBeUndefined();
  });
});

describe("createClientIp", () => {
  /** Verilen başlıklarla isteği atıp çözülen IP'yi döndürür. */
  const resolve = async (
    options: Parameters<typeof createClientIp>[0],
    headers: Record<string, string> = {}
  ) => {
    const clientIp = createClientIp({ remoteAddress: () => "10.0.0.9", ...options });
    const app = new Hono().get("/", (c) => c.json({ ip: clientIp.ip(c), key: clientIp.key(c) }));
    return (await app.request("/", { headers })).json() as Promise<{ ip: string; key: string }>;
  };

  test("trustedProxies: 0 → başlık yok sayılır (sahtelenemez)", async () => {
    const result = await resolve({ trustedProxies: 0 }, { "x-forwarded-for": "1.2.3.4" });
    expect(result.ip).toBe("10.0.0.9");
  });

  test("baştan yazan kenar proxy: tek değer okunur (rfcear/Caddy kurulumu)", async () => {
    const result = await resolve({ trustedProxies: 1 }, { "x-forwarded-for": "203.0.113.7" });
    expect(result.ip).toBe("203.0.113.7");
  });

  test("ekleyen proxy'ler: değer sağdan seçilir, ziyaretçinin soldaki uydurması atlanır", async () => {
    const headers = { "x-forwarded-for": "6.6.6.6, 203.0.113.7, 10.0.0.2" };
    expect((await resolve({ trustedProxies: 2 }, headers)).ip).toBe("203.0.113.7");
    expect((await resolve({ trustedProxies: 1 }, headers)).ip).toBe("10.0.0.2");
  });

  test("başlık yoksa bağlantı adresi, o da yoksa unknown", async () => {
    expect((await resolve({ trustedProxies: 1 })).ip).toBe("10.0.0.9");
    expect((await resolve({ trustedProxies: 1, remoteAddress: () => undefined })).ip).toBe("unknown");
  });

  test("resolve adres uydurmaz: bulunamazsa null", async () => {
    const clientIp = createClientIp({ trustedProxies: 1, remoteAddress: () => undefined });
    const app = new Hono().get("/", (c) => c.json({ ip: clientIp.resolve(c) }));
    expect(await (await app.request("/")).json()).toEqual({ ip: null });
  });

  test("varsayılan bağlantı adresi Bun sunucusu dışında çökmez", async () => {
    const clientIp = createClientIp({ trustedProxies: 0 });
    const app = new Hono().get("/", (c) => c.text(clientIp.ip(c)));
    expect(await (await app.request("/")).text()).toBe("unknown");
  });

  test("özel başlık ve IPv6 anahtarı", async () => {
    const result = await resolve(
      { trustedProxies: 1, header: "cf-connecting-ip" },
      { "cf-connecting-ip": "2a01:4f8:c17:1a2b::1" }
    );
    expect(result.key).toBe("2a01:4f8:c17:1a2b::/64");
  });

  test("geçersiz trustedProxies kurulumda reddedilir", () => {
    expect(() => createClientIp({ trustedProxies: -1 })).toThrow();
    expect(() => createClientIp({ trustedProxies: 1.5 })).toThrow();
  });
});

describe("emailKey", () => {
  test("aynı Gmail kutusunun varyantları tek anahtar", () => {
    for (const variant of [
      "kurban@gmail.com",
      "Kurban+1@gmail.com",
      "k.urban@gmail.com",
      "K.U.R.B.A.N+spam@googlemail.com",
      " kurban@GMAIL.com ",
    ]) {
      expect(emailKey(variant)).toBe("kurban@gmail.com");
    }
  });

  test("başka sağlayıcıda nokta anlamlıdır, +etiket atılır", () => {
    expect(emailKey("ali.veli+x@firma.com.tr")).toBe("ali.veli@firma.com.tr");
    expect(emailKey("ali.veli@firma.com.tr")).not.toBe(emailKey("aliveli@firma.com.tr"));
  });

  test("bozuk adres olduğu gibi (küçük harf)", () => {
    expect(emailKey("@yok")).toBe("@yok");
  });
});

describe("paginate", () => {
  test("limit/offset hesaplanır, satırlar eşlenir, toplam açılır", async () => {
    const calls: [number, number][] = [];
    const page = await paginate(3, 10, {
      rows: async (limit, offset) => {
        calls.push([limit, offset]);
        return [{ id: 1 }, { id: 2 }];
      },
      total: async () => [{ total: 22 }],
      map: (row) => `#${row.id}`,
    });
    expect(calls).toEqual([[10, 20]]);
    expect(page).toEqual({ items: ["#1", "#2"], total: 22, page: 3, pageSize: 10 });
  });

  test("toplam satırı yoksa 0", async () => {
    const page = await paginate(1, 5, { rows: async () => [], total: async () => [], map: (row) => row });
    expect(page.total).toBe(0);
  });
});

describe("diffChanges", () => {
  test("yalnızca değişen alanlar, iç içe yol ve dizi sırası", () => {
    const before = { published: true, data: { title: "Eski", seo: { title: "A" }, body: ["bir", "iki"] } };
    const after = { published: false, data: { title: "Yeni", seo: { title: "A" }, body: ["bir"] } };
    expect(diffChanges(before, after)?.items).toEqual([
      { path: "published", before: "true", after: "false" },
      { path: "data.title", before: "Eski", after: "Yeni" },
      { path: "data.body.1", before: "iki", after: null },
    ]);
  });

  test("yeni kayıt ve silme, fark yoksa null", () => {
    expect(diffChanges({}, { name: "Ada" })?.items).toEqual([{ path: "name", before: null, after: "Ada" }]);
    expect(diffChanges({ name: "Ada" }, {})?.items).toEqual([{ path: "name", before: "Ada", after: null }]);
    expect(diffChanges({ a: [1] }, { a: [1] })).toBeNull();
    expect(diffChanges({ tags: ["x"] }, { tags: [] })?.items).toEqual([
      { path: "tags.0", before: "x", after: null },
      { path: "tags", before: null, after: "[]" },
    ]);
  });

  test("uzun değer kırpılır, fazla alan sayılır", () => {
    const long = diffChanges({ t: "a".repeat(400) }, { t: "b" });
    expect(long?.items[0]?.before).toHaveLength(301);
    const many = Object.fromEntries(Array.from({ length: 70 }, (_, i) => [`f${i}`, i]));
    const result = diffChanges({}, many);
    expect([result?.items.length, result?.more]).toEqual([60, 10]);
  });
});
