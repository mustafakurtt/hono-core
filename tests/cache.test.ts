import { describe, expect, test } from "bun:test";
import { Cache, InMemoryCacheStore, NullCacheStore, type CacheStore } from "../src/cache";

const newCache = (store: CacheStore = new InMemoryCacheStore()) => new Cache({ store });

describe("Cache facade", () => {
  test("getOrSet: ilk çağrı loader'ı koşar, ikincisi cache'ten döner", async () => {
    const cache = newCache();
    let calls = 0;
    const load = async () => {
      calls++;
      return { id: "u1", name: "Ada" };
    };

    expect(await cache.getOrSet("user", load)).toEqual({ id: "u1", name: "Ada" });
    expect(await cache.getOrSet("user", load)).toEqual({ id: "u1", name: "Ada" });
    expect(calls).toBe(1);
  });

  test("single-flight: eşzamanlı miss'lerde loader YALNIZCA bir kez koşar", async () => {
    const cache = newCache();
    let calls = 0;
    const load = async () => {
      calls++;
      await Bun.sleep(10);
      return calls;
    };

    const results = await Promise.all([
      cache.getOrSet("k", load),
      cache.getOrSet("k", load),
      cache.getOrSet("k", load),
    ]);

    expect(calls).toBe(1);
    expect(results).toEqual([1, 1, 1]);
  });

  test("delete sonrası taze hesaplanır", async () => {
    const cache = newCache();
    await cache.set("k", "eski");
    await cache.delete("k");
    expect(await cache.get("k")).toBeNull();
  });

  test("null/undefined CACHE'LENMEZ (negatif cache yok)", async () => {
    const cache = newCache();
    let calls = 0;
    const load = async () => {
      calls++;
      return null;
    };

    await cache.getOrSet("yok", load);
    await cache.getOrSet("yok", load);
    expect(calls).toBe(2);
  });

  test("namespace: anahtar uzayları izole", async () => {
    const cache = newCache();
    const a = cache.namespace("a");
    const b = cache.namespace("b");

    await a.set("k", "A");
    await b.set("k", "B");

    expect(await a.get<string>("k")).toBe("A");
    expect(await b.get<string>("k")).toBe("B");
    // Zincirlenebilir olmalı.
    expect(await cache.namespace("a").get<string>("k")).toBe("A");
  });

  test("bozuk değer decode edilemezse MISS'e düşer ve anahtar temizlenir", async () => {
    const store = new InMemoryCacheStore();
    await store.set("k", "{bu gecerli json degil");
    const cache = new Cache({ store });

    expect(await cache.get("k")).toBeNull();
    // Bozuk anahtar best-effort silinir ki tekrar hesaplansın.
    await Bun.sleep(1);
    expect(await store.get("k")).toBeNull();
  });

  test("fail-open: store okuma hatası isteği düşürmez, miss'e düşer", async () => {
    const patlayan: CacheStore = {
      get: async () => {
        throw new Error("redis down");
      },
      set: async () => {},
      delete: async () => {},
    };

    const cache = new Cache({ store: patlayan });
    expect(await cache.getOrSet("k", async () => "kaynaktan")).toBe("kaynaktan");
  });

  test("fail-open: getOrSet iç yazım hatası yutulur, değer yine döner", async () => {
    const patlayan: CacheStore = {
      get: async () => null,
      set: async () => {
        throw new Error("redis down");
      },
      delete: async () => {},
    };

    const cache = new Cache({ store: patlayan });
    expect(await cache.getOrSet("k", async () => "kaynaktan")).toBe("kaynaktan");
  });

  test("delete hatası YUTULMAZ — kaçırılan invalidasyon doğruluk hatasıdır", async () => {
    const patlayan: CacheStore = {
      get: async () => null,
      set: async () => {},
      delete: async () => {
        throw new Error("redis down");
      },
    };

    expect(new Cache({ store: patlayan }).delete("k")).rejects.toThrow("redis down");
  });

  test("NullCacheStore: her okuma miss, loader her seferinde koşar", async () => {
    const cache = newCache(new NullCacheStore());
    let calls = 0;
    await cache.getOrSet("k", async () => ++calls);
    await cache.getOrSet("k", async () => ++calls);
    expect(calls).toBe(2);
  });
});

describe("InMemoryCacheStore", () => {
  test("TTL dolunca değer düşer", async () => {
    const store = new InMemoryCacheStore();
    await store.set("k", "v", 1);
    expect(await store.get("k")).toBe("v");

    await Bun.sleep(1100);
    expect(await store.get("k")).toBeNull();
  });

  test("maxEntries aşılınca en eskisi tahliye edilir", async () => {
    const store = new InMemoryCacheStore({ maxEntries: 2 });
    await store.set("a", "1");
    await store.set("b", "2");
    await store.set("c", "3");

    expect(await store.get("a")).toBeNull();
    expect(await store.get("c")).toBe("3");
  });
});
