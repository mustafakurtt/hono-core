import { createMiddleware } from "hono/factory";

/** Bağlama yazılan dil değişkeni; error-handler ve (ileride) respond okur. */
export type LocaleVariables = { locale: string };

/**
 * Accept-Language header'ından desteklenen bir dil çözer.
 * Örn. "en;q=0.8,tr-TR,tr;q=0.9" → en yüksek kaliteli desteklenen kök dil ("tr"),
 * yoksa fallback.
 *
 * q-değeri (kalite) sıralamasına UYAR: RFC 9110'a göre istemci dilleri sıraya değil
 * `q`'ya göre önceliklendirir (q verilmeyen = 1.0; `q=0` = "kabul etme"). Eşit q'da
 * header'daki yazılış sırası korunur (stabil sıralama). Böylece "en;q=0.8,tr;q=0.9"
 * gibi sırasız ama kalitelendirilmiş header'larda da doğru dili seçeriz.
 */
export function resolveLocale(
  header: string | undefined,
  supported: readonly string[],
  fallback: string
): string {
  if (!header) return fallback;
  const ranked = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const qParam = params.find((p) => p.trim().toLowerCase().startsWith("q="));
      const q = qParam ? Number.parseFloat(qParam.split("=")[1]) : 1;
      return {
        locale: tag.trim().split("-")[0].toLowerCase(),
        q: Number.isNaN(q) ? 0 : q,
      };
    })
    // q=0 = "kabul etme" (RFC); geçersiz/boş etiketleri de ele.
    .filter((entry) => entry.q > 0 && entry.locale.length > 0)
    // Stabil sıralama (Bun/JSC ES2019+): eşit q'da header sırası korunur.
    .sort((a, b) => b.q - a.q);
  return ranked.find((entry) => supported.includes(entry.locale))?.locale ?? fallback;
}

export interface LocaleMiddlewareOptions {
  supported: readonly string[];
  fallback: string;
}

/**
 * Dili istek başında bir kez çözüp `c.set("locale")` ile bağlama yazan middleware
 * (requestId ile aynı mantık — erken çözülür, aşağıdaki her katman okur).
 */
export function createLocaleMiddleware({ supported, fallback }: LocaleMiddlewareOptions) {
  return createMiddleware<{ Variables: LocaleVariables }>(async (c, next) => {
    c.set("locale", resolveLocale(c.req.header("Accept-Language"), supported, fallback));
    await next();
  });
}
