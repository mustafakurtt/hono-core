import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { InMemoryRateLimitStore, createRateLimiter, type RateLimitStore } from "../src/ratelimit";
import { createErrorHandler } from "../src/http";
import { createLogger, LogLevel } from "../src/logger";

const silentLogger = createLogger({ level: LogLevel.Silent });

const buildApp = (limiter: ReturnType<typeof createRateLimiter>) => {
  const app = new Hono();
  app.onError(
    createErrorHandler({
      logger: silentLogger,
      fallbackMessage: "server.unexpected",
      getRequestId: () => "req-1",
    })
  );
  app.post("/login", limiter, (c) => c.json({ ok: true }));
  return app;
};

/** Anahtar gövdedeki e-postadan gelir — IP'den DEĞİL (NAT arkasındaki kampüs kilitlenmesin). */
const emailKey = async (c: { req: { json: () => Promise<unknown> } }) => {
  const body = (await c.req.json().catch(() => null)) as { email?: string } | null;
  return body?.email ?? null;
};

const post = (email?: string) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(email ? { email } : {}),
});

describe("createRateLimiter", () => {
  test("limite kadar geçirir, aşınca 429", async () => {
    const app = buildApp(
      createRateLimiter({
        store: new InMemoryRateLimitStore(),
        keyPrefix: "login",
        limit: 2,
        windowSeconds: 60,
        keyFn: emailKey,
      })
    );

    expect((await app.request("/login", post("a@x.com"))).status).toBe(200);
    expect((await app.request("/login", post("a@x.com"))).status).toBe(200);

    const res = await app.request("/login", post("a@x.com"));
    expect(res.status).toBe(429);
    const body = (await res.json()) as { code: string; message: string };
    expect(body.code).toBe("RATE_LIMITED");
    expect(body.message).toBe("rateLimit.exceeded");
  });

  test("sayaçlar anahtar başına AYRI — bir kullanıcı diğerini kilitlemez", async () => {
    const app = buildApp(
      createRateLimiter({
        store: new InMemoryRateLimitStore(),
        keyPrefix: "login",
        limit: 1,
        windowSeconds: 60,
        keyFn: emailKey,
      })
    );

    expect((await app.request("/login", post("a@x.com"))).status).toBe(200);
    expect((await app.request("/login", post("a@x.com"))).status).toBe(429);
    // Farklı e-posta etkilenmemeli.
    expect((await app.request("/login", post("b@x.com"))).status).toBe(200);
  });

  test("RateLimit-* bilgi başlıkları set edilir", async () => {
    const app = buildApp(
      createRateLimiter({
        store: new InMemoryRateLimitStore(),
        keyPrefix: "login",
        limit: 5,
        windowSeconds: 60,
        keyFn: emailKey,
      })
    );

    const res = await app.request("/login", post("a@x.com"));
    expect(res.headers.get("RateLimit-Limit")).toBe("5");
    expect(res.headers.get("RateLimit-Remaining")).toBe("4");
    expect(Number(res.headers.get("RateLimit-Reset"))).toBeGreaterThan(0);
  });

  test("keyFn null dönerse limit UYGULANMAZ", async () => {
    const app = buildApp(
      createRateLimiter({
        store: new InMemoryRateLimitStore(),
        keyPrefix: "login",
        limit: 1,
        windowSeconds: 60,
        keyFn: emailKey,
      })
    );

    // Gövdede e-posta yok → anahtar yok → zaten doğrulama reddedecek.
    for (let i = 0; i < 5; i++) {
      expect((await app.request("/login", post())).status).toBe(200);
    }
  });

  test("disabled: true iken hiç sınırlamaz", async () => {
    const app = buildApp(
      createRateLimiter({
        store: new InMemoryRateLimitStore(),
        keyPrefix: "login",
        limit: 1,
        windowSeconds: 60,
        keyFn: emailKey,
        disabled: true,
      })
    );

    expect((await app.request("/login", post("a@x.com"))).status).toBe(200);
    expect((await app.request("/login", post("a@x.com"))).status).toBe(200);
  });

  test("disabled fonksiyon olarak ÇAĞRI ANINDA okunur", async () => {
    let kapali = true;
    const app = buildApp(
      createRateLimiter({
        store: new InMemoryRateLimitStore(),
        keyPrefix: "login",
        limit: 1,
        windowSeconds: 60,
        keyFn: emailKey,
        disabled: () => kapali,
      })
    );

    expect((await app.request("/login", post("a@x.com"))).status).toBe(200);
    expect((await app.request("/login", post("a@x.com"))).status).toBe(200);

    kapali = false;
    // Kapalıyken store'a HİÇ dokunulmaz (sayaç işlemez) — açıldığında sayaç sıfırdan
    // başlar. Bu yüzden ilk istek geçer, limiti ikinci istek aşar.
    expect((await app.request("/login", post("a@x.com"))).status).toBe(200);
    expect((await app.request("/login", post("a@x.com"))).status).toBe(429);
  });

  test("FAIL-OPEN: store hatası isteği DÜŞÜRMEZ", async () => {
    const patlayan: RateLimitStore = {
      hit: async () => {
        throw new Error("redis down");
      },
    };

    const app = buildApp(
      createRateLimiter({
        store: patlayan,
        keyPrefix: "login",
        limit: 1,
        windowSeconds: 60,
        keyFn: emailKey,
        logger: silentLogger,
      })
    );

    // Redis düştüğünde tüm API'yi kilitlemek, limitin aşılmasından çok daha kötüdür.
    expect((await app.request("/login", post("a@x.com"))).status).toBe(200);
    expect((await app.request("/login", post("a@x.com"))).status).toBe(200);
  });
});

describe("InMemoryRateLimitStore", () => {
  test("sayaç artar ve ttl döner", async () => {
    const store = new InMemoryRateLimitStore();

    expect(await store.hit("k", 60)).toMatchObject({ count: 1 });
    expect(await store.hit("k", 60)).toMatchObject({ count: 2 });
    expect((await store.hit("k", 60)).ttlSeconds).toBeGreaterThan(0);
  });

  test("SABİT pencere: sonraki istekler ömrü TAZELEMEZ", async () => {
    const store = new InMemoryRateLimitStore();
    const ilk = await store.hit("k", 2);
    await Bun.sleep(1100);
    const sonra = await store.hit("k", 2);

    // Kayan pencere olsaydı ttl tazelenir, pencere hiç kapanmazdı.
    expect(sonra.ttlSeconds).toBeLessThanOrEqual(ilk.ttlSeconds);
    expect(sonra.count).toBe(2);
  });

  test("pencere dolunca sayaç sıfırlanır", async () => {
    const store = new InMemoryRateLimitStore();
    await store.hit("k", 1);
    await Bun.sleep(1100);

    expect((await store.hit("k", 1)).count).toBe(1);
  });

  test("anahtarlar birbirinden bağımsız", async () => {
    const store = new InMemoryRateLimitStore();
    await store.hit("a", 60);
    await store.hit("a", 60);

    expect((await store.hit("b", 60)).count).toBe(1);
  });
});
