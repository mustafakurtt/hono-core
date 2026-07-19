/**
 * core/metrics barrel — prom-client tabanlı Prometheus metrikleri + /metrics rotası.
 * Etiket adları ve rota yolu projeden enjekte edilir; core sabit isim dayatmaz.
 */
export { createMetrics, type CreateMetricsOptions, type Metrics } from "./metrics";
