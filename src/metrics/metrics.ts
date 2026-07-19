import { Registry, collectDefaultMetrics, Histogram, Counter } from "prom-client";
import type { Context, MiddlewareHandler } from "hono";

export { Registry, Histogram, Counter };

/**
 * Taşınabilir metrics (Prometheus) seam'i. core/ proje-bağımsız kalsın diye
 * prefix/label türetme dışarıdan verilir; proje kendi örneğini kurar
 * (createLogger / createMetrics aynı fabrika deseni). prom-client Bun'da çalışır.
 *
 * Üretilen instrument'lar Prometheus'un PULL modeline uygundur: uygulama bir
 * `/metrics` endpoint'i açar, Prometheus onu periyodik scrape eder, Grafana çizer.
 *
 * KARDİNALİTE: `route` etiketi ham path DEĞİL, eşleşen route DESENİ olmalı
 * (`/api/x/:id`) — aksi halde her ID yeni bir seri üretir ve Prometheus şişer.
 */
export interface CreateMetricsOptions {
  /** Metrik adı öneki (ör. "uniclub_"). */
  prefix?: string;
  /** Kendi registry'n; verilmezse izole bir registry kurulur. */
  registry?: Registry;
  /** Süreç/bellek/GC/event-loop gibi runtime metriklerini topla. Varsayılan true. */
  collectDefault?: boolean;
  /** HTTP süre histogramı bucket'ları (saniye). */
  buckets?: number[];
  /**
   * İstek için düşük-kardinaliteli "route" etiketini üretir. Varsayılan: eşleşen
   * route deseni (`c.req.routePath`), yoksa "unmatched" (404 gürültüsünü tek seride toplar).
   */
  getRoute?: (c: Context) => string;
}

export interface Metrics {
  /** Alttaki prom-client registry — özel metrik eklemek/expose etmek için. */
  registry: Registry;
  /** Her isteği ölçen middleware (süre histogramı + toplam sayaç). Erken mount edilmeli. */
  middleware: MiddlewareHandler;
  /** `/metrics` exposition handler (Prometheus metin formatı). */
  handler: (c: Context) => Promise<Response>;
}

export function createMetrics(options: CreateMetricsOptions = {}): Metrics {
  const {
    prefix = "",
    registry = new Registry(),
    collectDefault = true,
    buckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    getRoute = (c) => c.req.routePath || "unmatched",
  } = options;

  if (collectDefault) collectDefaultMetrics({ register: registry, prefix });

  const labelNames = ["method", "route", "status"] as const;

  const httpDuration = new Histogram({
    name: `${prefix}http_request_duration_seconds`,
    help: "HTTP istek süresi (saniye)",
    labelNames,
    buckets,
    registers: [registry],
  });

  const httpTotal = new Counter({
    name: `${prefix}http_requests_total`,
    help: "Toplam HTTP istek sayısı",
    labelNames,
    registers: [registry],
  });

  const middleware: MiddlewareHandler = async (c, next) => {
    const stopTimer = httpDuration.startTimer();
    try {
      await next();
    } finally {
      const labels = {
        method: c.req.method,
        route: getRoute(c),
        status: String(c.res.status),
      };
      stopTimer(labels);
      httpTotal.inc(labels);
    }
  };

  const handler = async (c: Context): Promise<Response> => {
    c.header("Content-Type", registry.contentType);
    return c.body(await registry.metrics());
  };

  return { registry, middleware, handler };
}
