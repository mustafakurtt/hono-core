import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  BadRequestError,
  ConflictError,
  HttpError,
  NotFoundError,
  TooManyRequestsError,
  ValidationError,
  createErrorHandler,
  createResponder,
  isHttpError,
} from "../src/http";
import { createLogger, LogLevel } from "../src/logger";
import { createTranslator } from "../src/i18n";

/** Testlerde log gürültüsü olmasın; beklenen 500'ler de loglanıyor. */
const silentLogger = createLogger({ level: LogLevel.Silent });

const catalog = {
  tr: { "x.notFound": "Bulunamadı.", "server.unexpected": "Beklenmeyen bir hata oluştu." },
  en: { "x.notFound": "Not found.", "server.unexpected": "Unexpected error." },
};

describe("HttpError sözleşmesi", () => {
  test("alt sınıflar doğru status taşır", () => {
    expect(new BadRequestError("m").status).toBe(400);
    expect(new NotFoundError("m").status).toBe(404);
    expect(new ConflictError("m").status).toBe(409);
  });

  test("name alt sınıf adını alır (new.target)", () => {
    expect(new NotFoundError("m").name).toBe("NotFoundError");
  });

  test("varsayılan code'lar", () => {
    expect(new TooManyRequestsError("m").code).toBe("RATE_LIMITED");
    expect(new ValidationError("m").code).toBe("VALIDATION_ERROR");
    expect(new NotFoundError("m").code).toBeUndefined();
  });

  test("expose varsayılanı true, kapatılabilir", () => {
    expect(new BadRequestError("m").expose).toBe(true);
    expect(new BadRequestError("m", { expose: false }).expose).toBe(false);
  });

  test("isHttpError yalnızca HttpError'ları tanır", () => {
    expect(isHttpError(new NotFoundError("m"))).toBe(true);
    expect(isHttpError(new Error("m"))).toBe(false);
    expect(isHttpError(new TypeError("m"))).toBe(false);
  });
});

describe("createErrorHandler", () => {
  const buildApp = (opts?: Partial<Parameters<typeof createErrorHandler>[0]>) => {
    const app = new Hono();
    app.onError(
      createErrorHandler({
        logger: silentLogger,
        fallbackMessage: "server.unexpected",
        getRequestId: () => "req-1",
        ...opts,
      })
    );
    return app;
  };

  test("HttpError kendi status'u + code'uyla döner", async () => {
    const app = buildApp();
    app.get("/", () => {
      throw new NotFoundError("x.notFound", { code: "X_NOT_FOUND" });
    });

    const res = await app.request("/");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      success: false,
      message: "x.notFound",
      code: "X_NOT_FOUND",
      requestId: "req-1",
    });
  });

  test("details cevaba olduğu gibi eklenir", async () => {
    const app = buildApp();
    app.get("/", () => {
      throw new ValidationError("validation.failed", {
        details: [{ path: "email", code: "invalid_format" }],
      });
    });

    const body = (await (await app.request("/")).json()) as { details: unknown };
    expect(body.details).toEqual([{ path: "email", code: "invalid_format" }]);
  });

  test("ALTYAPI hatası jenerik 500'e düşer — mesaj SIZMAZ", async () => {
    const app = buildApp();
    app.get("/", () => {
      throw new TypeError('relation "users" does not exist');
    });

    const res = await app.request("/");
    expect(res.status).toBe(500);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe("server.unexpected");
    expect(body.message).not.toContain("users");
  });

  test("expose:false olan HttpError de 500'e düşer", async () => {
    const app = buildApp();
    app.get("/", () => {
      throw new HttpError(400, "iç detay", { expose: false });
    });

    const res = await app.request("/");
    expect(res.status).toBe(500);
    expect((await res.json() as { message: string }).message).toBe("server.unexpected");
  });

  test("GERİ UYUM: enjekte edilen classifier ile düz Error 400 olur", async () => {
    const app = buildApp({
      isBusinessError: (e): e is Error => e instanceof Error && e.constructor === Error,
    });
    app.get("/plain", () => {
      throw new Error("İş kuralı ihlali.");
    });
    app.get("/typeerror", () => {
      throw new TypeError("altyapı");
    });

    const plain = await app.request("/plain");
    expect(plain.status).toBe(400);
    expect((await plain.json() as { message: string }).message).toBe("İş kuralı ihlali.");

    // TypeError bir Error ALT SINIFI — classifier onu iş hatası saymamalı.
    expect((await app.request("/typeerror")).status).toBe(500);
  });

  test("classifier verilmezse düz Error 500'dür", async () => {
    const app = buildApp();
    app.get("/", () => {
      throw new Error("düz");
    });
    expect((await app.request("/")).status).toBe(500);
  });

  test("Hono HTTPException kendi status'uyla geçer", async () => {
    const app = buildApp();
    app.get("/", () => {
      throw new HTTPException(418, { message: "çaydanlık" });
    });

    const res = await app.request("/");
    expect(res.status).toBe(418);
  });

  test("translate verilirse mesaj isteğin diline çevrilir", async () => {
    const app = buildApp({
      translate: createTranslator(catalog, "tr"),
      getLocale: (c) => c.req.header("X-Locale") ?? "tr",
    });
    app.get("/", () => {
      throw new NotFoundError("x.notFound");
    });

    const tr = await app.request("/");
    expect((await tr.json() as { message: string }).message).toBe("Bulunamadı.");

    const en = await app.request("/", { headers: { "X-Locale": "en" } });
    expect((await en.json() as { message: string }).message).toBe("Not found.");
  });

  test("çeviri params ile interpolasyon yapar", async () => {
    const app = buildApp({
      translate: createTranslator({ tr: { "x.dup": "{domain} zaten kayıtlı." } }, "tr"),
      getLocale: () => "tr",
    });
    app.get("/", () => {
      throw new ConflictError("x.dup", { params: { domain: "itu.edu.tr" } });
    });

    expect((await (await app.request("/")).json() as { message: string }).message).toBe(
      "itu.edu.tr zaten kayıtlı."
    );
  });

  test("çevrilmemiş düz metin aynen döner (geri uyum dikişi)", async () => {
    const app = buildApp({ translate: createTranslator(catalog, "tr"), getLocale: () => "en" });
    app.get("/", () => {
      throw new BadRequestError("Katalogda olmayan düz mesaj.");
    });

    expect((await (await app.request("/")).json() as { message: string }).message).toBe(
      "Katalogda olmayan düz mesaj."
    );
  });
});

describe("createResponder", () => {
  test("ok/created/done zarfı ve status'ları", async () => {
    const { ok, created, done } = createResponder();
    const app = new Hono();
    app.get("/ok", (c) => ok(c, { id: 1 }, "x.listed"));
    app.get("/created", (c) => created(c, { id: 1 }, "x.created"));
    app.get("/done", (c) => done(c, "x.deleted"));

    const okRes = await app.request("/ok");
    expect(okRes.status).toBe(200);
    expect(await okRes.json()).toEqual({ success: true, message: "x.listed", data: { id: 1 } });

    const createdRes = await app.request("/created");
    expect(createdRes.status).toBe(201);

    const doneRes = await app.request("/done");
    // Kasıtlı 200 + mesaj (204 değil): zarf başarı mesajını taşımalı.
    expect(doneRes.status).toBe(200);
    expect(await doneRes.json()).toEqual({ success: true, message: "x.deleted" });
  });

  test("translate verilirse başarı mesajı da çevrilir", async () => {
    const { ok } = createResponder({
      translate: createTranslator({ tr: { "x.ok": "Tamam." }, en: { "x.ok": "OK." } }, "tr"),
      getLocale: (c) => c.req.header("X-Locale") ?? "tr",
    });
    const app = new Hono();
    app.get("/", (c) => ok(c, null, "x.ok"));

    expect((await (await app.request("/")).json() as { message: string }).message).toBe("Tamam.");
    const en = await app.request("/", { headers: { "X-Locale": "en" } });
    expect((await en.json() as { message: string }).message).toBe("OK.");
  });
});
