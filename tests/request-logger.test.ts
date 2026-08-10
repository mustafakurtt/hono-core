import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createRequestLogger, type RequestLogFields } from "../src/http";
import { LogLevel, type EmittableLogLevel, type Logger } from "../src/logger";

type Line = { level: EmittableLogLevel; fields: RequestLogFields & Record<string, unknown>; message: string };

/** Satırları toplayan sahte logger; yalnızca kullanılan seviyeler gerçek. */
function recordingLogger() {
  const lines: Line[] = [];
  const record =
    (level: EmittableLogLevel) =>
    (fields: Line["fields"], message: string) =>
      void lines.push({ level, fields, message });

  const logger = {
    trace: record(LogLevel.Trace),
    debug: record(LogLevel.Debug),
    info: record(LogLevel.Info),
    warn: record(LogLevel.Warn),
    error: record(LogLevel.Error),
    fatal: record(LogLevel.Fatal),
  } as unknown as Logger;

  return { logger, lines };
}

function buildApp(options: Partial<Parameters<typeof createRequestLogger>[0]> = {}) {
  const { logger, lines } = recordingLogger();
  const app = new Hono();
  app.use("*", createRequestLogger({ logger, ...options }));
  app.get("/ok", (c) => c.text("ok"));
  app.get("/yok", (c) => c.json({}, 404));
  app.get("/patlak", (c) => c.json({}, 500));
  app.get("/metrics", (c) => c.text("metrics"));
  return { app, lines };
}

describe("createRequestLogger", () => {
  test("her istek için tek satır, standart alanlarla", async () => {
    const { app, lines } = buildApp();
    await app.request("/ok");

    expect(lines).toHaveLength(1);
    expect(lines[0].fields).toMatchObject({ method: "GET", path: "/ok", status: 200 });
    expect(lines[0].fields.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("status → seviye: 5xx error, 4xx warn, diğeri info", async () => {
    const { app, lines } = buildApp();
    await app.request("/ok");
    await app.request("/yok");
    await app.request("/patlak");

    expect(lines.map((l) => l.level)).toEqual([LogLevel.Info, LogLevel.Warn, LogLevel.Error]);
  });

  test("skip edilen uç HİÇ loglanmaz (metrics/health gürültüsü)", async () => {
    const { app, lines } = buildApp({ skip: (c) => c.req.path === "/metrics" });
    await app.request("/metrics");
    await app.request("/ok");

    expect(lines.map((l) => l.fields.path)).toEqual(["/ok"]);
  });

  test("proje-özel alanlar eklenebilir (OCP dikişi)", async () => {
    const { app, lines } = buildApp({ getExtraFields: () => ({ tenant: "acme" }) });
    await app.request("/ok");

    expect(lines[0].fields).toMatchObject({ tenant: "acme" });
  });

  test("requestId okuma yolu ve mesaj enjekte edilebilir", async () => {
    const { app, lines } = buildApp({
      getRequestId: () => "req-1",
      getMessage: (level) => `seviye:${level}`,
    });
    await app.request("/yok");

    expect(lines[0].fields.requestId).toBe("req-1");
    expect(lines[0].message).toBe("seviye:warn");
  });

  test("seviye eşlemesi override edilebilir", async () => {
    const { app, lines } = buildApp({ getLevel: () => LogLevel.Debug });
    await app.request("/patlak");

    expect(lines[0].level).toBe(LogLevel.Debug);
  });
});
